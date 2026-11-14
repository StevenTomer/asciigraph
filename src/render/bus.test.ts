import { describe, expect, it } from "vitest";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode } from "../model/ops";
import type { Diagram, Edge, Endpoint } from "../model/types";
import { importAscii } from "../text/ascii";
import { diagramToText } from "./rasterize";

const att = (node: string): Endpoint => ({ kind: "attached", node, side: "auto" });
const box = (id: string, x: number, y: number, w = 7, h = 5) => makeNode({ x, y, w, h }, { id, text: id });
const bus = (boxes: ReturnType<typeof box>[], edge: Partial<Edge> = {}, from = att("A"), to = att("B")): Diagram =>
  addEdge(boxes.reduce(addNode, emptyDiagram()), makeEdge(from, to, { line: "bus", ...edge }));
const show = (d: Diagram, ascii = false) => "\n" + diagramToText(d, ascii) + "\n";
const side = (edge: Partial<Edge> = {}) => bus([box("A", 0, 0), box("B", 20, 0)], edge);

describe("bus connectors", () => {
  it("is a band three cells wide, joined to the box it leaves, with a wide arrowhead and the label inside", () => {
    expect(show(side({ label: "data" }))).toBe(`
┌─────┐             ┌─────┐
│     ┝━━━━━━━━━━━━╲│     │
│  A  │    data    ►│  B  │
│     ┝━━━━━━━━━━━━╱│     │
└─────┘             └─────┘
`);
  });

  it("goes up and down, and turns as two bends", () => {
    expect(show(bus([box("A", 0, 0), box("B", 0, 10)]))).toBe(`
┌─────┐
│     │
│  A  │
│     │
└─┰─┰─┘
  ┃ ┃
  ┃ ┃
  ┃ ┃
  ┃ ┃
  ╲▼╱
┌─────┐
│     │
│  B  │
│     │
└─────┘
`);
    expect(show(bus([box("A", 0, 0), box("B", 20, 10)]))).toBe(`
┌─────┐
│     ┝━━━━━━┓
│  A  │      ┃
│     ┝━━━━┓ ┃
└─────┘    ┃ ┃
           ┃ ┃
           ┃ ┃
           ┃ ┃
           ┃ ┃
           ┃ ┃
           ┃ ┃      ┌─────┐
           ┃ ┗━━━━━╲│     │
           ┃       ►│  B  │
           ┗━━━━━━━╱│     │
                    └─────┘
`);
  });

  it("caps other heads, and has a crossbar for a bar", () => {
    expect(show(side({ arrows: { start: true, end: true }, heads: { start: "diamond", end: "dot" } }))).toBe(`
┌─────┐             ┌─────┐
│     │┏━━━━━━━━━━━┓│     │
│  A  │◆           ●│  B  │
│     │┗━━━━━━━━━━━┛│     │
└─────┘             └─────┘
`);
    expect(show(side({ arrows: { start: true, end: true }, heads: { start: "bar", end: "triangle" } }))).toBe(`
┌─────┐             ┌─────┐
│     │┃━━━━━━━━━━━╲│     │
│  A  │┃           ▷│  B  │
│     │┃━━━━━━━━━━━╱│     │
└─────┘             └─────┘
`);
  });

  it("keeps a box's corners as corners", () => {
    expect(show(bus([box("A", 0, 0, 7, 3), box("B", 20, 0, 7, 3)]))).toBe(`
┌─────┐━━━━━━━━━━━━╲┌─────┐
│  A  │            ►│  B  │
└─────┘━━━━━━━━━━━━╱└─────┘
`);
  });

  it("keeps clear of boxes in the way, with room to turn before its head", () => {
    expect(show(bus([box("A", 0, 4), box("C", 14, 3, 7, 7), box("B", 30, 4)]))).toBe(`
  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
  ┃                               ┃
  ┃ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ┃
  ┃ ┃                           ┃ ┃
  ┃ ┃         ┌─────┐           ╲▼╱
┌─┸─┸─┐       │     │         ┌─────┐
│     │       │     │         │     │
│  A  │       │  C  │         │  B  │
│     │       │     │         │     │
└─────┘       │     │         └─────┘
              └─────┘
`);
  });

  it("has an ASCII form", () => {
    expect(show(side({ arrows: { start: true, end: true }, heads: { start: "bar" } }), true)).toBe(`
+-----+             +-----+
|     ||-----------\\|     |
|  A  ||           >|  B  |
|     ||-----------/|     |
+-----+             +-----+
`);
  });

  it("reads back from the drawing, the same", () => {
    const free = (x: number, y: number): Endpoint => ({ kind: "free", at: { x, y } });
    let crossed = [box("A", 0, 0), box("B", 24, 0), box("C", 12, 10), box("D", 12, -10)].reduce(addNode, emptyDiagram());
    crossed = addEdge(crossed, makeEdge(att("A"), att("B"), { line: "bus", label: "bus" }));
    crossed = addEdge(crossed, makeEdge(att("D"), att("C")));
    const cases: [Diagram, boolean?][] = [
      [side({ label: "data" })],
      [side({ arrows: { start: true, end: true } })],
      [side({ arrows: { start: true, end: true }, heads: { start: "diamond", end: "dot" } })],
      [side({ arrows: { start: true, end: true }, heads: { start: "bar", end: "triangle" } })],
      [side({ arrows: { start: true, end: true }, heads: { start: "bar" } }), true],
      [bus([box("A", 0, 0, 7, 3), box("B", 20, 0, 7, 3)])],
      [bus([box("A", 0, 0), box("B", 0, 10)], { label: "down" })],
      [bus([box("A", 0, 0), box("B", 30, 12)], { label: "bus" })],
      [bus([box("A", 0, 0), box("B", 20, 10)]), true],
      [bus([box("A", 0, 4), box("C", 14, 3, 7, 7), box("B", 30, 4)])],
      [bus([], {}, free(2, 2), free(20, 8))],
      [bus([box("A", 0, 0)], { arrows: { start: false, end: false } }, att("A"), free(20, 8))],
      [crossed],
    ];
    for (const [d, ascii] of cases) {
      const text = diagramToText(d, ascii);
      const back = importAscii(text).diagram;
      expect(diagramToText(back, ascii)).toBe(text);
      expect(Object.values(back.edges).filter((e) => e.line === "bus")).toHaveLength(1);
    }
  });
});
