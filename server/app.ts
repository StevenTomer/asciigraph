import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type Connection, type Document, Server } from "@hocuspocus/server";
import { type Transaction, encodeStateAsUpdate } from "yjs";
import { isDiagram } from "../src/model/ops";
import { seedUpdate } from "../src/collab/bridge";
import { type HistoryEntry, type MapChange, summarize } from "../src/collab/history";
import {
  type ClientMessage, type LiveKeys, type LiveSettings, type Role, type ServerMessage, type Stamp,
  DELETED, DENIED, FULL, PASSWORD, REPLACED, TOO_MANY, WRONG_PASSWORD,
} from "../src/collab/protocol";
import { Backoff, RateLimit, addressOf } from "./limits";

/**
 * The live-editing server: shared diagrams, kept in SQLite, edited together over WebSockets
 * (Hocuspocus, which syncs the Yjs documents and who's there).
 *
 * HTTP (any path ending in these, so it works behind a proxy at /graph/ too):
 *   GET  …/api/health    → {ok: true}: live editing is available.
 *   POST …/api/diagrams  {name, diagram} → {id, editKey, ownerSecret}: shares a diagram.
 * WebSocket: the document name is the diagram's id; the token is JSON {key, name, owner?,
 * password?}. The key is the owner's secret or the edit or view key (src/collab/protocol.ts);
 * anything else is turned away, and so is a missing or wrong password (not for the owner).
 *
 * The edit and view keys are made from the owner's secret and a count (replacing a link counts
 * up), so the owner's browser is told them without the server keeping them. Only hashes are
 * stored: of the keys, the owner's secret, and the password (scrypt).
 *
 * The owner's controls come as stateless messages over the owner's connection. The server also
 * keeps the history (who changed what, collab/history.ts) and stamps who last changed each box
 * and connector (the document's "by" map).
 *
 * Open to anyone, so it has limits (`Limits`): sharing and connecting per address, guesses at a
 * password (slowed down), people per diagram, sizes. Diagrams nobody has opened for
 * `retentionDays` are deleted. `backup()` copies the database (`node server.mjs backup`).
 */
export interface Limits {
  /** Diagrams one address may share in an hour. */
  sharesPerHour: number;
  /** Live diagrams one address may have shared (that still exist). */
  diagramsPerAddress: number;
  /** WebSocket connections, and attempts to open a diagram, per address per minute. */
  connectsPerMinute: number;
  /** People in one diagram at once (the owner always gets in). */
  peoplePerDiagram: number;
  /** Wrong passwords in a row before each try must wait (5 s, doubling, up to 15 min). */
  freeTries: number;
  /** Largest diagram accepted when sharing (bytes of JSON), and largest message. */
  maxShareBytes: number;
  /** A diagram stored larger than this can't be changed further (but by deleting things, by the
   * owner). */
  maxDiagramBytes: number;
  /** Diagrams nobody has opened for this many days are deleted (0: kept for good). */
  retentionDays: number;
}

export const DEFAULT_LIMITS: Limits = {
  sharesPerHour: 30,
  diagramsPerAddress: 200,
  connectsPerMinute: 120,
  peoplePerDiagram: 50,
  freeTries: 5,
  maxShareBytes: 5_000_000,
  maxDiagramBytes: 10_000_000,
  retentionDays: 180,
};

export interface CollabOptions {
  /** SQLite file (":memory:" for tests). */
  db: string;
  port: number;
  /** Where to listen (default all addresses). */
  host?: string;
  /** Behind a proxy (nginx, Apache) that adds X-Forwarded-For: who's connecting comes from it. */
  trustProxy?: boolean;
  limits?: Partial<Limits>;
}

export interface Session {
  name: string;
  role: Role;
  /** The owner's secret (owner connections only): to tell the owner the links. */
  secret?: string;
}

interface Row {
  id: string;
  edit_hash: Uint8Array;
  view_hash: Uint8Array | null;
  owner_hash: Uint8Array;
  edit_gen: number;
  view_gen: number;
  password: string | null;
  readonly: number;
}

const HISTORY_KEPT = 500;
const HISTORY_SENT = 200;
/** The same change by the same person this soon after is counted, not listed again. */
const HISTORY_MERGE_MS = 2 * 60_000;
const MAPS = ["nodes", "edges", "sources", "locks", "order", "meta"];

