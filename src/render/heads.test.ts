import { describe, expect, it } from "vitest";
import { addEdge, addNode, emptyDiagram, headOf, makeEdge, makeNode, withHead } from "../model/ops";
import { reverseEdge } from "../model/arrange";
import { type Diagram, type Edge, HEADS } from "../model/types";
import { exportText } from "../export/text";
import { diagramToText } from "./rasterize";

const show = (d: Diagram) => "\n" + diagramToText(d) + "\n";
const att = (node: string) => ({ kind: "attached" as const, node, side: "auto" as const });
const box = (id: string, x: number, y: number) => makeNode({ x, y, w: 5, h: 3 }, { id, text: id });
const pair = (edge: Partial<Edge>, bx = 12, by = 0) =>
  addEdge([box("A", 0, 0), box("B", bx, by)].reduce(addNode, emptyDiagram()), makeEdge(att("A"), att("B"), { id: "e", ...edge }));
const row = (d: Diagram, ascii = false) => exportText(d, { ascii }).split("\n")[1];

describe("connector heads", () => {
  it("draws each head, pointing the way the line goes", () => {
    const rows = HEADS.map((h) => row(pair({ ...withHead(makeEdge(att("A"), att("B")), "start", h), ...{ arrows: { start: true, end: true }, heads: { start: h, end: h } } })));
    expect(rows).toEqual([
      "│ A │◄─────►│ B │",
      "│ A │◁─────▷│ B │",
      "│ A │◆─────◆│ B │",
      "│ A │◊─────◊│ B │",
      "│ A │●─────●│ B │",
      "│ A │○─────○│ B │",
      "│ A │×─────×│ B │",
      "│ A │├─────┤│ B │",
    ]);
  });

  it("has ASCII stand-ins", () => {
    const rows = HEADS.map((h) => row(pair({ arrows: { start: true, end: true }, heads: { start: h, end: h } }), true));
    expect(rows).toEqual([
      "| A |<----->| B |",
      "| A |<|---|>| B |",
      "| A |*-----*| B |",
      "| A |o-----o| B |",
      "| A |@-----@| B |",
      "| A |O-----O| B |",
      "| A |x-----x| B |",
      "| A ||-----|| B |",
    ]);
  });

  it("has a hollow arrow up and down in ASCII: A and V", () => {
    const d = addEdge(
      [box("A", 0, 0), box("B", 0, 7)].reduce(addNode, emptyDiagram()),
      makeEdge(att("A"), att("B"), { arrows: { start: true, end: true }, heads: { start: "triangle", end: "triangle" } }),
    );
    expect(diagramToText(d, true).split("\n").map((l) => l.trim()).slice(3, 7)).toEqual(["A", "|", "|", "V"]);
  });

  it("draws a bar across a vertical line in its style", () => {
    const d = addEdge(
      [box("A", 0, 0), box("B", 0, 7)].reduce(addNode, emptyDiagram()),
      makeEdge(att("A"), att("B"), { line: "heavy", heads: { end: "bar" } }),
    );
    expect(show(d)).toBe(`
┌───┐
│ A │
└─┰─┘
  ┃
  ┃
  ┃
  ┻
┌───┐
│ B │
└───┘
`);
  });

  it("sets and reads heads; arrows stay the on/off switch", () => {
    const e = makeEdge(att("A"), att("B"));
    expect(headOf(e, "end")).toBe("arrow");
    expect(headOf(e, "start")).toBeNull();
    const d = { ...e, ...withHead(e, "start", "diamond") };
    expect(d).toMatchObject({ arrows: { start: true, end: true }, heads: { start: "diamond" } });
    const plain = { ...d, ...withHead(d, "start", null) };
    expect(plain.arrows.start).toBe(false);
    expect(plain.heads).toBeUndefined();
  });

  it("moves the heads round when the connector is reversed", () => {
    const d = reverseEdge(pair({ arrows: { start: true, end: true }, heads: { start: "diamond" } }), "e");
    expect(d.edges.e.heads).toEqual({ start: "diamond" });
    expect(row(d)).toBe("│ A │◄─────◆│ B │");
  });
});

describe("where a connector turns", () => {
  it("turns halfway between the ends by default", () => {
    expect(show(pair({}, 20, 2))).toBe(`
┌───┐
│ A ├───────┐
└───┘       │       ┌───┐
            └──────►│ B │
                    └───┘
`);
  });

  it("turns where it was dragged to (a fraction of the way)", () => {
    expect(show(pair({ turnAt: 0.25 }, 20, 2))).toBe(`
┌───┐
│ A ├────┐
└───┘    │          ┌───┐
         └─────────►│ B │
                    └───┘
`);
  });

  it("turns late when the label needs the room", () => {
    expect(show(pair({ label: "request" }, 20, 2))).toBe(`
┌───┐
│ A ├── request ─┐
└───┘            │  ┌───┐
                 └─►│ B │
                    └───┘
`);
  });
});
