import { describe, expect, it } from "vitest";
import {
  addEdge, addNode, deleteObjects, emptyDiagram, makeEdge, makeNode, moveObjects, setNodeText,
} from "../model/ops";
import type { Diagram, Node } from "../model/types";
import { diagramToText } from "./rasterize";

const text = (d: Diagram, ascii = false) => diagramToText(d, ascii);
const block = (s: string) => s.replace(/^\n/, "").replace(/\n\s*$/, "");

function withNodes(...nodes: Node[]) {
  return nodes.reduce(addNode, emptyDiagram());
}

describe("boxes", () => {
  it("draws each border style", () => {
    const styles = ["single", "double", "rounded", "heavy", "ascii"] as const;
    const d = withNodes(...styles.map((border, i) => makeNode({ x: i * 3, y: 0, w: 3, h: 3 }, { border })));
    expect(text(d)).toBe(block(`
┌─┐╔═╗╭─╮┏━┓+-+
│ │║ ║│ │┃ ┃| |
└─┘╚═╝╰─╯┗━┛+-+
`));
  });

  it("wraps and centers text, growing the box to fit", () => {
    let d = withNodes(makeNode({ x: 0, y: 0, w: 11, h: 3 }, { id: "a" }));
    d = setNodeText(d, "a", "hello big world");
    // Content is 7 wide (border + 1 space padding each side), so three lines and a taller box.
    expect(text(d)).toBe(block(`
┌─────────┐
│  hello  │
│   big   │
│  world  │
└─────────┘
`));
  });

  it("aligns text left/right and top/bottom", () => {
    const d = withNodes(
      makeNode({ x: 0, y: 0, w: 8, h: 4 }, { text: "ab", align: { h: "left", v: "top" } }),
      makeNode({ x: 8, y: 0, w: 8, h: 4 }, { text: "cd", align: { h: "right", v: "bottom" } })
    );
    expect(text(d)).toBe(block(`
┌──────┐┌──────┐
│ ab   ││      │
│      ││   cd │
└──────┘└──────┘
`));
  });

  it("sets a name into the top border, truncating when narrow", () => {
    const d = withNodes(
      makeNode({ x: 0, y: 0, w: 14, h: 3 }, { name: "Server" }),
      makeNode({ x: 0, y: 3, w: 10, h: 3 }, { name: "Database", border: "double" }),
      makeNode({ x: 0, y: 6, w: 14, h: 3 }, { name: "Mid", nameAlign: "center" }),
      makeNode({ x: 0, y: 9, w: 14, h: 3 }, { name: "End", nameAlign: "right" })
    );
    expect(text(d)).toBe(block(`
┌─ Server ───┐
│            │
└────────────┘
╔═ Dat… ═╗
║        ║
╚════════╝
┌─── Mid ────┐
│            │
└────────────┘
┌────── End ─┐
│            │
└────────────┘
`));
  });

  it("draws borderless labels at their text size", () => {
    const d = withNodes(makeNode({ x: 2, y: 1, w: 1, h: 1 }, { border: "none", autosize: true, text: "a label\nline 2", align: { h: "left", v: "top" } }));
    expect(text(d)).toBe("a label\nline 2");
  });

  it("paints later nodes over earlier ones", () => {
    const d = withNodes(makeNode({ x: 0, y: 0, w: 5, h: 3 }), makeNode({ x: 3, y: 1, w: 4, h: 3 }));
    expect(text(d)).toBe(block(`
┌───┐
│  ┌──┐
└──│  │
   └──┘
`));
  });
});

