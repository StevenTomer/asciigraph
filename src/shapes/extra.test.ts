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
