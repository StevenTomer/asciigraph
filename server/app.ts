import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Server } from "@hocuspocus/server";
import { encodeStateAsUpdate } from "yjs";
import { isDiagram } from "../src/model/ops";
import { seedUpdate } from "../src/collab/bridge";

/**
 * The live-editing server: shared diagrams, kept in SQLite, edited together over WebSockets
 * (Hocuspocus, which syncs the Yjs documents and who's there).
 *
 * HTTP (any path ending in these, so it works behind a proxy at /graph/ too):
 *   GET  …/api/health    → {ok: true}: live editing is available.
 *   POST …/api/diagrams  {name, diagram} → {id, editKey, ownerSecret}: shares a diagram.
 * WebSocket: the document name is the diagram's id; the token is JSON {key, name}. A wrong key
 * (or an unknown id) is turned away. Keys and the owner's secret are stored hashed.
 */
export interface CollabOptions {
  /** SQLite file (":memory:" for tests). */
  db: string;
  port: number;
  /** Largest diagram accepted when sharing, in bytes of JSON. */
  maxBytes?: number;
}

export interface Session {
  name: string;
}

const token = (bytes: number) => randomBytes(bytes).toString("base64url");
const hash = (s: string) => createHash("sha256").update(s).digest();

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
  `);
  return db;
}

export function createCollabServer(opts: CollabOptions): { server: Server<Session>; db: DatabaseSync } {
  const db = openDb(opts.db);
  const maxBytes = opts.maxBytes ?? 5_000_000;
  const insert = db.prepare("INSERT INTO diagrams (id, name, edit_hash, owner_hash, state, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const keyOf = db.prepare("SELECT edit_hash FROM diagrams WHERE id = ?");
  const stateOf = db.prepare("SELECT state FROM diagrams WHERE id = ?");
  const save = db.prepare("UPDATE diagrams SET state = ?, updated = ? WHERE id = ?");

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

  async function share(req: IncomingMessage, res: ServerResponse) {
    let body: { name?: unknown; diagram?: unknown };
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "not a diagram" });
    }
    if (!isDiagram(body?.diagram)) return json(res, 400, { error: "not a diagram" });
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 200) : "Shared diagram";
    const id = token(12), editKey = token(16), ownerSecret = token(24);
    const now = Date.now();
    insert.run(id, name, hash(editKey), hash(ownerSecret), seedUpdate(body.diagram, name), now, now);
    json(res, 201, { id, editKey, ownerSecret });
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

    async onAuthenticate({ documentName, token: t }) {
      let creds: { key?: unknown; name?: unknown };
      try {
        creds = JSON.parse(t);
      } catch {
        throw new Error("denied");
      }
      const row = keyOf.get(documentName) as { edit_hash: Uint8Array } | undefined;
      const given = typeof creds.key === "string" ? hash(creds.key) : null;
      if (!row || !given || !timingSafeEqual(Buffer.from(row.edit_hash), given)) throw new Error("denied");
      const name = typeof creds.name === "string" && creds.name.trim() ? creds.name.trim().slice(0, 60) : "Someone";
      return { name } satisfies Session;
    },

    async onLoadDocument({ documentName }) {
      const row = stateOf.get(documentName) as { state: Uint8Array } | undefined;
      return row ? new Uint8Array(row.state) : null;
    },

    async onStoreDocument({ documentName, document }) {
      save.run(encodeStateAsUpdate(document), Date.now(), documentName);
    },
  });
  return { server, db };
}
