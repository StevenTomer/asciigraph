import { describe, expect, it } from "vitest";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode } from "../model/ops";
import type { Diagram, NodeKind } from "../model/types";
import { diagramToText } from "../render/rasterize";
import { importAscii } from "../text/ascii";
import { parseGraph } from "../text/graph";
import { drawSource } from "../text/sync";
import { describe as describeAsText } from "../text/fromDiagram";

const one = (kind: NodeKind, w: number, h: number, text: string, ascii = false) =>
  diagramToText(addNode(emptyDiagram(), makeNode({ x: 0, y: 0, w, h }, { kind, text })), ascii);

describe("hexagon, stacks, queue, actor", () => {
  it("draws each", () => {
    expect(one("hexagon", 14, 4, "prepare")).toBe([
      " ╱──────────╲",
      "╱  prepare   ╲",
      "╲            ╱",
      " ╲──────────╱",
    ].join("\n"));
    expect(one("stack", 13, 4, "workers")).toBe([
      " ┌──────────┐",
      "┌┴─────────┐│",
      "│ workers  ├┘",
      "└──────────┘",
    ].join("\n"));
    // Taller: the one behind is as tall as the front one.
    expect(one("stack", 13, 7, "workers")).toBe([
      " ┌──────────┐",
      "┌┴─────────┐│",
      "│          ││",
      "│ workers  ││",
      "│          ││",
      "│          ├┘",
      "└──────────┘",
    ].join("\n"));
    expect(one("docs", 14, 6, "reports")).toBe([
      " ┌───────────┐",
      "┌┴──────────┐│",
      "│  reports  ││",
      "│           ├┘",
      "╰──╮  ╭──╮  │",
      "   ╰──╯  ╰──╯",
    ].join("\n"));
    expect(one("queue", 16, 3, "orders")).toBe([
      "╭────────────┬─╮",
      "│   orders   │ │",
      "╰────────────┴─╯",
    ].join("\n"));
    expect(one("actor", 4, 4, "User")).toBe([
      " ○",
      "╱│╲",
      "╱ ╲",
      "User",
    ].join("\n"));
    expect(one("actor", 4, 4, "User", true)).toBe([" o", "/|\\", "/ \\", "User"].join("\n"));
  });

  it("read back as themselves, in Unicode and ASCII, sizes and connectors and all", () => {
    const att = (node: string) => ({ kind: "attached" as const, node, side: "auto" as const });
    let d: Diagram = [
      makeNode({ x: 0, y: 0, w: 14, h: 4 }, { id: "h", kind: "hexagon", text: "prepare" }),
      makeNode({ x: 22, y: 0, w: 14, h: 5 }, { id: "s", kind: "stack", text: "workers" }),
      makeNode({ x: 66, y: 0, w: 14, h: 9 }, { id: "s2", kind: "stack", text: "tall" }),
      makeNode({ x: 66, y: 14, w: 14, h: 9 }, { id: "d2", kind: "docs", text: "tall docs" }),
      makeNode({ x: 44, y: 0, w: 16, h: 6 }, { id: "d", kind: "docs", text: "reports" }),
      makeNode({ x: 0, y: 12, w: 16, h: 3 }, { id: "q", kind: "queue", text: "orders" }),
      makeNode({ x: 26, y: 12, w: 8, h: 5 }, { id: "a", kind: "actor", text: "Customer\nAnn" }),
      makeNode({ x: 40, y: 12, w: 16, h: 6 }, { id: "h2", kind: "hexagon", text: "a taller\nhexagon" }),
    ].reduce(addNode, emptyDiagram());
    d = addEdge(d, makeEdge(att("h"), att("s")));
    d = addEdge(d, makeEdge(att("s"), att("d")));
    d = addEdge(d, makeEdge(att("h"), att("q")));
    d = addEdge(d, makeEdge(att("a"), att("q")));
    d = addEdge(d, makeEdge(att("a"), att("h2")));
    d = addEdge(d, makeEdge(att("d"), att("h2")));
    d = addEdge(d, makeEdge(att("s2"), att("d2")));
    d = addEdge(d, makeEdge(att("d"), att("s2")));
    for (const ascii of [false, true]) {
      const text = diagramToText(d, ascii);
      const r = importAscii(text);
      expect(r.warnings).toEqual([]);
      expect(Object.values(r.diagram.nodes).map((n) => n.kind).sort()).toEqual(["actor", "docs", "docs", "hexagon", "hexagon", "queue", "stack", "stack"]);
      expect(Object.keys(r.diagram.edges)).toHaveLength(8);
      expect(diagramToText(r.diagram, ascii)).toBe(text);
    }
  });

  it("come from Mermaid, and are written back as Mermaid", () => {
    const text = `flowchart LR
      A{{prepare}} --> B@{ shape: procs, label: "workers" }
      B --> C@{ shape: docs, label: "reports" }
      C --> D@{ shape: h-cyl, label: "orders" }
      U@{ shape: actor, label: "User" } --> A`;
    const g = parseGraph(text);
    expect(g.nodes.map((n) => [n.id, n.kind])).toEqual([["A", "hexagon"], ["B", "stack"], ["C", "docs"], ["D", "queue"], ["U", "actor"]]);
    const d = drawSource(emptyDiagram(), { kind: "graph", text, options: {} }, { x: 0, y: 0 }).diagram;
    const drawn = diagramToText(d);
    // Drawn, read back, the same.
    expect(diagramToText(importAscii(drawn).diagram)).toBe(drawn);
    const back = describeAsText(d, [...Object.keys(d.nodes), ...Object.keys(d.edges)])!;
    expect(back.text).toContain("{{prepare}}");
    expect(back.text).toContain("shape: procs");
    expect(back.text).toContain("shape: docs");
    expect(back.text).toContain("shape: h-cyl");
    expect(back.text).toContain("shape: actor");
  });
});

