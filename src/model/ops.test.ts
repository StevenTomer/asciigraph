import { describe, expect, it } from "vitest";
import { resolveEdge } from "../routing/endpoints";
import {
  addEdge, addNode, bringToFront, deleteObjects, emptyDiagram, isDiagram, makeEdge, makeNode,
  moveObjects, resizeNode, setNodeText, updateNode,
} from "./ops";

const a = makeNode({ x: 0, y: 0, w: 6, h: 3 }, { id: "a" });
const b = makeNode({ x: 20, y: 0, w: 6, h: 3 }, { id: "b" });
const att = (node: string) => ({ kind: "attached" as const, node, side: "auto" as const });
const base = () => addEdge(addNode(addNode(emptyDiagram(), a), b), makeEdge(att("a"), att("b"), { id: "e" }));

describe("ops", () => {
  it("never mutates the diagram it's given", () => {
    const d = base();
    const frozen = JSON.stringify(d);
    moveObjects(d, ["a", "e"], { x: 3, y: 1 });
    setNodeText(d, "a", "hello");
    deleteObjects(d, ["a"]);
    expect(JSON.stringify(d)).toBe(frozen);
  });

  it("moving a node moves its attached edge ends with it", () => {
    const d = moveObjects(base(), ["b"], { x: 0, y: 10 });
    const r = resolveEdge(d, d.edges.e);
    expect(r.to.node).toBe("b");
    expect(r.cells[r.cells.length - 1].y).toBeGreaterThan(5);
  });

  it("moves free ends only of selected edges", () => {
    let d = addEdge(base(), makeEdge({ kind: "free", at: { x: 1, y: 9 } }, att("a"), { id: "f" }));
    d = moveObjects(d, ["a"], { x: 1, y: 0 });
    expect(d.edges.f.from).toEqual({ kind: "free", at: { x: 1, y: 9 } });
    d = moveObjects(d, ["f"], { x: 1, y: 0 });
    expect(d.edges.f.from).toEqual({ kind: "free", at: { x: 2, y: 9 } });
  });

  it("deleting a node frees its edges' ends where they were", () => {
    const d = deleteObjects(base(), ["a"]);
    expect(d.nodes.a).toBeUndefined();
    expect(d.order).toEqual(["b"]);
    expect(d.edges.e.from).toEqual({ kind: "free", at: { x: 6, y: 1 } });
    expect(d.edges.e.to).toEqual(att("b"));
  });

  it("keeps boxes at least 2×2 and grows them to fit text", () => {
    let d = updateNode(base(), "a", { rect: { x: 0, y: 0, w: 1, h: 1 } });
    expect(d.nodes.a.rect).toMatchObject({ w: 2, h: 2 });
    d = resizeNode(d, "a", { x: 0, y: 0, w: 8, h: 3 });
    d = setNodeText(d, "a", "one two six");
    expect(d.nodes.a.rect.h).toBe(5); // content is 4 wide: 3 lines + borders
  });

  it("sizes labels to their text, until resized by hand", () => {
    let d = addNode(emptyDiagram(), makeNode({ x: 0, y: 0, w: 1, h: 1 }, { id: "l", border: "none", autosize: true }));
    d = setNodeText(d, "l", "two\nlines!");
    expect(d.nodes.l.rect).toMatchObject({ w: 6, h: 2 });
    d = resizeNode(d, "l", { x: 0, y: 0, w: 3, h: 4 });
    d = setNodeText(d, "l", "x");
    expect(d.nodes.l.rect).toMatchObject({ w: 3, h: 4 });
  });

  it("brings nodes to the front, and round-trips through JSON", () => {
    const d = bringToFront(base(), ["a"]);
    expect(d.order).toEqual(["b", "a"]);
    const back = JSON.parse(JSON.stringify(d));
    expect(isDiagram(back)).toBe(true);
    expect(back).toEqual(d);
    expect(isDiagram({ version: 2 })).toBe(false);
  });
});
