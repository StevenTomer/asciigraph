import { describe, expect, it } from "vitest";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode, updateNode } from "../model/ops";
import { diagramToText } from "../render/rasterize";

const att = (node: string, extra = {}) => ({ kind: "attached" as const, node, side: "auto" as const, ...extra });
const show = (d: Parameters<typeof diagramToText>[0]) => "\n" + diagramToText(d) + "\n";

describe("flowchart shapes", () => {
  it("draws a small flowchart", () => {
    let d = [
      makeNode({ x: 6, y: 0, w: 14, h: 3 }, { id: "s", kind: "terminal", text: "Start" }),
      makeNode({ x: 4, y: 6, w: 18, h: 3 }, { id: "i", kind: "io", text: "read order" }),
      makeNode({ x: 5, y: 12, w: 16, h: 5 }, { id: "q", kind: "decision", text: "in stock?" }),
      makeNode({ x: 30, y: 13, w: 12, h: 3 }, { id: "y", text: "ship" }),
      makeNode({ x: 6, y: 21, w: 14, h: 3 }, { id: "e", kind: "terminal", text: "End" }),
    ].reduce(addNode, emptyDiagram());
    d = addEdge(d, makeEdge(att("s"), att("i")));
    d = addEdge(d, makeEdge(att("i"), att("q")));
    d = addEdge(d, makeEdge(att("q"), att("y"), { label: "yes" }));
    d = addEdge(d, makeEdge(att("q"), att("e"), { label: "no" }));
    expect(show(d)).toBe(`
  ╭────────────╮
  (   Start    )
  ╰─────┬──────╯
        │
        │
        ▼
  ╱──────────────╱
 ╱  read order  ╱
╱───────┬──────╱
        │
        │
        ▼
   ╱──────────╲
  ╱            ╲          ┌──────────┐
 <  in stock?   >── yes ─►│   ship   │
  ╲            ╱          └──────────┘
   ╲────┬─────╱
        │
        │ no
        │
        ▼
  ╭────────────╮
  (    End     )
  ╰────────────╯
`);
  });

  it("keeps decisions an odd height, and draws ASCII outlines with slashes", () => {
    let d = addNode(emptyDiagram(), makeNode({ x: 0, y: 0, w: 10, h: 4 }, { id: "q", kind: "decision", border: "ascii", text: "ok?" }));
    expect(d.nodes.q.rect.h).toBe(5);
    d = updateNode(d, "q", { rect: { x: 0, y: 0, w: 10, h: 3 } });
    expect(show(d)).toBe(String.raw`
 /------\
<  ok?   >
 \------/
`);
  });
});

describe("sequence diagrams", () => {
  it("draws lifelines with messages at their rows", () => {
    let s = [
      makeNode({ x: 0, y: 0, w: 12, h: 14 }, { id: "c", kind: "lifeline", text: "Client" }),
      makeNode({ x: 20, y: 0, w: 12, h: 14 }, { id: "a", kind: "lifeline", text: "API" }),
      makeNode({ x: 40, y: 0, w: 12, h: 14 }, { id: "db", kind: "lifeline", text: "DB" }),
    ].reduce(addNode, emptyDiagram());
    s = addEdge(s, makeEdge(att("c", { offset: 5 }), att("a", { offset: 5 }), { label: "GET /x" }));
    s = addEdge(s, makeEdge(att("a", { offset: 7 }), att("db", { offset: 7 }), { label: "query" }));
    s = addEdge(s, makeEdge(att("db", { offset: 9 }), att("a", { offset: 9 }), { line: "dashed" }));
    s = addEdge(s, makeEdge(att("a", { offset: 11 }), att("c", { offset: 11 }), { line: "dashed", label: "200" }));
    expect(show(s)).toBe(`
┌──────────┐        ┌──────────┐        ┌──────────┐
│  Client  │        │   API    │        │    DB    │
└────┬─────┘        └────┬─────┘        └────┬─────┘
     ┆                   ┆                   ┆
     ┆                   ┆                   ┆
     ├───── GET /x ─────►┆                   ┆
     ┆                   ┆                   ┆
     ┆                   ├────── query ─────►┆
     ┆                   ┆                   ┆
     ┆                   ┆◄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┤
     ┆                   ┆                   ┆
     ┆◄┄┄┄┄┄┄ 200 ┄┄┄┄┄┄┄┤                   ┆
     ┆                   ┆                   ┆
     ┆                   ┆                   ┆
`);
  });

  it("loops a message back to the same lifeline", () => {
    let s = addNode(emptyDiagram(), makeNode({ x: 0, y: 0, w: 10, h: 10 }, { id: "a", kind: "lifeline", text: "A" }));
    s = addEdge(s, makeEdge(att("a", { side: "right", offset: 4 }), att("a", { side: "right", offset: 6 }), { label: "retry" }));
    expect(show(s)).toBe(`
┌────────┐
│   A    │
└───┬────┘
    ┆
    ├──┐
    ┆  │ retry
    ┆◄─┘
    ┆
    ┆
    ┆
`);
  });
});

describe("more shapes", () => {
  it("draws database, document, subroutine and note", () => {
    const d = [
      makeNode({ x: 0, y: 0, w: 14, h: 5 }, { kind: "database", text: "orders" }),
      makeNode({ x: 16, y: 0, w: 16, h: 5 }, { kind: "document", text: "report" }),
      makeNode({ x: 34, y: 0, w: 18, h: 3 }, { kind: "subroutine", text: "validate" }),
      makeNode({ x: 54, y: 0, w: 16, h: 4 }, { kind: "note", text: "remember to log this" }),
    ].reduce(addNode, emptyDiagram());
    expect(show(d)).toBe(`
╭────────────╮  ┌──────────────┐  ┌─┬────────────┬─┐  ┌─────────────┬╮
├────────────┤  │    report    │  │ │  validate  │ │  │ remember to ╰┤
│   orders   │  │              │  └─┴────────────┴─┘  │  log this    │
│            │  ╰──╮  ╭──╮  ╭──╯                      └──────────────┘
╰────────────╯     ╰──╯  ╰──╯
`);
  });

  it("puts activation bars on lifelines, with messages at rows", () => {
    let s = [
      makeNode({ x: 0, y: 0, w: 12, h: 14 }, { id: "c", kind: "lifeline", text: "Client" }),
      makeNode({ x: 20, y: 0, w: 12, h: 14 }, { id: "a", kind: "lifeline", text: "API" }),
      makeNode({ x: 25, y: 5, w: 3, h: 7 }, { id: "act", kind: "activation" }),
    ].reduce(addNode, emptyDiagram());
    s = addEdge(s, makeEdge(att("c", { offset: 6 }), att("act", { offset: 1 }), { label: "call" }));
    s = addEdge(s, makeEdge(att("act", { offset: 5 }), att("c", { offset: 10 }), { line: "dashed", label: "result", labelAt: 0.2 }));
    expect(show(s)).toBe(`
┌──────────┐        ┌──────────┐
│  Client  │        │   API    │
└────┬─────┘        └────┬─────┘
     ┆                   ┆
     ┆                   ┆
     ┆                   ┌┴┐
     ├────── call ──────►│ │
     ┆                   │ │
     ┆                   │ │
     ┆                   │ │
     ┆◄┄┄┄┄┄┄┄┄┄ result ┄┤ │
     ┆                   └┬┘
     ┆                   ┆
     ┆                   ┆
`);
  });
});
