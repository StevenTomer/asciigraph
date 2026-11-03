import { describe, expect, it } from "vitest";
import { diagramToText } from "../render/rasterize";
import { contents, paintOrder, withContents } from "./containment";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode, moveObjects, updateNode } from "./ops";
import type { Node } from "./types";

const block = (s: string) => s.replace(/^\n/, "").replace(/\n\s*$/, "");
const att = (node: string) => ({ kind: "attached" as const, node, side: "auto" as const });
const outer = makeNode({ x: 0, y: 0, w: 24, h: 7 }, { id: "o", name: "Outer" });
const in1 = makeNode({ x: 2, y: 2, w: 7, h: 3 }, { id: "i1", text: "in1" });
const in2 = makeNode({ x: 14, y: 2, w: 7, h: 3 }, { id: "i2", text: "in2" });
const outside = makeNode({ x: 30, y: 2, w: 7, h: 3 }, { id: "x", text: "out" });
const withNodes = (...ns: Node[]) => ns.reduce(addNode, emptyDiagram());

describe("nesting", () => {
  it("draws boxes inside a box in front of it, whichever was drawn first", () => {
    const expected = block(`
┌─ Outer ──────────────┐
│                      │
│ ┌─────┐     ┌─────┐  │
│ │ in1 │     │ in2 │  │
│ └─────┘     └─────┘  │
│                      │
└──────────────────────┘
`);
    expect(diagramToText(withNodes(outer, in1, in2))).toBe(expected);
    expect(diagramToText(withNodes(in1, in2, outer))).toBe(expected);
    expect(paintOrder(withNodes(in1, in2, outer))).toEqual(["o", "i1", "i2"]);
  });

  it("shows connectors inside a box, and joins the border where they cross it", () => {
    let d = addEdge(withNodes(in1, outer, in2, outside), makeEdge(att("i1"), att("i2")));
    d = addEdge(d, makeEdge(att("i2"), att("x"), { arrows: { start: false, end: false } }));
    expect(diagramToText(d)).toBe(block(`
┌─ Outer ──────────────┐
│                      │
│ ┌─────┐     ┌─────┐  │      ┌─────┐
│ │ in1 ├────►│ in2 ├──┼──────┤ out │
│ └─────┘     └─────┘  │      └─────┘
│                      │
└──────────────────────┘
`));
  });

  it("still hides connectors behind a box that overlaps their ends without containing them", () => {
    const a = makeNode({ x: 0, y: 2, w: 5, h: 3 }, { id: "a", text: "A" });
    const b = makeNode({ x: 14, y: 2, w: 5, h: 3 }, { id: "b", text: "B" });
    const cover = makeNode({ x: 3, y: 0, w: 13, h: 7 }, { id: "c", text: "cover" });
    const d = addEdge(withNodes(a, b, cover), makeEdge(att("a"), att("b")));
    expect(diagramToText(d)).toBe(block(`
   ┌───────────┐
   │           │
┌──│           │──┐
│ A│   cover   │B │
└──│           │──┘
   │           │
   └───────────┘
`));
  });

  it("knows what's inside what, at any depth", () => {
    const deep = makeNode({ x: 3, y: 3, w: 3, h: 1 }, { id: "deep", border: "none", text: "abc" });
    const d = withNodes(outer, in1, deep, outside);
    expect(contents(d, "o").sort()).toEqual(["deep", "i1"]);
    expect(contents(d, "i1")).toEqual(["deep"]);
    expect(contents(d, "x")).toEqual([]);
  });

  it("moves contents and inner free-ended connectors along, unless the box says not to", () => {
    let d = addEdge(withNodes(outer, in1, outside), makeEdge(att("i1"), { kind: "free", at: { x: 12, y: 5 } }, { id: "inner" }));
    d = addEdge(d, makeEdge(att("i1"), { kind: "free", at: { x: 28, y: 5 } }, { id: "leaving" }));
    expect(withContents(d, ["o"]).sort()).toEqual(["i1", "inner", "o"]);
    const moved = moveObjects(d, withContents(d, ["o"]), { x: 5, y: 0 });
    expect(moved.nodes.i1.rect.x).toBe(7);
    expect(moved.edges.inner.to).toEqual({ kind: "free", at: { x: 17, y: 5 } });
    expect(moved.edges.leaving.to).toEqual({ kind: "free", at: { x: 28, y: 5 } });

    const stays = updateNode(d, "o", { carry: false });
    expect(withContents(stays, ["o"])).toEqual(["o"]);
  });
});

describe("stacking things inside see-through containers", () => {
  it("lets an activation bar and a frame it overlaps be stacked either way", () => {
    const life = makeNode({ x: 0, y: 0, w: 9, h: 16 }, { id: "life", kind: "lifeline", text: "API" });
    const act = makeNode({ x: 3, y: 5, w: 3, h: 8 }, { id: "act", kind: "activation" });
    const frame = makeNode({ x: 1, y: 9, w: 14, h: 4 }, { id: "f", kind: "frame", name: "loop" });
    let d = withNodes(life, act, frame);
    const row = (dd: typeof d) => diagramToText(dd).split("\n")[9];
    // The frame was drawn last: its top border crosses the bar.
    expect(row(d)).toBe(" ┌─ loop ─────┐");
    // Send the frame to the back: now the bar is in front of it.
    d = { ...d, order: ["f", "life", "act"] };
    expect(row(d)).toBe(" ┌─│ │op ─────┐");
    expect(paintOrder(d)).toEqual(["f", "life", "act"]);
    // Send the bar to the back and bring the frame to the front: the bar still stays in front
    // of its own lifeline (whose line would run through it), and the frame is in front of both.
    d = { ...d, order: ["act", "life", "f"] };
    expect(paintOrder(d)).toEqual(["life", "act", "f"]);
    expect(row(d)).toBe(" ┌─ loop ─────┐");
  });

  it("still keeps a box in front of the box it's inside, whatever the order", () => {
    expect(paintOrder(withNodes(in1, outer))).toEqual(["o", "i1"]);
  });
});