describe("trapezoid, delay, folder", () => {
  it("draws each", () => {
    expect(one("trapezoid", 14, 3, "by hand")).toBe([
      "╲────────────╱",
      " ╲ by hand  ╱",
      "  ╲────────╱",
    ].join("\n"));
    expect(diagramToText(addNode(emptyDiagram(), makeNode({ x: 0, y: 0, w: 14, h: 3 }, { kind: "trapezoid", text: "priority", flip: true })))).toBe([
      "  ╱────────╲",
      " ╱ priority ╲",
      "╱────────────╲",
    ].join("\n"));
    expect(one("delay", 12, 3, "wait")).toBe([
      "┌──────────╮",
      "│   wait   )",
      "└──────────╯",
    ].join("\n"));
    expect(one("folder", 16, 4, "billing")).toBe([
      "┌──────┐",
      "│      └───────┐",
      "│   billing    │",
      "└──────────────┘",
    ].join("\n"));
  });

  it("read back as themselves, in Unicode and ASCII", () => {
    const att = (node: string) => ({ kind: "attached" as const, node, side: "auto" as const });
    let d: Diagram = [
      makeNode({ x: 0, y: 0, w: 14, h: 3 }, { id: "t", kind: "trapezoid", text: "by hand" }),
      makeNode({ x: 20, y: 0, w: 14, h: 3 }, { id: "f", kind: "trapezoid", text: "priority", flip: true }),
      makeNode({ x: 40, y: 0, w: 12, h: 3 }, { id: "d", kind: "delay", text: "wait" }),
      makeNode({ x: 0, y: 8, w: 16, h: 4 }, { id: "fo", kind: "folder", text: "billing" }),
      makeNode({ x: 24, y: 8, w: 18, h: 5 }, { id: "t2", kind: "trapezoid", text: "taller\none" }),
      makeNode({ x: 46, y: 8, w: 14, h: 5 }, { id: "d2", kind: "delay", text: "longer\nwait", border: "rounded" }),
      makeNode({ x: 0, y: 16, w: 30, h: 6 }, { id: "fo2", kind: "folder", text: "a wide folder" }),
    ].reduce(addNode, emptyDiagram());
    d = addEdge(d, makeEdge(att("t"), att("f")));
    d = addEdge(d, makeEdge(att("f"), att("d")));
    d = addEdge(d, makeEdge(att("t"), att("fo")));
    d = addEdge(d, makeEdge(att("fo"), att("t2")));
    d = addEdge(d, makeEdge(att("d"), att("d2")));
    for (const ascii of [false, true]) {
      const text = diagramToText(d, ascii);
      const r = importAscii(text);
      expect(r.warnings).toEqual([]);
      const kinds = Object.values(r.diagram.nodes).map((n) => n.kind + (n.flip ? " flipped" : "")).sort();
      expect(kinds).toEqual(["delay", "delay", "folder", "folder", "trapezoid", "trapezoid", "trapezoid flipped"]);
      expect(Object.keys(r.diagram.edges)).toHaveLength(5);
      expect(diagramToText(r.diagram, ascii)).toBe(text);
    }
  });

  it("come from Mermaid and DOT, and are written back as Mermaid", () => {
    const text = `flowchart LR
      A[\\by hand/] --> B[/priority\\]
      B --> C@{ shape: delay, label: "wait" }
      C --> D@{ shape: folder, label: "billing" }
      D --> E@{ shape: trap-t, label: "manual" }`;
    const g = parseGraph(text);
    expect(g.warnings).toEqual([]);
    expect(g.nodes.map((n) => [n.id, n.kind, !!n.flip])).toEqual([
      ["A", "trapezoid", false], ["B", "trapezoid", true], ["C", "delay", false], ["D", "folder", false], ["E", "trapezoid", false],
    ]);
    const dot = parseGraph(`digraph { a [shape=trapezium]; b [shape=invtrapezium]; c [shape=folder]; a -> b -> c }`);
    expect(dot.nodes.map((n) => [n.id, n.kind, !!n.flip])).toEqual([["a", "trapezoid", true], ["b", "trapezoid", false], ["c", "folder", false]]);
    const d = drawSource(emptyDiagram(), { kind: "graph", text, options: {} }, { x: 0, y: 0 }).diagram;
    const drawn = diagramToText(d);
    expect(diagramToText(importAscii(drawn).diagram)).toBe(drawn);
    const back = describeAsText(d, [...Object.keys(d.nodes), ...Object.keys(d.edges)])!.text;
    expect(back).toContain("[\\by hand/]");
    expect(back).toContain("[/priority\\]");
    expect(back).toContain("shape: delay");
    expect(back).toContain("shape: folder");
  });
});
