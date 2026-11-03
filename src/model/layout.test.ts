import { describe, expect, it } from "vitest";
import { diagramToText } from "../render/rasterize";
import { autoLayout } from "./layout";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode } from "./ops";

const att = (node: string) => ({ kind: "attached" as const, node, side: "auto" as const });
// A scattered graph with a cycle: a → b, a → c, b → d, c → d, d → e, e → b.
function graph() {
  let d = [["a", 30, 20], ["b", 0, 0], ["c", 50, 3], ["d", 10, 30], ["e", 40, 12]]
    .map(([id, x, y]) => makeNode({ x: x as number, y: y as number, w: 7, h: 3 }, { id: id as string, text: id as string }))
    .reduce(addNode, emptyDiagram());
  for (const [a, b] of [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"], ["d", "e"], ["e", "b"]]) d = addEdge(d, makeEdge(att(a), att(b)));
  return d;
}

describe("auto layout", () => {
  it("puts nodes in layers following the connectors, breaking cycles", () => {
    const d = autoLayout(graph(), [], "down");
    const y = (id: string) => d.nodes[id].rect.y;
    expect(y("a")).toBeLessThan(y("b"));
    expect(y("b")).toBe(y("c"));
    expect(y("b")).toBeLessThan(y("d"));
    expect(y("d")).toBeLessThan(y("e"));
  });

  it("lays out left to right too, without connectors colliding", () => {
    expect("\n" + diagramToText(autoLayout(graph(), [], "right")) + "\n").toBe(`
                    ┌─────────────────────────────────┐
                    ▼                                 │
                 ┌─────┐                              │
               ┌►│  b  ├────────┐                     │
┌─────┐        │ └─────┘        │ ┌─────┐          ┌──┴──┐
│  a  ├────────┤                ├►│  d  ├─────────►│  e  │
└─────┘        │                │ └─────┘          └─────┘
               │ ┌─────┐        │
               └►│  c  ├────────┘
                 └─────┘
`);
  });

  it("only moves the selection when there is one, and moves contents along", () => {
    let d = graph();
    d = addNode(d, makeNode({ x: 51, y: 4, w: 3, h: 1 }, { id: "inside-c", border: "none", text: "x" }));
    const before = d.nodes.e.rect;
    const out = autoLayout(d, ["a", "b", "c"], "down");
    expect(out.nodes.e.rect).toEqual(before);
    const moved = { x: out.nodes.c.rect.x - d.nodes.c.rect.x, y: out.nodes.c.rect.y - d.nodes.c.rect.y };
    expect(out.nodes["inside-c"].rect).toMatchObject({ x: 51 + moved.x, y: 4 + moved.y });
  });
});
