import { describe, expect, it } from "vitest";
import { diagramToText } from "../render/rasterize";
import { autoLayout } from "./layout";
import { lockTogether } from "./locks";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode, updateNode } from "./ops";

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

describe("auto layout with locks", () => {
  const rectOf = (d: ReturnType<typeof emptyDiagram>, id: string) => d.nodes[id].rect;
  const chain = () => {
    // a → b → c scattered, plus x and n not connected to anything.
    let d = [["a", 40, 30], ["b", 55, 0], ["c", 60, 10], ["x", 80, 40], ["n", 90, 0]]
      .map(([id, x, y]) => makeNode({ x: x as number, y: y as number, w: 7, h: 3 }, { id: id as string }))
      .reduce(addNode, emptyDiagram());
    for (const [p, q] of [["a", "b"], ["b", "c"]]) d = addEdge(d, makeEdge(att(p), att(q)));
    return d;
  };

  it("brings lock-mates outside the layout along", () => {
    // n is a note locked left–right to b; only a, b, c are laid out.
    const d = lockTogether(chain(), ["b", "n"], { x: true, y: false });
    const out = autoLayout(d, ["a", "b", "c"], "down");
    const dx = rectOf(out, "b").x - rectOf(d, "b").x;
    expect(dx).not.toBe(0);
    expect(rectOf(out, "n")).toEqual({ ...rectOf(d, "n"), x: rectOf(d, "n").x + dx });
    expect(rectOf(out, "x")).toEqual(rectOf(d, "x")); // not locked: stays
  });

  it("lays out boxes locked both ways as one unit", () => {
    // x is locked both ways to b, 10 right and 2 below it: laid out together, they keep that.
    let d = updateNode(chain(), "x", { rect: { x: 65, y: 2, w: 7, h: 3 } });
    d = lockTogether(d, ["b", "x"], { x: true, y: true });
    const out = autoLayout(d, [], "down");
    const b = rectOf(out, "b"), x = rectOf(out, "x");
    expect([x.x - b.x, x.y - b.y]).toEqual([10, 2]);
    // Still layered: a above the unit, c below it, nothing overlapping the unit.
    expect(rectOf(out, "a").y + 3).toBeLessThan(b.y);
    expect(rectOf(out, "c").y).toBeGreaterThan(x.y + 3);
  });

  it("places boxes locked on one axis individually", () => {
    const d = lockTogether(chain(), ["a", "c"], { x: true, y: false });
    const rects = (dd: ReturnType<typeof emptyDiagram>) => Object.values(dd.nodes).map((n) => n.rect);
    expect(rects(autoLayout(d, ["a", "b", "c"], "down"))).toEqual(rects(autoLayout(chain(), ["a", "b", "c"], "down")));
  });
});
