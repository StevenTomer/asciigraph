import { describe, expect, it } from "vitest";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode } from "../model/ops";
import type { Diagram, Edge, Node } from "../model/types";
import { diagramToText } from "./rasterize";

const show = (d: Diagram) => "\n" + diagramToText(d) + "\n";
const att = (node: string, side: "auto" | "top" | "bottom" | "left" | "right" = "auto") => ({ kind: "attached" as const, node, side });
const box = (id: string, x: number, y: number, w = 7, h = 3) => makeNode({ x, y, w, h }, { id, text: id });
const build = (nodes: Node[], edges: Edge[]) => edges.reduce(addEdge, nodes.reduce(addNode, emptyDiagram()));

describe("labels", () => {
  it("sits inline on a horizontal run", () => {
    const d = build([box("A", 0, 0), box("B", 20, 0)], [makeEdge(att("A"), att("B"), { label: "yes" })]);
    expect(show(d)).toBe(`
┌─────┐             ┌─────┐
│  A  ├──── yes ───►│  B  │
└─────┘             └─────┘
`);
  });

  it("goes beside a vertical connector", () => {
    const d = build([box("A", 0, 0), box("B", 0, 8)], [makeEdge(att("A"), att("B"), { label: "no" })]);
    expect(show(d)).toBe(`
┌─────┐
│  A  │
└──┬──┘
   │
   │
   │ no
   │
   ▼
┌─────┐
│  B  │
└─────┘
`);
  });
});

describe("bend points", () => {
  it("routes through them in order", () => {
    // A bend point below and between: the route goes down to it, then up into B's facing side.
    const d = build([box("A", 0, 0), box("B", 20, 0)], [
      makeEdge(att("A"), att("B"), { via: [{ x: 10, y: 6 }] }),
    ]);
    expect(show(d)).toBe(`
┌─────┐             ┌─────┐
│  A  │   ┌────────►│  B  │
└──┬──┘   │         └─────┘
   │      │
   │      │
   │      │
   └──────┘
`);
  });
});

describe("routing around other connectors", () => {
  it("keeps unrelated connectors from running on top of each other", () => {
    // Both Z-shapes would put their vertical leg in the middle column; the second moves over one.
    const d = build([box("A", 0, 0), box("B", 30, 8), box("C", 0, 4), box("D", 30, 12)], [
      makeEdge(att("A"), att("B")),
      makeEdge(att("C"), att("D")),
    ]);
    expect(show(d)).toBe(`
┌─────┐
│  A  ├───────────┐
└─────┘           │
                  │
┌─────┐           │
│  C  ├──────────┐│
└─────┘          ││
                 ││
                 ││           ┌─────┐
                 │└──────────►│  B  │
                 │            └─────┘
                 │
                 │            ┌─────┐
                 └───────────►│  D  │
                              └─────┘
`);
  });

  it("lets connectors from the same spot share a trunk", () => {
    const d = build([box("A", 10, 0), box("B", 0, 8), box("C", 10, 8), box("D", 20, 8)], [
      makeEdge(att("A"), att("B")),
      makeEdge(att("A"), att("C")),
      makeEdge(att("A"), att("D")),
    ]);
    expect(show(d)).toBe(`
          ┌─────┐
          │  A  │
          └──┬──┘
             │
             │
   ┌─────────┼─────────┐
   │         │         │
   ▼         ▼         ▼
┌─────┐   ┌─────┐   ┌─────┐
│  B  │   │  C  │   │  D  │
└─────┘   └─────┘   └─────┘
`);
  });
});

describe("multi-line labels", () => {
  it("centers a block on a horizontal connector, and lists beside a vertical one", () => {
    let d = [box("A", 0, 3), box("B", 30, 3), box("C", 0, 16)].reduce(addNode, emptyDiagram());
    d = addEdge(d, makeEdge(att("A"), att("B"), { label: "two\nlines" }));
    d = addEdge(d, makeEdge(att("A"), att("C"), { label: "checks:\n- stock\n- price" }));
    expect(show(d)).toBe(`
┌─────┐                       ┌─────┐
│  A  ├───────── two ────────►│  B  │
└──┬──┘         lines         └─────┘
   │
   │
   │
   │ checks:
   │ • stock
   │ • price
   │
   │
   │
   ▼
┌─────┐
│  C  │
└─────┘
`);
  });
});
