import { describe, expect, it } from "vitest";
import { addNode, emptyDiagram, makeNode } from "../model/ops";
import { snapMove, snapPoint, snapResize } from "./snap";

const d = [
  makeNode({ x: 0, y: 0, w: 9, h: 3 }, { id: "a" }), // left 0, centre 4, right 8; top 0, middle 1, bottom 2
  makeNode({ x: 30, y: 10, w: 6, h: 4 }, { id: "b" }), // centre isn't a whole cell: edges only
].reduce(addNode, emptyDiagram());

describe("snap", () => {
  it("pulls a moving box's edges or centre onto another box's within two cells", () => {
    // A 5-wide box whose left is at 2: its centre (4) already lines up with a's centre.
    expect(snapMove(d, ["m"], { x: 2, y: 20, w: 5, h: 3 }).shift).toEqual({ x: 0, y: 0 });
    // Left at 1: one off a's left edge (0) and a's centre is 1 off too; nearest wins (first found).
    expect(snapMove(d, ["m"], { x: 1, y: 20, w: 5, h: 3 }).shift.x).toBe(-1);
    // Top at 11 (6 tall, so no whole-cell middle): one off b's top (10).
    const r = snapMove(d, ["m"], { x: 50, y: 11, w: 5, h: 6 });
    expect(r.shift).toEqual({ x: 0, y: -1 });
    expect(r.guides).toEqual([{ axis: "y", at: 10, from: 30, to: 54 }]);
    // Too far: no snap.
    expect(snapMove(d, ["m"], { x: 50, y: 30, w: 5, h: 3 }).shift).toEqual({ x: 0, y: 0 });
  });

  it("snaps only the edges being dragged when resizing", () => {
    const { rect } = snapResize(d, "m", { x: 20, y: 5, w: 9, h: 3 }, { right: true });
    expect(rect).toEqual({ x: 20, y: 5, w: 11, h: 3 }); // right edge 28 → b's left 30
  });

  it("snaps a box's corner while drawing", () => {
    expect(snapPoint(d, [], { x: 7, y: 9 }).point).toEqual({ x: 8, y: 10 });
  });
});
