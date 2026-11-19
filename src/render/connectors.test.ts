import { describe, expect, it } from "vitest";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode } from "../model/ops";
import type { Diagram, Edge, Node } from "../model/types";
import { diagramToText } from "./rasterize";
import { importAscii } from "../text/ascii";

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

  it("goes on the side asked for, and reads back there", () => {
    const across = (labelSide: Edge["labelSide"], line: Edge["line"] = "single") =>
      build([box("A", 0, 0), box("B", 20, 8)], [makeEdge(att("A"), att("B"), { label: "yes", labelSide, line })]);
    expect(show(across("top"))).toBe(`
┌─────┐    yes
│  A  ├──────────┐
└─────┘          │
                 │
                 │
                 │
                 │
                 │
                 │  ┌─────┐
                 └─►│  B  │
                    └─────┘
`);
    expect(show(across("bottom")).split("\n")[3]).toBe("└─────┘    yes   │");
    expect(show(across("left")).split("\n")[6]).toBe("             yes │");
    expect(show(across("right")).split("\n")[6]).toBe("                 │ yes");
    const side = build([box("A", 0, 0), box("B", 20, 0)], [makeEdge(att("A"), att("B"), { label: "yes", labelSide: "top", line: "bus" })]);
    expect(show(side)).toBe(`
            yes
┌─────┐━━━━━━━━━━━━╲┌─────┐
│  A  │            ►│  B  │
└─────┘━━━━━━━━━━━━╱└─────┘
`);
    const down = build([box("A", 0, 0), box("B", 0, 8)], [makeEdge(att("A"), att("B"), { label: "no", labelSide: "left" })]);
    expect(show(down).split("\n")[6]).toBe("no │");
    for (const d of [across("top"), across("bottom"), across("left"), across("right"), side, down]) {
      const text = diagramToText(d);
      const back = importAscii(text).diagram;
      expect(diagramToText(back)).toBe(text);
      expect(Object.values(back.edges).map((e) => e.label)).toEqual([Object.values(d.edges)[0].label]);
    }
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

describe("end labels", () => {
  it("sit by each end: above a line leaving sideways, beside one leaving up or down", () => {
    const across = build([box("A", 0, 0), box("B", 24, 0)], [makeEdge(att("A"), att("B"), { label: "has", endLabels: { start: "1", end: "0..*" } })]);
    expect(show(across)).toBe(`
┌─────┐ 1          0..* ┌─────┐
│  A  ├────── has ─────►│  B  │
└─────┘                 └─────┘
`);
    const down = build([box("A", 0, 0), box("B", 0, 8)], [makeEdge(att("A"), att("B"), { endLabels: { start: "1", end: "*" } })]);
    expect(show(down)).toBe(`
┌─────┐
│  A  │
└──┬──┘
   │ 1
   │
   │
   │
   ▼ *
┌─────┐
│  B  │
└─────┘
`);
  });

  it("stay by their boxes when the connector is reversed", async () => {
    const { reverseEdge } = await import("../model/arrange");
    const d = build([box("A", 0, 0), box("B", 24, 0)], [makeEdge(att("A"), att("B"), { id: "e", endLabels: { start: "1" } })]);
    const r = reverseEdge(d, "e");
    expect(r.edges.e.endLabels).toEqual({ end: "1" });
    expect(diagramToText(r).split("\n")[0]).toBe("┌─────┐ 1               ┌─────┐");
  });
});

describe("loops back to the same box", () => {
  const pin = (side: "top" | "bottom" | "left" | "right", offset: number) => ({ kind: "attached" as const, node: "A", side, offset });
  const loop = (from: ReturnType<typeof pin>, to: ReturnType<typeof pin>) =>
    show(build([makeNode({ x: 4, y: 3, w: 12, h: 5 }, { id: "A", text: "box" })], [makeEdge(from, to, { arrows: { start: false, end: true } })]));

  it("goes round the corner from one side to another, clear of the border", () => {
    expect(loop(pin("right", 1), pin("top", 6))).toBe(`
      ┌──────┐
      ▼      │
┌──────────┐ │
│          ├─┘
│   box    │
│          │
└──────────┘
`);
  });

  it("goes along a side, or round to the opposite side", () => {
    expect(loop(pin("right", 1), pin("right", 3))).toBe(`
┌──────────┐
│          ├─┐
│   box    │ │
│          │◄┘
└──────────┘
`);
    expect(loop(pin("left", 2), pin("right", 2))).toBe(`
┌──────────────┐
│              │
│ ┌──────────┐ │
│ │          │ │
└─┤   box    │◄┘
  │          │
  └──────────┘
`);
  });
});

describe("an end at a point inside its box", () => {
  const A = makeNode({ x: 0, y: 0, w: 7, h: 3 }, { id: "A", text: "A" });
  const B = makeNode({ x: 20, y: 0, w: 16, h: 7 }, { id: "B", text: "" });
  const inB = (inside: { x: number; y: number }) =>
    show(build([A, B], [makeEdge(att("A"), { ...att("B"), inside }, { arrows: { start: false, end: true } })]));

  it("comes in through the facing side, crossing the border, and runs on to the point", () => {
    expect(inB({ x: 3, y: 1 })).toBe(`
┌─────┐             ┌──────────────┐
│  A  ├─────────────┼──►           │
└─────┘             │              │
                    │              │
                    │              │
                    │              │
                    └──────────────┘
`);
    expect(inB({ x: 10, y: 5 })).toBe(`
┌─────┐             ┌──────────────┐
│  A  ├──────┐      │              │
└─────┘      │      │              │
             │      │              │
             │      │              │
             └──────┼─────────►    │
                    └──────────────┘
`);
  });

  it("is kept inside the box (a point past its border after a resize)", () => {
    expect(inB({ x: 40, y: 1 })).toContain("┼─────────────►│");
  });
});
