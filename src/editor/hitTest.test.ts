import { describe, expect, it } from "vitest";
import { addNode, emptyDiagram, makeNode } from "../model/ops";
import { endpointFor } from "./hitTest";

describe("endpointFor: a connector back to its own box", () => {
  // A at x 4..15, y 3..7.
  const d = addNode(emptyDiagram(), makeNode({ x: 4, y: 3, w: 12, h: 5 }, { id: "A" }));
  const fromRight = { kind: "attached" as const, node: "A", side: "right" as const, offset: 1 };

  it("ends on the same box at another point on its border, or just outside it", () => {
    expect(endpointFor(d, { x: 10, y: 3 }, false, fromRight)).toEqual({ kind: "attached", node: "A", side: "top", offset: 6 });
    expect(endpointFor(d, { x: 10, y: 2 }, false, fromRight)).toEqual({ kind: "attached", node: "A", side: "top", offset: 6 });
    expect(endpointFor(d, { x: 15, y: 6 }, false, fromRight)).toEqual({ kind: "attached", node: "A", side: "right", offset: 3 });
  });

  it("doesn't, inside the box, at the same point, or from the box's middle", () => {
    expect(endpointFor(d, { x: 10, y: 5 }, false, fromRight)).toEqual({ kind: "free", at: { x: 10, y: 5 } });
    expect(endpointFor(d, { x: 15, y: 4 }, false, fromRight)).toEqual({ kind: "free", at: { x: 15, y: 4 } });
    const fromInside = { kind: "attached" as const, node: "A", side: "auto" as const };
    expect(endpointFor(d, { x: 10, y: 3 }, false, fromInside)).toEqual({ kind: "free", at: { x: 10, y: 3 } });
  });
});
