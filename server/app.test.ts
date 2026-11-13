import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { addNode, emptyDiagram, makeNode, moveObjects } from "../src/model/ops";
import { applyDiff, diagramName, toDiagram } from "../src/collab/bridge";
import { createCollabServer } from "./app";

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

function connect(id: string, key: string, name: string) {
  const doc = new Y.Doc();
  const state = { synced: false, denied: false };
  const provider = new HocuspocusProvider({
    url: ws, name: id, document: doc, token: JSON.stringify({ key, name }),
    onSynced: () => (state.synced = true),
    onAuthenticationFailed: () => (state.denied = true),
  });
  return { doc, provider, state };
}

async function share() {
  const diagram = addNode(emptyDiagram(), makeNode({ x: 0, y: 0, w: 6, h: 3 }, { id: "a", text: "A" }));
  const res = await fetch(`${http}/graph/api/diagrams`, { method: "POST", body: JSON.stringify({ name: "Plan", diagram }) });
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
});
