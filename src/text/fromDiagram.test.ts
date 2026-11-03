import { describe as group, expect, it } from "vitest";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode } from "../model/ops";
import type { Diagram } from "../model/types";
import { diagramToText } from "../render/rasterize";
import { describe } from "./fromDiagram";
import { adopt, updateSource } from "./sync";

const att = (node: string, extra = {}) => ({ kind: "attached" as const, node, side: "auto" as const, ...extra });
const all = (d: Diagram) => [...Object.keys(d.nodes), ...Object.keys(d.edges)];

function handGraph() {
  let d = [
    makeNode({ x: 0, y: 0, w: 12, h: 3 }, { id: "a", kind: "terminal", text: "Start" }),
    makeNode({ x: 30, y: 1, w: 16, h: 5 }, { id: "b", kind: "decision", text: "ok?" }),
    makeNode({ x: 4, y: 12, w: 20, h: 5 }, { id: "c", text: "Todo:\n- one\n- two" }),
    makeNode({ x: 40, y: 14, w: 14, h: 4 }, { id: "doc", kind: "document", text: "report" }),
    makeNode({ x: 40, y: 22, w: 9, h: 1 }, { id: "lbl", border: "none", text: "a \"note\"" }),
  ].reduce(addNode, emptyDiagram());
  d = addEdge(d, makeEdge(att("a"), att("b"), { id: "e1" }));
  d = addEdge(d, makeEdge(att("b"), att("c"), { id: "e2", label: "yes", line: "dashed" }));
  d = addEdge(d, makeEdge(att("b"), att("doc"), { id: "e3", arrows: { start: true, end: false } }));
  d = addEdge(d, makeEdge(att("c"), { kind: "free", at: { x: 2, y: 30 } }, { id: "loose" }));
  return d;
}

group("writing Mermaid from a drawing", () => {
  it("writes a flowchart: shapes, multi-line lists, labels, styles, reversed arrows", () => {
    const desc = describe(handGraph(), all(handGraph()))!;
    expect(desc.kind).toBe("graph");
    expect(desc.text).toBe(`flowchart LR
  Start([Start])
  ok{ok?}
  Todo["\`Todo:
    - one
    - two\`"]
  report@{ shape: doc, label: "report" }
  a_note@{ shape: text, label: "a #quot;note#quot;" }
  Start --> ok
  ok -.->|yes| Todo
  report --> ok`);
    // The loose connector can't be written: it stays out.
    expect(desc.keys.has("loose")).toBe(false);
  });

  it("links a drawing to its text without changing it; text edits then redraw", () => {
    const d = handGraph();
    const before = diagramToText(d);
    const a = adopt(d, all(d))!;
    expect(diagramToText(a.diagram)).toBe(before);
    // Redrawing from the unchanged text changes nothing either: everything was placed by hand.
    const same = updateSource(a.diagram, a.id, {}).diagram;
    expect(diagramToText(same)).toBe(before);
    expect(Object.keys(same.nodes)).toHaveLength(5);
    // Rename a node and add one: the rest stay put.
    const edited = updateSource(a.diagram, a.id, { text: a.source.text.replace("ok{ok?}", "ok{all good?}") + "\n  ok --> New[New step]" }).diagram;
    expect(Object.values(edited.nodes).find((n) => n.text === "all good?")!.rect).toEqual(d.nodes.b.rect);
    expect(Object.values(edited.nodes).some((n) => n.text === "New step")).toBe(true);
    expect(edited.nodes.c.rect).toEqual(d.nodes.c.rect);
    expect(edited.edges.e2).toMatchObject({ line: "dashed", label: "yes" });
  });

  it("writes and links a sequence diagram", () => {
    let d = [
      makeNode({ x: 0, y: 0, w: 12, h: 16 }, { id: "c", kind: "lifeline", text: "Web App" }),
      makeNode({ x: 24, y: 0, w: 12, h: 16 }, { id: "s", kind: "lifeline", text: "Server" }),
      makeNode({ x: 29, y: 5, w: 3, h: 6 }, { id: "act", kind: "activation" }),
      makeNode({ x: 33, y: 12, w: 14, h: 4 }, { id: "nt", kind: "note", text: "cached:\n- 1h" }),
    ].reduce(addNode, emptyDiagram());
    d = addEdge(d, makeEdge(att("c", { offset: 6 }), att("act", { offset: 1 }), { id: "m1", label: "GET /" }));
    d = addEdge(d, makeEdge(att("act", { offset: 4 }), att("c", { offset: 9 }), { id: "m2", label: "200", line: "dashed" }));
    const desc = describe(d, all(d))!;
    expect(desc.text).toBe(`sequenceDiagram
  participant Web_App as Web App
  participant Server
  activate Server
  Web_App->>Server: GET /
  Server-->>Web_App: 200
  deactivate Server
  Note right of Server: cached:<br>- 1h`);
    const a = adopt(d, all(d))!;
    expect(diagramToText(updateSource(a.diagram, a.id, {}).diagram)).toBe(diagramToText(d));
  });
});
