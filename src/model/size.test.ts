import { describe, expect, it } from "vitest";
import { diagramToText } from "../render/rasterize";
import { addNode, emptyDiagram, makeNode } from "./ops";
import { sameSize, shrinkToText } from "./size";
import type { Diagram, Node } from "./types";

const one = (patch: Partial<Node>, rect = { x: 0, y: 0, w: 30, h: 9 }) =>
  addNode(emptyDiagram(), makeNode(rect, { id: "a", ...patch }));
const shrunk = (d: Diagram) => diagramToText(shrinkToText(d, ["a"]));

describe("shrink to text", () => {
  it("fits a box to its lines", () => {
    expect(shrunk(one({ text: "Hello\nworld!" }))).toBe([
      "┌────────┐",
      "│ Hello  │",
      "│ world! │",
      "└────────┘",
    ].join("\n"));
  });

  it("makes room for a name, and renders lists", () => {
    expect(shrunk(one({ text: "- a\n- b", name: "Todo list" }))).toBe([
      "┌─ Todo list ─┐",
      "│ • a         │",
      "│ • b         │",
      "└─────────────┘",
    ].join("\n"));
  });

  it("fits other shapes by their own text room", () => {
    expect(shrunk(one({ kind: "decision", text: "ok?" }))).toMatchInlineSnapshot(`
      " ╱───╲
      < ok? >
       ╲───╱"
    `);
    expect(shrunk(one({ kind: "database", text: "users" }))).toMatchInlineSnapshot(`
      "╭───────╮
      ├───────┤
      │ users │
      ╰───────╯"
    `);
  });

  it("leaves boxes with boxes inside, and frames, alone", () => {
    let d = one({ text: "outer" });
    d = addNode(d, makeNode({ x: 2, y: 2, w: 10, h: 3 }, { id: "b", text: "inner" }));
    expect(shrinkToText(d, ["a"])).toBe(d);
    const f = one({ kind: "frame", name: "loop" });
    expect(shrinkToText(f, ["a"])).toBe(f);
  });
});

describe("same size", () => {
  const two = () =>
    [makeNode({ x: 0, y: 0, w: 8, h: 3 }, { id: "a" }), makeNode({ x: 20, y: 0, w: 12, h: 5 }, { id: "b" })].reduce(addNode, emptyDiagram());

  it("takes the largest width, height or both, keeping each top-left corner", () => {
    const r = (d: Diagram) => [d.nodes.a.rect, d.nodes.b.rect];
    expect(r(sameSize(two(), ["a", "b"], { w: true, h: false }))).toEqual([{ x: 0, y: 0, w: 12, h: 3 }, { x: 20, y: 0, w: 12, h: 5 }]);
    expect(r(sameSize(two(), ["a", "b"], { w: false, h: true }))).toEqual([{ x: 0, y: 0, w: 8, h: 5 }, { x: 20, y: 0, w: 12, h: 5 }]);
    expect(r(sameSize(two(), ["a", "b"], { w: true, h: true }))).toEqual([{ x: 0, y: 0, w: 12, h: 5 }, { x: 20, y: 0, w: 12, h: 5 }]);
  });
});
