import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode, moveObjects } from "../model/ops";
import { bringForward, sendToBack } from "../model/arrange";
import type { Diagram } from "../model/types";
import { applyDiff, diagramName, seedUpdate, toDiagram } from "./bridge";
import { keyBetween, rekey } from "./order";

describe("sort keys", () => {
  it("makes a key between any two, and before or after any one", () => {
    const keys = ["1", "5", "50001", "a", "az", "b", "zz"];
    for (let i = 0; i + 1 < keys.length; i++) {
      const k = keyBetween(keys[i], keys[i + 1]);
      expect(k > keys[i] && k < keys[i + 1]).toBe(true);
      expect(k.endsWith("0")).toBe(false);
    }
    expect(keyBetween(null, "1") < "1").toBe(true);
    expect(keyBetween("zz", null) > "zz").toBe(true);
    // Squeezing in again and again keeps working.
    let lo = "a", hi = "b";
    for (let i = 0; i < 200; i++) {
      const k = keyBetween(lo, hi);
      expect(k > lo && k < hi).toBe(true);
      if (i % 2) lo = k; else hi = k;
    }
  });

  it("re-keys only what moved", () => {
    const keys = new Map([["a", "1"], ["b", "2"], ["c", "3"], ["d", "4"]]);
    // d brought to the back: only d changes, to before a.
    const moved = rekey(["d", "a", "b", "c"], keys);
    expect([...moved.keys()]).toEqual(["d"]);
    expect(moved.get("d")! < "1").toBe(true);
    // A new node in the middle.
    const added = rekey(["a", "b", "x", "c", "d"], keys);
    expect([...added.keys()]).toEqual(["x"]);
    expect(added.get("x")! > "2" && added.get("x")! < "3").toBe(true);
  });
});

const box = (id: string, x: number) => makeNode({ x, y: 0, w: 6, h: 3 }, { id, text: id });
const sample = (): Diagram => {
  let d = [box("a", 0), box("b", 10), box("c", 20)].reduce(addNode, emptyDiagram());
  d = addEdge(d, makeEdge({ kind: "attached", node: "a", side: "auto" }, { kind: "attached", node: "b", side: "auto" }, { id: "e1" }));
  return d;
};
/** A document made from a seed, as the server makes it. */
const docFrom = (update: Uint8Array) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, update);
  return doc;
};
const sync = (x: Y.Doc, y: Y.Doc) => {
  Y.applyUpdate(y, Y.encodeStateAsUpdate(x, Y.encodeStateVector(y)));
  Y.applyUpdate(x, Y.encodeStateAsUpdate(y, Y.encodeStateVector(x)));
};

describe("a diagram as a shared document", () => {
  it("reads back what was written, name included", () => {
    const d = sample();
    const doc = docFrom(seedUpdate(d, "Plan"));
    expect(toDiagram(doc)).toEqual(d);
    expect(diagramName(doc)).toBe("Plan");
  });

  it("writes only what changed", () => {
    const d = sample();
    const doc = docFrom(seedUpdate(d, "x"));
    const moved = moveObjects(d, ["b"], { x: 0, y: 5 });
    let sets = 0;
    doc.getMap("nodes").observe((ev) => (sets += ev.keysChanged.size));
    applyDiff(doc, d, moved);
    expect(sets).toBe(1);
    expect(toDiagram(doc)).toEqual(moved);
    // The same diagram again: nothing.
    applyDiff(doc, moved, structuredClone(moved));
    expect(sets).toBe(1);
  });

  it("merges two people's edits made at the same time", () => {
    const seed = seedUpdate(sample(), "x");
    const alice = docFrom(seed), bob = docFrom(seed);
    const base = toDiagram(alice);
    // Alice moves a and brings c to the back; Bob deletes b's text and adds a box.
    applyDiff(alice, base, sendToBack(moveObjects(base, ["a"], { x: 0, y: 4 }), ["c"]));
    const bobs = addNode({ ...base, nodes: { ...base.nodes, b: { ...base.nodes.b, text: "" } } }, box("d", 40));
    applyDiff(bob, base, bobs);
    sync(alice, bob);
    const a = toDiagram(alice), b = toDiagram(bob);
    expect(a).toEqual(b);
    expect(a.nodes.a.rect.y).toBe(4);
    expect(a.nodes.b.text).toBe("");
    expect(a.order[0]).toBe("c");
    expect(a.order).toContain("d");
  });

  it("orders nodes by their keys after concurrent reordering", () => {
    const seed = seedUpdate(sample(), "x");
    const alice = docFrom(seed), bob = docFrom(seed);
    const base = toDiagram(alice);
    applyDiff(alice, base, bringForward(base, ["a"]));
    applyDiff(bob, base, sendToBack(base, ["c"]));
    sync(alice, bob);
    expect(toDiagram(alice).order).toEqual(toDiagram(bob).order);
    expect(toDiagram(alice).order[0]).toBe("c");
  });

  it("drops a connector whose box someone else deleted at the same time", () => {
    const seed = seedUpdate(sample(), "x");
    const alice = docFrom(seed), bob = docFrom(seed);
    const base = toDiagram(alice);
    const { a: _gone, ...rest } = base.nodes;
    applyDiff(alice, base, { ...base, nodes: rest, edges: {}, order: base.order.filter((id) => id !== "a") });
    // Bob relabels the connector meanwhile.
    applyDiff(bob, base, { ...base, edges: { e1: { ...base.edges.e1, label: "yes" } } });
    sync(alice, bob);
    expect(toDiagram(bob).edges).toEqual({});
    expect(toDiagram(bob).nodes.a).toBeUndefined();
  });
});
