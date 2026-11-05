import { describe, expect, it } from "vitest";
import { addNode, emptyDiagram, makeNode } from "../model/ops";
import { diagramToText } from "../render/rasterize";
import { updateNode } from "../model/ops";
import { columnLineAt, isTableText, markdownTable, parseTable, table, tableNode, tableText, withColumnWidth } from "./table";
import type { TableOptions } from "../model/types";

const TEXT = "| Name | Type | Notes |\n|------|:----:|------:|\n| id | int | PK |\n| name | text | |\n|---|---|---|\n| total | 2 | rows |";
const draw = (text: string, rect?: { w: number; h?: number }, options?: TableOptions) => {
  const t = tableNode(text, { x: 0, y: 0 });
  const { rect: fit, ...fields } = t;
  const n = makeNode(rect ? { ...fit, ...rect } : fit, { ...fields, ...(rect && { autosize: false }), ...(options && { table: options }) });
  return diagramToText(addNode(emptyDiagram(), n));
};
const USERS = "Users\n| Name | Notes |\n|------|-------|\n| id | primary key,\n  auto-increment |\n| name | text |";

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
    expect(tableText({ rows: [["a", "b"], ["1", "22"]], dividers: new Set([1]), aligns: ["left", "right"] })).toBe("| a   | b   |\n| --- | --: |\n| 1   | 22  |");
  });

  it("read a title, and cells spanning lines (a row carries on until a line ends with |, or <br>)", () => {
    const t = parseTable(USERS);
    expect(t.title).toBe("Users");
    expect(t.rows).toEqual([["Name", "Notes"], ["id", "primary key,\nauto-increment"], ["name", "text"]]);
    expect(parseTable("| a | b |\n|---|---|\n| x<br>y | z |").rows[1]).toEqual(["x\ny", "z"]);
    expect(parseTable("**Users**\n\n| a |\n|---|").title).toBe("Users");
    expect(isTableText("Users\n| a | b |\n|---|---|\n| 1 | two\nlines |")).toBe(true);
    expect(isTableText("one\ntwo\nthree\n| a | b |\n|---|---|")).toBe(false);
  });

  it("draw a title in its own row, lining off every row when one spans lines", () => {
    expect(draw(USERS)).toBe([
      "┌───────────────────────┐",
      "│         Users         │",
      "├──────┬────────────────┤",
      "│ Name │ Notes          │",
      "├──────┼────────────────┤",
      "│ id   │ primary key,   │",
      "│      │ auto-increment │",
      "├──────┼────────────────┤",
      "│ name │ text           │",
      "└──────┴────────────────┘",
    ].join("\n"));
  });

  it("or the title in the top border, aligned as asked", () => {
    expect(draw(USERS, undefined, { title: "border" }).split("\n")[0]).toBe("┌──────┬─ Users ────────┐");
    expect(draw(USERS, undefined, { title: "border", titleAlign: "left" }).split("\n")[0]).toBe("┌─ Users ───────────────┐");
    expect(draw(USERS, undefined, { titleAlign: "right" }).split("\n")[1]).toBe("│                 Users │");
  });

  it("give columns a set width: text that doesn't fit wraps, or is cut off with wrapping off", () => {
    expect(draw(USERS, undefined, { widths: [null, 8] })).toBe([
      "┌─────────────────┐",
      "│      Users      │",
      "├──────┬──────────┤",
      "│ Name │ Notes    │",
      "├──────┼──────────┤",
      "│ id   │ primary  │",
      "│      │ key,     │",
      "│      │ auto-inc │",
      "│      │ rement   │",
      "├──────┼──────────┤",
      "│ name │ text     │",
      "└──────┴──────────┘",
    ].join("\n"));
    expect(draw(USERS, undefined, { widths: [null, 8], wrap: false }).split("\n").slice(5, 7)).toEqual(["│ id   │ primary… │", "│      │ auto-in… │"]);
  });

  it("wrap auto-sized columns when drawn narrower, down to a few columns each", () => {
    const narrow = "| a | b |\n|---|---|\n| one two | three four |";
    expect(draw(narrow, { w: 15 })).toBe([
      "┌──────┬──────┐",
      "│ a    │ b    │",
      "├──────┼──────┤",
      "│ one  │ thre │",
      "│ two  │ e    │",
      "│      │ four │",
      "└──────┴──────┘",
    ].join("\n"));
    const n = makeNode({ x: 0, y: 0, w: 4, h: 3 }, { ...tableNode(narrow, { x: 0, y: 0 }), rect: { x: 0, y: 0, w: 4, h: 3 }, autosize: false });
    expect(table.minSize(n).w).toBe(15);
  });

  it("change a column's width from its line: the table's edge moves with it", () => {
    const { rect, ...fields } = tableNode(USERS, { x: 0, y: 0 });
    const d = addNode(emptyDiagram(), makeNode(rect, fields));
    const n = Object.values(d.nodes)[0];
    expect(columnLineAt(n, { x: 7, y: 5 })).toBe(0);
    expect(columnLineAt(n, { x: 7, y: 1 })).toBe(null); // the title row has no column line
    expect(columnLineAt(n, { x: 3, y: 5 })).toBe(null);
    const wider = updateNode(d, n.id, withColumnWidth(n, 0, 8));
    const w = Object.values(wider.nodes)[0];
    expect(w.table?.widths).toEqual([8]);
    expect(diagramToText(wider).split("\n")[3]).toBe("│ Name     │ Notes          │");
    const back = updateNode(wider, n.id, withColumnWidth(w, 0, null));
    expect(diagramToText(back)).toBe(diagramToText(d));
  });

  it("write Markdown for a document: the title in bold, line breaks as <br>", () => {
    expect(markdownTable(USERS)).toBe([
      "**Users**",
      "",
      "| Name | Notes                          |",
      "| ---- | ------------------------------ |",
      "| id   | primary key,<br>auto-increment |",
      "| name | text                           |",
    ].join("\n"));
    // Pasted with <br>: shown as the line break it is.
    expect(tableNode("| a | b |\n|---|---|\n| x<br>y | z |", { x: 0, y: 0 }).text).toBe("| a   | b   |\n| --- | --- |\n| x\n  y   | z   |");
    // And written back the way it was read.
    expect(parseTable(tableText(parseTable(USERS)))).toEqual(parseTable(USERS));
  });
});