const token = (bytes: number) => randomBytes(bytes).toString("base64url");
const hash = (s: string) => createHash("sha256").update(s).digest();
/** A link's key, made from the owner's secret. */
const linkKey = (secret: string, kind: "edit" | "view", gen: number) =>
  createHmac("sha256", secret).update(`${kind}:${gen}`).digest("base64url").slice(0, 22);
const matches = (stored: Uint8Array | null, given: unknown) =>
  !!stored && typeof given === "string" && given !== "" && timingSafeEqual(Buffer.from(stored), hash(given));

function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `${salt.toString("base64url")}.${scryptSync(password, salt, 32).toString("base64url")}`;
}
function checkPassword(stored: string, given: string) {
  const [salt, want] = stored.split(".");
  const got = scryptSync(given, Buffer.from(salt, "base64url"), 32);
  return timingSafeEqual(got, Buffer.from(want, "base64url"));
}

/** Turned away, saying why (the app shows it: a password to ask for, or a link that's gone). */
const refuse = (reason: string) => Object.assign(new Error(reason), { reason });

export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS diagrams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      edit_hash BLOB NOT NULL,
      owner_hash BLOB NOT NULL,
      state BLOB NOT NULL,
      created INTEGER NOT NULL,
      updated INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      diagram TEXT NOT NULL,
      at INTEGER NOT NULL,
      name TEXT NOT NULL,
      summary TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS changes_diagram ON changes (diagram, id);
  `);
  // Added since the first version (phase 1 of live editing).
  const cols = new Set((db.prepare("PRAGMA table_info(diagrams)").all() as { name: string }[]).map((c) => c.name));
  const add = (col: string, def: string) => !cols.has(col) && db.exec(`ALTER TABLE diagrams ADD COLUMN ${col} ${def}`);
  add("view_hash", "BLOB");
  add("edit_gen", "INTEGER NOT NULL DEFAULT 0");
  add("view_gen", "INTEGER NOT NULL DEFAULT 0");
  add("password", "TEXT");
  add("readonly", "INTEGER NOT NULL DEFAULT 0");
  if (!cols.has("opened")) {
    add("opened", "INTEGER NOT NULL DEFAULT 0");
    db.exec("UPDATE diagrams SET opened = updated");
  }
  add("creator", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS diagrams_creator ON diagrams (creator)");
  db.exec("CREATE INDEX IF NOT EXISTS diagrams_opened ON diagrams (opened)");
  return db;
}

export function createCollabServer(opts: CollabOptions): { server: Server<Session>; db: DatabaseSync; sweep: (now?: number) => number } {
  const db = openDb(opts.db);
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const maxBytes = limits.maxShareBytes;
  const trustProxy = !!opts.trustProxy;
  const shares = new RateLimit(limits.sharesPerHour, 3600_000);
  const connects = new RateLimit(limits.connectsPerMinute, 60_000);
  const opens = new RateLimit(limits.connectsPerMinute, 60_000);
  const guesses = new Backoff(limits.freeTries);
  /** Diagrams told they're too big to change (once each). */
  const tooBig = new Set<string>();
  const q = {
    insert: db.prepare(
      "INSERT INTO diagrams (id, name, edit_hash, view_hash, owner_hash, state, created, updated, opened, creator) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ),
    row: db.prepare("SELECT id, edit_hash, view_hash, owner_hash, edit_gen, view_gen, password, readonly FROM diagrams WHERE id = ?"),
    state: db.prepare("SELECT state FROM diagrams WHERE id = ?"),
    save: db.prepare("UPDATE diagrams SET state = ?, updated = ? WHERE id = ?"),
    password: db.prepare("UPDATE diagrams SET password = ? WHERE id = ?"),
    readOnly: db.prepare("UPDATE diagrams SET readonly = ? WHERE id = ?"),
    newEdit: db.prepare("UPDATE diagrams SET edit_hash = ?, edit_gen = ? WHERE id = ?"),
    newView: db.prepare("UPDATE diagrams SET view_hash = ?, view_gen = ? WHERE id = ?"),
    remove: db.prepare("DELETE FROM diagrams WHERE id = ?"),
    removeChanges: db.prepare("DELETE FROM changes WHERE diagram = ?"),
    lastChange: db.prepare("SELECT id, at, name, summary, count FROM changes WHERE diagram = ? ORDER BY id DESC LIMIT 1"),
    addChange: db.prepare("INSERT INTO changes (diagram, at, name, summary) VALUES (?, ?, ?, ?)"),
    bumpChange: db.prepare("UPDATE changes SET at = ?, count = count + 1 WHERE id = ?"),
    trimChanges: db.prepare("DELETE FROM changes WHERE diagram = ? AND id <= (SELECT id FROM changes WHERE diagram = ? ORDER BY id DESC LIMIT 1 OFFSET ?)"),
    history: db.prepare("SELECT id, at, name, summary, count FROM changes WHERE diagram = ? ORDER BY id DESC LIMIT ?"),
    opened: db.prepare("UPDATE diagrams SET opened = ? WHERE id = ?"),
    byCreator: db.prepare("SELECT count(*) AS n FROM diagrams WHERE creator = ?"),
    size: db.prepare("SELECT length(state) AS n FROM diagrams WHERE id = ?"),
    stale: db.prepare("SELECT id FROM diagrams WHERE opened < ?"),
    orphans: db.prepare("DELETE FROM changes WHERE diagram NOT IN (SELECT id FROM diagrams)"),
  };
  const rowOf = (id: string) => q.row.get(id) as Row | undefined;

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          reject(new Error("too large"));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });

  /** Who shared it, kept only as a hash (to count diagrams per address). */
  const creatorOf = (address: string) => createHash("sha256").update(`asciigraph:${address}`).digest("hex").slice(0, 32);

  async function share(req: IncomingMessage, res: ServerResponse) {
    const address = addressOf(req.headers["x-forwarded-for"], req.socket.remoteAddress, trustProxy);
    if (!shares.hit(address)) return json(res, 429, { error: "Too many diagrams shared from here in the last hour. Try again later." });
    const creator = creatorOf(address);
    if (limits.diagramsPerAddress > 0 && (q.byCreator.get(creator) as { n: number }).n >= limits.diagramsPerAddress)
      return json(res, 429, { error: "Too many live diagrams shared from here. Delete some first (owner… → delete)." });
    let body: { name?: unknown; diagram?: unknown };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "not a diagram" });
    }
    if (!isDiagram(body?.diagram)) return json(res, 400, { error: "not a diagram" });
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 200) : "Shared diagram";
    const id = token(12), ownerSecret = token(24);
    const editKey = linkKey(ownerSecret, "edit", 0);
    const now = Date.now();
    q.insert.run(id, name, hash(editKey), hash(linkKey(ownerSecret, "view", 0)), hash(ownerSecret), seedUpdate(body.diagram, name), now, now, now, creator);
    json(res, 201, { id, editKey, ownerSecret });
  }

  // --- what's sent to whom -------------------------------------------------------------------

  const settingsOf = (row: Row): LiveSettings => ({ readOnly: !!row.readonly, password: !!row.password });
  /** The owner's links' keys, if they're the ones made from this secret. */
  const keysOf = (row: Row, secret: string): LiveKeys => {
    const edit = linkKey(secret, "edit", row.edit_gen), view = linkKey(secret, "view", row.view_gen);
    return { edit: matches(row.edit_hash, edit) ? edit : null, view: matches(row.view_hash, view) ? view : null };
  };
  const send = (c: Connection<Session>, m: ServerMessage) => c.sendStateless(JSON.stringify(m));
  const connections = (doc: Document) => doc.getConnections() as Connection<Session>[];
  const historyOf = (id: string): HistoryEntry[] => (q.history.all(id, HISTORY_SENT) as unknown as HistoryEntry[]).reverse();

  /** Everyone's settings changed: tell them (and the owners their links). */
  function announce(doc: Document, row: Row) {
    for (const c of connections(doc)) {
      const { role, secret } = c.context;
      send(c, { type: "settings", settings: settingsOf(row), ...(role === "owner" && secret && { keys: keysOf(row, secret) }) });
    }
  }

  /** Close the diagram on some of the people in it (they're told why). */
  function closeOn(doc: Document, who: (s: Session) => boolean, reason: string) {
    for (const c of connections(doc)) if (who(c.context)) c.close({ code: 4000, reason });
  }

  function record(doc: Document, name: string, summary: string) {
    if (!summary) return;
    const now = Date.now();
    const last = q.lastChange.get(doc.name) as HistoryEntry | undefined;
    let entry: HistoryEntry;
    if (last && last.name === name && last.summary === summary && now - last.at < HISTORY_MERGE_MS) {
      q.bumpChange.run(now, last.id);
      entry = { ...last, at: now, count: last.count + 1 };
    } else {
      const { lastInsertRowid } = q.addChange.run(doc.name, now, name, summary);
      q.trimChanges.run(doc.name, doc.name, HISTORY_KEPT);
      entry = { id: Number(lastInsertRowid), at: now, name, summary, count: 1 };
    }
    for (const c of connections(doc)) send(c, { type: "history", entry });
  }

  function ownerAction(doc: Document, m: ClientMessage) {
    const id = doc.name;
    const row = rowOf(id);
    if (!row) return;
    const owners = connections(doc).find((c) => c.context.role === "owner" && c.context.secret)?.context.secret;
    switch (m.action) {
      case "password": {
        const pw = typeof m.value === "string" && m.value !== "" ? m.value.slice(0, 200) : null;
        q.password.run(pw && hashPassword(pw), id);
        announce(doc, rowOf(id)!);
        // A new password: everyone else gives it to come back in.
        if (pw) closeOn(doc, (s) => s.role !== "owner", PASSWORD);
        return;
      }
      case "readOnly":
        q.readOnly.run(m.value ? 1 : 0, id);
        for (const c of connections(doc)) if (c.context.role === "edit") c.readOnly = !!m.value;
        announce(doc, rowOf(id)!);
        return;
      case "replace": {
        if (!owners) return;
        const kind = m.value === "view" ? "view" : "edit";
        const gen = (kind === "edit" ? row.edit_gen : row.view_gen) + 1;
        (kind === "edit" ? q.newEdit : q.newView).run(hash(linkKey(owners, kind, gen)), gen, id);
        announce(doc, rowOf(id)!);
        closeOn(doc, (s) => s.role === kind, REPLACED);
        return;
      }
      case "delete":
        q.remove.run(id);
        q.removeChanges.run(id);
        closeOn(doc, () => true, DELETED);
        return;
    }
  }

  // --- the history and who changed what ------------------------------------------------------

  function watch(doc: Document) {
    const pending = new Map<Transaction, MapChange[]>();
    const fromSomeone = (tr: Transaction) => {
      const o = tr.origin as { source?: string; connection?: Connection<Session> } | null;
      return o?.source === "connection" && o.connection ? o.connection.context : null;
    };
    for (const name of MAPS) {
      const map = doc.getMap(name);
      map.observe((ev, tr) => {
        if (!fromSomeone(tr)) return;
        const list = pending.get(tr) ?? [];
        ev.changes.keys.forEach((change, key) => list.push({ map: name, key, old: change.oldValue, now: map.get(key) }));
        pending.set(tr, list);
      });
    }
    const by = doc.getMap<Stamp>("by");
    doc.on("afterTransaction", (tr) => {
      const list = pending.get(tr);
      if (!list) return;
      pending.delete(tr);
      const who = fromSomeone(tr)!;
      record(doc, who.name, summarize(list));
      const objects = list.filter((c) => c.map === "nodes" || c.map === "edges");
      if (!objects.length) return;
      const at = Date.now();
      // After this transaction, as one of the server's own.
      queueMicrotask(() =>
        doc.transact(() => {
          for (const c of objects) {
            if (c.now === undefined) by.delete(c.key);
            else by.set(c.key, { name: who.name, at });
          }
        }, "server"),
      );
    });
  }

  const server = new Server<Session>({
    port: opts.port,
    quiet: true,
    // Save a second after the last change (at most every 5 s while busy).
    debounce: 1000,
    maxDebounce: 5000,

    async onRequest({ request, response }) {
      const path = new URL(request.url ?? "/", "http://x").pathname;
      if (path.endsWith("/api/health") && request.method === "GET") json(response, 200, { ok: true });
      else if (path.endsWith("/api/diagrams") && request.method === "POST") await share(request, response);
      else json(response, 404, { error: "not found" });
      // Handled: stop Hocuspocus answering too.
      throw null;
    },

    async onUpgrade({ request, socket }) {
      // Who it is, for the limits (any such header the client sent is replaced).
      const address = addressOf(request.headers["x-forwarded-for"], request.socket.remoteAddress, trustProxy);
      request.headers["x-asciigraph-address"] = address;
      if (!connects.hit(address)) {
        socket.end("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
        throw null;
      }
    },

    async onAuthenticate({ documentName, token: t, connectionConfig, requestHeaders, instance }) {
      const address = requestHeaders.get("x-asciigraph-address") ?? "unknown";
      if (!opens.hit(address)) throw refuse(TOO_MANY);
      let creds: { key?: unknown; name?: unknown; owner?: unknown; password?: unknown };
      try {
        creds = JSON.parse(t);
      } catch {
        throw refuse(DENIED);
      }
      const row = rowOf(documentName);
      if (!row) throw refuse(DENIED);
      const name = typeof creds.name === "string" && creds.name.trim() ? creds.name.trim().slice(0, 60) : "Someone";
      const secret = [creds.key, creds.owner].find((k) => matches(row.owner_hash, k)) as string | undefined;
      if (secret) return { name, role: "owner", secret } satisfies Session;
      const role: Role | null = matches(row.edit_hash, creds.key) ? "edit" : matches(row.view_hash, creds.key) ? "view" : null;
      if (!role) throw refuse(DENIED);
      if (row.password) {
        if (typeof creds.password !== "string" || !creds.password) throw refuse(PASSWORD);
        const guesser = `${documentName} ${address}`;
        if (guesses.waiting(guesser)) throw refuse(TOO_MANY);
        if (!checkPassword(row.password, creds.password)) {
          guesses.fail(guesser);
          throw refuse(WRONG_PASSWORD);
        }
        guesses.succeed(guesser);
      }
      const here = instance.documents.get(documentName)?.getConnectionsCount() ?? 0;
      if (limits.peoplePerDiagram > 0 && here >= limits.peoplePerDiagram) throw refuse(FULL);
      const big = (q.size.get(documentName) as { n: number }).n > limits.maxDiagramBytes;
      connectionConfig.readOnly = role === "view" || !!row.readonly || big;
      return { name, role } satisfies Session;
    },

    async connected({ connection }) {
      const c = connection as Connection<Session>;
      const row = rowOf(c.document.name);
      if (!row) return;
      const { role, secret } = c.context;
      q.opened.run(Date.now(), row.id);
      send(c, {
        type: "hello",
        role,
        settings: settingsOf(row),
        ...(role === "owner" && secret && { keys: keysOf(row, secret) }),
        history: historyOf(row.id),
      });
    },

    async onStateless({ connection, document, payload }) {
      const c = connection as Connection<Session>;
      let m: ClientMessage;
      try {
        m = JSON.parse(payload);
      } catch {
        return;
      }
      if (m?.type === "owner" && c.context.role === "owner") ownerAction(document, m);
    },

    async onLoadDocument({ documentName }) {
      const row = q.state.get(documentName) as { state: Uint8Array } | undefined;
      return row ? new Uint8Array(row.state) : null;
    },

    async afterLoadDocument({ document }) {
      watch(document);
    },

    async onStoreDocument({ documentName, document }) {
      const state = encodeStateAsUpdate(document);
      q.save.run(state, Date.now(), documentName);
      if (state.length > limits.maxDiagramBytes && !tooBig.has(documentName)) {
        tooBig.add(documentName);
        const mb = Math.round(limits.maxDiagramBytes / 1e6);
        for (const c of connections(document)) {
          if (c.context.role !== "owner") c.readOnly = true;
          send(c, { type: "error", message: `This diagram has reached the size limit (${mb} MB), so it can't be changed any more (but by its owner, to make it smaller).` });
        }
      } else if (state.length <= limits.maxDiagramBytes) tooBig.delete(documentName);
    },

    websocketOptions: { maxPayload: limits.maxShareBytes },
    ...(opts.host && { address: opts.host }),
  });

  /** Delete the diagrams nobody has opened for `retentionDays` (not ones open now). */
  function sweep(now = Date.now()) {
    if (limits.retentionDays <= 0) return 0;
    const cutoff = now - limits.retentionDays * 86_400_000;
    let n = 0;
    for (const { id } of q.stale.all(cutoff) as { id: string }[]) {
      if (server.hocuspocus.documents.has(id)) continue;
      q.remove.run(id);
      n++;
    }
    if (n) q.orphans.run();
    return n;
  }
  return { server, db, sweep };
}

/** Copy the database to `dir` (named by the date), keeping the newest `keep` copies. Safe while
 * the server is running. Returns the new copy's path. */
export function backup(dbPath: string, dir: string, keep = 14, now = new Date()): string {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  const file = join(dir, `asciigraph-${stamp}.db`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.prepare("VACUUM INTO ?").run(file);
  } finally {
    db.close();
  }
  const copies = readdirSync(dir).filter((f) => /^asciigraph-\d{8}-\d{6}\.db$/.test(f)).sort();
  for (const old of copies.slice(0, Math.max(0, copies.length - keep))) rmSync(join(dir, old));
  return file;
}
