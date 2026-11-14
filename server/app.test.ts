import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { addNode, emptyDiagram, makeNode, moveObjects } from "../src/model/ops";
import { applyDiff, diagramName, toDiagram } from "../src/collab/bridge";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backup, createCollabServer } from "./app";
import type { OwnerAction, ServerMessage } from "../src/collab/protocol";

const PORT = 41000 + Math.floor(Math.random() * 1000);
const http = `http://127.0.0.1:${PORT}`;
const ws = `ws://127.0.0.1:${PORT}`;
const { server } = createCollabServer({ db: ":memory:", port: PORT });

beforeAll(async () => {
  await server.listen(PORT);
});
afterAll(async () => {
  await server.destroy();
});

const until = async (ok: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

function connect(id: string, key: string, name: string, extra: { owner?: string; password?: string } = {}, url = ws) {
  const doc = new Y.Doc();
  const state = {
    synced: false, denied: false, reason: "", closed: "",
    messages: [] as ServerMessage[],
    hello: null as Extract<ServerMessage, { type: "hello" }> | null,
  };
  const provider = new HocuspocusProvider({
    url, name: id, document: doc, token: JSON.stringify({ key, name, ...extra }),
    onSynced: () => (state.synced = true),
    onAuthenticationFailed: ({ reason }) => {
      state.denied = true;
      state.reason = reason;
    },
    onClose: ({ event }) => (state.closed = event.reason),
    onStateless: ({ payload }) => {
      const m = JSON.parse(payload) as ServerMessage;
      state.messages.push(m);
      if (m.type === "hello") state.hello = m;
    },
  });
  const owner = (m: OwnerAction) => provider.sendStateless(JSON.stringify({ type: "owner", ...m }));
  return { doc, provider, state, owner };
}

async function share(base = http) {
  const diagram = addNode(emptyDiagram(), makeNode({ x: 0, y: 0, w: 6, h: 3 }, { id: "a", text: "A" }));
  const res = await fetch(`${base}/graph/api/diagrams`, { method: "POST", body: JSON.stringify({ name: "Plan", diagram }) });
  expect(res.status).toBe(201);
  return { diagram, ...(await res.json()) as { id: string; editKey: string; ownerSecret: string } };
}

describe("live editing server", () => {
  it("says it's there", async () => {
    expect(await (await fetch(`${http}/api/health`)).json()).toEqual({ ok: true });
  });

  it("refuses what isn't a diagram", async () => {
    expect((await fetch(`${http}/api/diagrams`, { method: "POST", body: "{}" })).status).toBe(400);
    expect((await fetch(`${http}/api/diagrams`, { method: "POST", body: "nope" })).status).toBe(400);
  });

  it("shares a diagram: two people with the link see each other's edits, and each other", async () => {
    const { id, editKey, diagram } = await share();
    const alice = connect(id, editKey, "Alice"), bob = connect(id, editKey, "Bob");
    await until(() => alice.state.synced && bob.state.synced);
    expect(toDiagram(bob.doc)).toEqual(diagram);
    expect(diagramName(bob.doc)).toBe("Plan");

    applyDiff(alice.doc, diagram, moveObjects(diagram, ["a"], { x: 5, y: 2 }));
    await until(() => toDiagram(bob.doc).nodes.a.rect.x === 5);

    alice.provider.setAwarenessField("user", { name: "Alice" });
    await until(() => [...bob.provider.awareness!.getStates().values()].some((s) => s.user?.name === "Alice"));
    alice.provider.destroy();
    bob.provider.destroy();
  });

  it("keeps the diagram: someone joining later gets the latest", async () => {
    const { id, editKey, diagram } = await share();
    const alice = connect(id, editKey, "Alice");
    await until(() => alice.state.synced);
    applyDiff(alice.doc, diagram, moveObjects(diagram, ["a"], { x: 9, y: 0 }));
    await until(() => !alice.provider.hasUnsyncedChanges);
    alice.provider.destroy();
    const carol = connect(id, editKey, "Carol");
    await until(() => carol.state.synced);
    expect(toDiagram(carol.doc).nodes.a.rect.x).toBe(9);
    carol.provider.destroy();
  });

  it("turns away a wrong key or an unknown diagram", async () => {
    const { id } = await share();
    const wrong = connect(id, "not-the-key", "Mallory");
    const unknown = connect("nope", "x", "Mallory");
    await until(() => wrong.state.denied && unknown.state.denied);
    expect(wrong.state.synced || unknown.state.synced).toBe(false);
    wrong.provider.destroy();
    unknown.provider.destroy();
  });

  it("the owner link: the owner's controls, and the links' keys", async () => {
    const { id, editKey, ownerSecret } = await share();
    const owner = connect(id, ownerSecret, "Olive");
    const editor = connect(id, editKey, "Ed");
    await until(() => !!owner.state.hello && !!editor.state.hello);
    expect(owner.state.hello!.role).toBe("owner");
    expect(owner.state.hello!.keys!.edit).toBe(editKey);
    expect(editor.state.hello!.role).toBe("edit");
    expect(editor.state.hello!.keys).toBeUndefined();
    // The owner's secret alongside an edit key (the owner's own browser) works too.
    const again = connect(id, editKey, "Olive", { owner: ownerSecret });
    await until(() => !!again.state.hello);
    expect(again.state.hello!.role).toBe("owner");
    // Not the owner: owner actions are ignored.
    editor.owner({ action: "readOnly", value: true });
    await new Promise((r) => setTimeout(r, 200));
    expect(editor.state.messages.some((m) => m.type === "settings")).toBe(false);
    for (const p of [owner, editor, again]) p.provider.destroy();
  });

  it("a view link sees changes but can't make them", async () => {
    const { id, ownerSecret, diagram } = await share();
    const owner = connect(id, ownerSecret, "Olive");
    await until(() => !!owner.state.hello);
    const viewer = connect(id, owner.state.hello!.keys!.view!, "Vic");
    await until(() => !!viewer.state.hello && viewer.state.synced);
    expect(viewer.state.hello!.role).toBe("view");
    // (Not the same box: a change of the viewer's own would win in the viewer's copy.)
    applyDiff(viewer.doc, diagram, addNode(diagram, makeNode({ x: 9, y: 0, w: 6, h: 3 }, { id: "v", text: "V" })));
    applyDiff(owner.doc, diagram, moveObjects(diagram, ["a"], { x: 0, y: 3 }));
    await until(() => toDiagram(viewer.doc).nodes.a.rect.y === 3);
    await new Promise((r) => setTimeout(r, 200));
    expect(toDiagram(owner.doc).nodes.v).toBeUndefined();
    owner.provider.destroy();
    viewer.provider.destroy();
  });

  it("read-only: editors can't change it, the owner still can", async () => {
    const { id, editKey, ownerSecret, diagram } = await share();
    const owner = connect(id, ownerSecret, "Olive"), editor = connect(id, editKey, "Ed");
    await until(() => owner.state.synced && editor.state.synced && !!editor.state.hello);
    owner.owner({ action: "readOnly", value: true });
    await until(() => editor.state.messages.some((m) => m.type === "settings" && m.settings.readOnly));
    // (Not the same box: a change of the editor's own would win in the editor's copy.)
    applyDiff(editor.doc, diagram, addNode(diagram, makeNode({ x: 9, y: 0, w: 6, h: 3 }, { id: "v", text: "V" })));
    applyDiff(owner.doc, diagram, moveObjects(diagram, ["a"], { x: 0, y: 3 }));
    await until(() => toDiagram(editor.doc).nodes.a.rect.y === 3);
    await new Promise((r) => setTimeout(r, 200));
    expect(toDiagram(owner.doc).nodes.v).toBeUndefined();
    owner.provider.destroy();
    editor.provider.destroy();
  });

  it("a password: asked for, checked, and everyone else is sent out to give it", async () => {
    const { id, editKey, ownerSecret } = await share();
    const owner = connect(id, ownerSecret, "Olive"), editor = connect(id, editKey, "Ed");
    await until(() => !!owner.state.hello && !!editor.state.hello);
    owner.owner({ action: "password", value: "sesame" });
    await until(() => editor.state.closed === "password");
    const none = connect(id, editKey, "Ed"), wrong = connect(id, editKey, "Ed", { password: "nope" });
    const right = connect(id, editKey, "Ed", { password: "sesame" });
    await until(() => none.state.denied && wrong.state.denied && right.state.synced);
    expect([none.state.reason, wrong.state.reason]).toEqual(["password", "wrong-password"]);
    // The owner doesn't need it.
    const owner2 = connect(id, ownerSecret, "Olive");
    await until(() => owner2.state.synced);
    for (const p of [owner, editor, none, wrong, right, owner2]) p.provider.destroy();
  });

  it("replacing a link sends out the people using it, and turns the old one away", async () => {
    const { id, editKey, ownerSecret } = await share();
    const owner = connect(id, ownerSecret, "Olive"), editor = connect(id, editKey, "Ed");
    await until(() => !!owner.state.hello && !!editor.state.hello);
    owner.owner({ action: "replace", value: "edit" });
    await until(() => editor.state.closed === "replaced");
    const settings = owner.state.messages.find((m) => m.type === "settings") as Extract<ServerMessage, { type: "settings" }>;
    expect(settings.keys!.edit).not.toBe(editKey);
    const old = connect(id, editKey, "Ed"), fresh = connect(id, settings.keys!.edit!, "Ed");
    await until(() => old.state.denied && fresh.state.synced);
    for (const p of [owner, editor, old, fresh]) p.provider.destroy();
  });

  it("deleting it: everyone is sent out, and it's gone", async () => {
    const { id, editKey, ownerSecret } = await share();
    const owner = connect(id, ownerSecret, "Olive"), editor = connect(id, editKey, "Ed");
    await until(() => !!owner.state.hello && !!editor.state.hello);
    owner.owner({ action: "delete" });
    await until(() => editor.state.closed === "deleted" && owner.state.closed === "deleted");
    const late = connect(id, editKey, "Ed");
    await until(() => late.state.denied);
    for (const p of [owner, editor, late]) p.provider.destroy();
  });

  it("keeps a history with names, and who last changed each box", async () => {
    const { id, editKey, diagram } = await share();
    const alice = connect(id, editKey, "Alice");
    await until(() => alice.state.synced && !!alice.state.hello);
    applyDiff(alice.doc, diagram, moveObjects(diagram, ["a"], { x: 2, y: 0 }));
    await until(() => alice.state.messages.some((m) => m.type === "history"));
    const entry = (alice.state.messages.find((m) => m.type === "history") as Extract<ServerMessage, { type: "history" }>).entry;
    expect(entry).toMatchObject({ name: "Alice", summary: "moved 'A'", count: 1 });
    await until(() => !!alice.doc.getMap<{ name: string }>("by").get("a"));
    expect(alice.doc.getMap<{ name: string }>("by").get("a")!.name).toBe("Alice");
    // Moved again soon after: counted.
    const moved = toDiagram(alice.doc);
    applyDiff(alice.doc, moved, moveObjects(moved, ["a"], { x: 2, y: 0 }));
    await until(() => alice.state.messages.filter((m) => m.type === "history").length === 2);
    expect(alice.state.messages.filter((m) => m.type === "history").map((m) => (m as { entry: { count: number } }).entry.count)).toEqual([1, 2]);
    alice.provider.destroy();
    const bob = connect(id, editKey, "Bob");
    await until(() => !!bob.state.hello);
    expect(bob.state.hello!.history).toMatchObject([{ name: "Alice", summary: "moved 'A'", count: 2 }]);
    bob.provider.destroy();
  });
});

describe("limits, for a server open to anyone", () => {
  const port = PORT + 1;
  const base = `http://127.0.0.1:${port}`, url = `ws://127.0.0.1:${port}`;
  const { server: limited, db, sweep } = createCollabServer({
    db: ":memory:", port, limits: { sharesPerHour: 4, freeTries: 2, peoplePerDiagram: 2, retentionDays: 180 },
  });
  beforeAll(async () => {
    await limited.listen(port);
  });
  afterAll(async () => {
    await limited.destroy();
  });

  it("only so many diagrams shared from one address an hour", async () => {
    // (Two were shared by the other tests in this block already, or will be: use the rest.)
    const post = () => fetch(`${base}/api/diagrams`, { method: "POST", body: JSON.stringify({ name: "x", diagram: emptyDiagram() }) });
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await post()).status);
    expect(statuses.filter((s) => s === 201).length).toBeLessThanOrEqual(4);
    expect(statuses.at(-1)).toBe(429);
  });

  it("guessing a password is slowed down, and a diagram holds only so many people", async () => {
    db.exec("DELETE FROM diagrams");
    // A fresh window for sharing: the limiter counts by the hour, so share straight into the db.
    const { id, editKey, ownerSecret } = await shareDirect();
    const owner = connect(id, ownerSecret, "Olive", {}, url);
    await until(() => !!owner.state.hello);
    owner.owner({ action: "password", value: "sesame" });
    await until(() => owner.state.messages.some((m) => m.type === "settings" && m.settings.password));
    for (const pw of ["a", "b"]) {
      const g = connect(id, editKey, "Mallory", { password: pw }, url);
      await until(() => g.state.denied);
      expect(g.state.reason).toBe("wrong-password");
      g.provider.destroy();
    }
    // Now even the right one has to wait.
    const right = connect(id, editKey, "Ed", { password: "sesame" }, url);
    await until(() => right.state.denied);
    expect(right.state.reason).toBe("too-many");
    right.provider.destroy();

    // Full: the owner and one other; a third is turned away, but another owner gets in.
    owner.owner({ action: "password", value: null });
    await until(() => owner.state.messages.some((m) => m.type === "settings" && !m.settings.password));
    const ed = connect(id, editKey, "Ed", {}, url);
    await until(() => ed.state.synced);
    const third = connect(id, editKey, "Tess", {}, url);
    await until(() => third.state.denied);
    expect(third.state.reason).toBe("full");
    const owner2 = connect(id, ownerSecret, "Olive", {}, url);
    await until(() => owner2.state.synced);
    for (const p of [owner, ed, third, owner2]) p.provider.destroy();
  });

  it("deletes diagrams nobody has opened for six months, but not one that's open", async () => {
    db.exec("DELETE FROM diagrams");
    const a = await shareDirect(), b = await shareDirect();
    const open = connect(b.id, b.editKey, "Ed", {}, url);
    await until(() => open.state.synced);
    const later = Date.now() + 181 * 86_400_000;
    expect(sweep(later)).toBe(1);
    const left = (db.prepare("SELECT id FROM diagrams").all() as { id: string }[]).map((r) => r.id);
    expect(left).toEqual([b.id]);
    expect(left).not.toContain(a.id);
    open.provider.destroy();
  });

  /** Share without going through the hourly limit (a fresh server per share). */
  async function shareDirect() {
    const p = port + 10 + Math.floor(Math.random() * 500);
    const { server: s, db: other } = createCollabServer({ db: ":memory:", port: p });
    await s.listen(p);
    const shared = await share(`http://127.0.0.1:${p}`);
    const row = other.prepare("SELECT * FROM diagrams WHERE id = ?").get(shared.id) as Record<string, never>;
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO diagrams (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
    await s.destroy();
    return shared;
  }
});

describe("backups", () => {
  it("copies the database, keeping the newest few", () => {
    const dir = mkdtempSync(join(tmpdir(), "asciigraph-test-"));
    const file = join(dir, "live.db");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE t (x); INSERT INTO t VALUES (42);");
    db.close();
    for (let i = 0; i < 4; i++) backup(file, join(dir, "backups"), 2, new Date(Date.UTC(2026, 0, 1 + i)));
    const kept = readdirSync(join(dir, "backups")).sort();
    expect(kept).toEqual(["asciigraph-20260103-000000.db", "asciigraph-20260104-000000.db"]);
    const copy = new DatabaseSync(join(dir, "backups", kept[1]));
    expect(copy.prepare("SELECT x FROM t").get()).toEqual({ x: 42 });
  });
});
