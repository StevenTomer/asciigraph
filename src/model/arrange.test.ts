import { describe, expect, it } from "vitest";
import { align, bringForward, distribute, reverseEdge, sendBackward, sendToBack } from "./arrange";
import { addEdge, addNode, bringToFront, emptyDiagram, makeEdge, makeNode } from "./ops";
import type { Diagram, Node } from "./types";

const n = (id: string, x: number, y: number, w = 4, h = 3) => makeNode({ x, y, w, h }, { id });
const diagram = (...ns: Node[]) => ns.reduce(addNode, emptyDiagram());
const rects = (d: Diagram) => Object.fromEntries(Object.values(d.nodes).map((x) => [x.id, [x.rect.x, x.rect.y]]));

describe("stacking order", () => {
  // a, b, c overlap in a stack; d is off on its own.
  const d = diagram(n("a", 0, 0), n("b", 2, 1), n("c", 3, 2), n("d", 20, 0));

  it("brings to front and sends to back", () => {
    expect(bringToFront(d, ["a"]).order).toEqual(["b", "c", "d", "a"]);
    expect(sendToBack(d, ["c"]).order).toEqual(["c", "a", "b", "d"]);
  });

  it("steps past the next overlapping box, not ones it doesn't touch", () => {
    expect(bringForward(d, ["a"]).order).toEqual(["b", "a", "c", "d"]);
    expect(bringForward(d, ["c"]).order).toEqual(["a", "b", "c", "d"]); // nothing above overlaps
    expect(sendBackward(d, ["c"]).order).toEqual(["a", "c", "b", "d"]);
    expect(sendBackward(d, ["a"]).order).toEqual(["a", "b", "c", "d"]);
  });
});

describe("align", () => {
  const d = diagram(n("a", 2, 0, 4, 3), n("b", 10, 5, 8, 5), n("c", 5, 12, 6, 3));

  it("lines up edges and centres within the selection's bounds", () => {
    expect(rects(align(d, ["a", "b", "c"], "left"))).toEqual({ a: [2, 0], b: [2, 5], c: [2, 12] });
    expect(rects(align(d, ["a", "b", "c"], "right"))).toEqual({ a: [14, 0], b: [10, 5], c: [12, 12] });
    expect(rects(align(d, ["a", "b", "c"], "center"))).toEqual({ a: [8, 0], b: [6, 5], c: [7, 12] });
    expect(rects(align(d, ["a", "b", "c"], "top"))).toEqual({ a: [2, 0], b: [10, 0], c: [5, 0] });
    expect(rects(align(d, ["a", "b", "c"], "bottom"))).toEqual({ a: [2, 12], b: [10, 10], c: [5, 12] });
    expect(rects(align(d, ["a", "b", "c"], "middle"))).toEqual({ a: [2, 6], b: [10, 5], c: [5, 6] });
  });

  it("moves what's inside a box with it, and ignores selected boxes inside other selected boxes", () => {
    const outer = n("o", 10, 0, 10, 6), inner = n("i", 12, 2, 3, 2);
    const dd = diagram(n("a", 0, 0), outer, inner);
    expect(rects(align(dd, ["a", "o", "i"], "left"))).toEqual({ a: [0, 0], o: [0, 0], i: [2, 2] });
  });
});

describe("distribute", () => {
  it("makes the gaps equal, keeping the outermost boxes in place", () => {
    const d = diagram(n("a", 0, 0, 4), n("b", 5, 3, 6), n("c", 30, 1, 2));
    // span 0..31 (32 cells), widths 12, so two gaps of 10.
    expect(rects(distribute(d, ["a", "b", "c"], "horizontal"))).toEqual({ a: [0, 0], b: [14, 3], c: [30, 1] });
    const v = diagram(n("a", 0, 0, 4, 2), n("b", 3, 2, 4, 4), n("c", 1, 20, 4, 2));
    // span 0..21 (22 rows), heights 8, so two gaps of 7.
    expect(rects(distribute(v, ["a", "b", "c"], "vertical"))).toEqual({ a: [0, 0], b: [3, 9], c: [1, 20] });
  });

  it("does nothing for fewer than three", () => {
    const d = diagram(n("a", 0, 0), n("b", 9, 0));
    expect(distribute(d, ["a", "b"], "horizontal")).toBe(d);
  });
});

it("reverses a connector, arrowheads included", () => {
  const d = addEdge(diagram(n("a", 0, 0), n("b", 10, 0)), makeEdge(
    { kind: "attached", node: "a", side: "auto" }, { kind: "free", at: { x: 20, y: 9 } }, { id: "e" }
  ));
  const r = reverseEdge(d, "e").edges.e;
  expect(r.from).toEqual({ kind: "free", at: { x: 20, y: 9 } });
  expect(r.to).toEqual({ kind: "attached", node: "a", side: "auto" });
  expect(r.arrows).toEqual({ start: true, end: false });
});