describe("connectors", () => {
  const a = makeNode({ x: 0, y: 0, w: 5, h: 3 }, { id: "a", text: "A" });
  const b = makeNode({ x: 12, y: 0, w: 5, h: 3 }, { id: "b", text: "B" });
  const att = (node: string) => ({ kind: "attached" as const, node, side: "auto" as const });

  it("joins two boxes side by side with a straight arrow", () => {
    const d = addEdge(withNodes(a, b), makeEdge(att("a"), att("b"), { id: "e" }));
    expect(text(d)).toBe(block(`
┌───┐       ┌───┐
│ A ├──────►│ B │
└───┘       └───┘
`));
  });

  it("re-routes when a box moves, switching sides", () => {
    let d = addEdge(withNodes(a, b), makeEdge(att("a"), att("b"), { id: "e" }));
    d = moveObjects(d, ["b"], { x: -4, y: 6 });
    expect(text(d)).toBe(block(`
┌───┐
│ A │
└─┬─┘
  │
  └───────┐
          ▼
        ┌───┐
        │ B │
        └───┘
`));
  });

  it("draws lines with no arrows and other styles", () => {
    const d = addEdge(withNodes(a, b), makeEdge(att("a"), att("b"), { line: "double", arrows: { start: true, end: false } }));
    expect(text(d)).toBe(block(`
┌───┐       ┌───┐
│ A │◄══════╡ B │
└───┘       └───┘
`));
  });

  it("draws free ends, with the arrow pointing the way the line runs", () => {
    const d = addEdge(withNodes(a), makeEdge(att("a"), { kind: "free", at: { x: 10, y: 5 } }));
    // The point is further right than down (rows count double), so it leaves A's right side.
    expect(text(d)).toBe(block(`
┌───┐
│ A ├─────┐
└───┘     │
          │
          │
          ▼
`));
  });

  it("leaves edges free where they were when their node is deleted", () => {
    let d = addEdge(withNodes(a, b), makeEdge(att("a"), att("b"), { id: "e" }));
    d = deleteObjects(d, ["b"]);
    expect(d.edges.e.to).toEqual({ kind: "free", at: { x: 11, y: 1 } });
    expect(text(d)).toBe(block(`
┌───┐
│ A ├──────►
└───┘
`));
  });

  it("routes around a box in the way", () => {
    const blocker = makeNode({ x: 6, y: 0, w: 3, h: 3 }, { id: "x" });
    const d = addEdge(withNodes(a, b, blocker), makeEdge(att("a"), { kind: "attached", node: "b", side: "left" }));
    expect(text(d)).toBe(block(`
  ┌───────┐
┌─┴─┐ ┌─┐ │ ┌───┐
│ A │ │ │ └►│ B │
└───┘ └─┘   └───┘
`));
  });

  it("exports ASCII only", () => {
    const d = addEdge(withNodes(a, b), makeEdge(att("a"), att("b")));
    expect(text(d, true)).toBe(block(`
+---+       +---+
| A +------>| B |
+---+       +---+
`));
  });
});

describe("line styles and junctions", () => {
  const att = (node: string, side: "auto" | "top" | "bottom" = "auto") => ({ kind: "attached" as const, node, side });
  const box = (id: string, x: number, y: number, border: Node["border"]) => makeNode({ x, y, w: 7, h: 3 }, { id, border });

  it("draws dashed and dotted boxes and connectors", () => {
    let d = withNodes(box("a", 0, 0, "dashed"), box("b", 14, 0, "dotted"));
    d = addEdge(d, makeEdge(att("a"), att("b"), { line: "dashed" }));
    expect(text(d)).toBe(block(`
┌┄┄┄┄┄┐       ┌┈┈┈┈┈┐
┆     ├┄┄┄┄┄┄►┊     ┊
└┄┄┄┄┄┘       └┈┈┈┈┈┘
`));
  });

  it("uses mixed glyphs where styles meet", () => {
    // Single lines into a double box and a heavy box, plain lines (no arrowheads) so they join.
    let d = withNodes(box("a", 0, 0, "single"), box("b", 0, 6, "double"), box("c", 12, 6, "heavy"));
    d = addEdge(d, makeEdge(att("a"), att("b"), { arrows: { start: false, end: false } }));
    d = addEdge(d, makeEdge(att("a"), att("c"), { line: "heavy", arrows: { start: false, end: false } }));
    // Both leave A at the same spot and share a trunk (heavy wins where they overlap); each
    // junction uses the matching mixed glyph: ┰ light/heavy, ┡ heavy/light, ╧ single/double.
    expect(text(d)).toBe(block(`
┌─────┐
│     │
└──┰──┘
   ┃
   ┃
   ┡━━━━━━━━━━━┓
╔══╧══╗     ┏━━┻━━┓
║     ║     ┃     ┃
╚═════╝     ┗━━━━━┛
`));
  });

  it("maps everything to ASCII on request, keeping people's own text", () => {
    const d = withNodes(makeNode({ x: 0, y: 0, w: 9, h: 3 }, { border: "double", text: "café" }));
    expect(text(d, true)).toBe(block(`
+-------+
| café  |
+-------+
`));
  });
});
