import { describe, expect, it } from "vitest";
import { addNode, emptyDiagram, makeNode } from "../model/ops";
import { diagramToText } from "../render/rasterize";
import { isTableText, parseTable, tableNode, tableText } from "./table";

const TEXT = "| Name | Type | Notes |\n|------|:----:|------:|\n| id | int | PK |\n| name | text | |\n|---|---|---|\n| total | 2 | rows |";
const draw = (text: string, rect?: { w: number; h: number }) => {
  const t = tableNode(text, { x: 0, y: 0 });
  const { rect: fit, ...fields } = t;
  return diagramToText(addNode(emptyDiagram(), makeNode(rect ? { ...fit, ...rect } : fit, rect ? { ...fields, autosize: false } : fields)));
};

describe("tables", () => {
  it("read a Markdown table: cells, dividers, alignment", () => {
    const t = parseTable(TEXT);
    expect(t.rows).toEqual([["Name", "Type", "Notes"], ["id", "int", "PK"], ["name", "text", ""], ["total", "2", "rows"]]);
    expect([...t.dividers]).toEqual([1, 3]);
    expect(t.aligns).toEqual(["left", "center", "right"]);
    expect(parseTable("a | b\nc | d").rows).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("draw as a grid, as wide as their cells", () => {
    expect(draw(TEXT)).toBe([
      "┌───────┬──────┬───────┐",
      "│ Name  │ Type │ Notes │",
      "├───────┼──────┼───────┤",
      "│ id    │ int  │    PK │",
      "│ name  │ text │       │",
      "├───────┼──────┼───────┤",
      "│ total │  2   │  rows │",
      "└───────┴──────┴───────┘",
    ].join("\n"));
  });

  it("give extra room to the last column and row when drawn bigger", () => {
    expect(draw("| a | b |\n|---|---|\n| 1 | 2 |", { w: 14, h: 6 })).toBe([
      "┌───┬────────┐",
      "│ a │ b      │",
      "├───┼────────┤",
      "│ 1 │ 2      │",
      "│   │        │",
      "└───┴────────┘",
    ].join("\n"));
  });

  it("are told from other text", () => {
    expect(isTableText(TEXT)).toBe(true);
    expect(isTableText("| a | b |")).toBe(false);
    expect(isTableText("a | b\nc | d")).toBe(false);
  });

  it("write Markdown back, alignment included", () => {
    expect(tableText([["a", "b"], ["1", "22"]], new Set([1]), ["left", "right"])).toBe("| a   | b   |\n| --- | --: |\n| 1   | 22  |");
  });
});
