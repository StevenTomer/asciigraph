import { describe, expect, it } from "vitest";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode } from "../model/ops";
import type { NodeKind } from "../model/types";
import { diagramToText } from "../render/rasterize";
import { importAscii } from "../text/ascii";
import { parseGraph } from "../text/graph";
import { drawSource } from "../text/sync";
import { describe as describeAsText } from "../text/fromDiagram";

const one = (kind: NodeKind, w: number, h: number, text: string, ascii = false) =>
  diagramToText(addNode(emptyDiagram(), makeNode({ x: 0, y: 0, w, h }, { kind, text })), ascii);

/** Each shape, in two sizes. */
const SHAPES: [NodeKind, number, number, string][] = [
  ["component", 16, 7, "payments"], ["component", 20, 9, "a bigger\ncomponent"], ["cloud", 17, 5, "internet"], ["cloud", 25, 7, "a bigger cloud"],
  ["card", 14, 4, "card"], ["card", 12, 3, "low"], ["loop", 16, 3, "each order"], ["loop", 18, 5, "taller"],
  ["display", 16, 3, "screen"], ["display", 18, 5, "tall"], ["stored", 16, 3, "archive"], ["stored", 18, 5, "tall"],
  ["divided", 14, 4, "divided"], ["divided", 18, 6, "taller"], ["lined", 14, 3, "lined"], ["lined", 18, 5, "taller"],
  ["storage", 14, 4, "storage"], ["storage", 18, 6, "taller"], ["flag", 14, 3, "flag"], ["flag", 16, 5, "tall"],
  ["tape", 16, 5, "paper tape"], ["tape", 23, 6, "a longer tape"], ["manual", 16, 5, "type it in"], ["manual", 22, 7, "taller"],
  ["disk", 12, 5, "disk"], ["disk", 16, 7, "taller"], ["lineddoc", 14, 5, "lined"], ["lineddoc", 20, 6, "taller"],
  ["summary", 3, 3, ""], ["extract", 10, 5, "x"], ["extract", 14, 7, "out"], ["merge", 10, 5, "x"], ["merge", 14, 7, "in"],
  ["collate", 5, 5, ""], ["collate", 9, 9, ""], ["dot", 1, 1, ""], ["ring", 1, 1, ""],
];

describe("more shapes", () => {
  it("draws them", () => {
    expect(one("component", 16, 7, "payments")).toBe([
      "  ┌────────────┐",
      "┌─┤            │",
      "└─┤            │",
      "  │  payments  │",
      "┌─┤            │",
      "└─┤            │",
      "  └────────────┘",
    ].join("\n"));
    expect(one("cloud", 17, 5, "internet")).toBe([
      "  ╭────╮ ╭────╮",
      "╭─╯    ╰─╯    ╰─╮",
      "│   internet    │",
      "╰─╮    ╭─╮    ╭─╯",
      "  ╰────╯ ╰────╯",
    ].join("\n"));
    expect(one("display", 16, 3, "screen")).toBe([" ╱─────────────╮", "<    screen    )", " ╲─────────────╯"].join("\n"));
    expect(one("loop", 16, 3, "each order", true)).toBe([" /------------\\", "|  each order  |", "+--------------+"].join("\n"));
    expect(one("summary", 3, 3, "")).toBe(["╭─╮", "│╳│", "╰─╯"].join("\n"));
  });

  it("read back as themselves, in Unicode and ASCII, with connectors", () => {
    for (const ascii of [false, true]) {
      for (const [kind, w, h, text] of SHAPES) {
        // (In ASCII, a divided box looks just like a database, which it reads back as.)
        if (ascii && kind === "divided") continue;
        let d = addNode(emptyDiagram(), makeNode({ x: 0, y: 4, w, h }, { id: "a", kind, text }));
        d = addNode(d, makeNode({ x: w + 8, y: 4, w: 8, h: 3 }, { id: "b", text: "next" }));
        d = addNode(d, makeNode({ x: 0, y: h + 12, w: 8, h: 3 }, { id: "c", text: "below" }));
        d = addEdge(d, makeEdge({ kind: "attached", node: "a", side: "auto" }, { kind: "attached", node: "b", side: "auto" }));
        d = addEdge(d, makeEdge({ kind: "attached", node: "a", side: "auto" }, { kind: "attached", node: "c", side: "auto" }));
        const drawn = diagramToText(d, ascii);
        const r = importAscii(drawn);
        expect(r.warnings, `${kind} ${w}x${h} ${ascii ? "ASCII" : ""}`).toEqual([]);
        expect(Object.values(r.diagram.nodes).map((n) => n.kind), `${kind} ${w}x${h}`).toContain(kind);
        expect(Object.keys(r.diagram.edges), `${kind} ${w}x${h}`).toHaveLength(2);
        expect(diagramToText(r.diagram, ascii), `${kind} ${w}x${h} ${ascii ? "ASCII" : ""}`).toBe(drawn);
      }
    }
  });

  it("come from Mermaid's names, and are written back as them", () => {
    const names: [string, NodeKind][] = [
      ["notch-rect", "card"], ["notch-pent", "loop"], ["curv-trap", "display"], ["bow-rect", "stored"], ["div-rect", "divided"],
      ["lin-rect", "lined"], ["win-pane", "storage"], ["odd", "flag"], ["flag", "tape"], ["sl-rect", "manual"], ["lin-cyl", "disk"],
      ["lin-doc", "lineddoc"], ["cross-circ", "summary"], ["tri", "extract"], ["flip-tri", "merge"], ["hourglass", "collate"],
      ["cloud", "cloud"], ["f-circ", "dot"], ["sm-circ", "dot"], ["fr-circ", "ring"], ["component", "component"],
    ];
    const text = "flowchart LR\n" + names.map(([name], i) => `  N${i}@{ shape: ${name}, label: "n${i}" }`).join("\n") + "\n  Z>flag]";
    const g = parseGraph(text);
    expect(g.warnings).toEqual([]);
    expect(g.nodes.map((n) => n.kind)).toEqual([...names.map(([, k]) => k), "flag"]);
    const d = drawSource(emptyDiagram(), { kind: "graph", text, options: {} }, { x: 0, y: 0 }).diagram;
    const back = describeAsText(d, Object.keys(d.nodes))!.text;
    expect(back).toContain(">flag]");
    expect(back).toContain("shape: notch-pent");
    expect(back).toContain("shape: hourglass");
    // Drawn, read back, the same.
    const drawn = diagramToText(d);
    expect(diagramToText(importAscii(drawn).diagram)).toBe(drawn);
  });

  it("draws a state diagram's start and end as dots, which read back as dots", () => {
    const d = drawSource(emptyDiagram(), { kind: "graph", text: "stateDiagram-v2\n  [*] --> Idle\n  Idle --> [*]", options: {} }, { x: 0, y: 0 }).diagram;
    expect(Object.values(d.nodes).map((n) => n.kind).sort()).toEqual(["box", "dot", "ring"]);
    const drawn = diagramToText(d);
    const back = importAscii(drawn).diagram;
    expect(Object.values(back.nodes).map((n) => n.kind).sort()).toEqual(["box", "dot", "ring"]);
    expect(diagramToText(back)).toBe(drawn);
  });
});
