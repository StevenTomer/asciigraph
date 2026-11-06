import { describe, expect, it } from "vitest";
import { addNode, emptyDiagram, makeNode } from "../model/ops";
import { diagramToText } from "../render/rasterize";
import { updateNode } from "../model/ops";
import {
  cellAt, columnLineAt, deleteColumn, deleteRow, insertColumn, insertRow, isTableText, markdownTable, moveColumn, moveRow, newTable,
  parseTable, table, tableNode, tableText, withCell, withColumnAlign, withColumnWidth,
} from "./table";
import type { Node } from "../model/types";
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

  describe("edited as tables", () => {
    const node = (fields: Partial<Node>) => ({ ...makeNode({ x: 0, y: 0, w: 1, h: 1 }), ...fields }) as Node;
    const drawn = (n: Node) => diagramToText(addNode(emptyDiagram(), n));
    const step = (n: Node, p: Partial<Node>) => ({ ...n, ...p });

    it("a new table: columns of a set width, the first row its header", () => {
      const n = node(newTable(2, 3, { x: 0, y: 0 }));
      expect(drawn(n)).toBe([
        "┌────────────┬────────────┐",
        "│            │            │",
        "├────────────┼────────────┤",
        "│            │            │",
        "│            │            │",
        "└────────────┴────────────┘",
      ].join("\n"));
      // Dragged out 21 wide: the columns share it.
      expect(node(newTable(2, 2, { x: 0, y: 0 }, 21)).rect.w).toBe(21);
    });

    it("typing in a cell: the text wraps in its column, and the table grows down (and back)", () => {
      let n = node(newTable(2, 2, { x: 0, y: 0 }));
      n = step(n, withCell(n, { row: 0, col: 0 }, "Name"));
      n = step(n, withCell(n, { row: 1, col: 1 }, "a long bit of text"));
      expect(n.text).toBe("| Name |                    |\n| ---- | ------------------ |\n|      | a long bit of text |");
      expect(drawn(n)).toBe([
        "┌────────────┬────────────┐",
        "│ Name       │            │",
        "├────────────┼────────────┤",
        "│            │ a long bit │",
        "│            │ of text    │",
        "└────────────┴────────────┘",
      ].join("\n"));
      n = step(n, withCell(n, { row: 1, col: 1 }, "short"));
      expect(n.rect.h).toBe(5);
      // A header cell over two lines, with a | in it: read back as it was typed.
      n = step(n, withCell(n, { row: 0, col: 0 }, "Name\n| a | b"));
      expect(parseTable(n.text).rows).toEqual([["Name\n| a | b", ""], ["", "short"]]);
    });

    it("which cell is where: lines go with the cell after them, the title row is -1", () => {
      const n = node(tableNode("T\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |", { x: 0, y: 0 }));
      // ┌───────┐ / │   T   │ / ├───┬───┤ / │ a │ b │ / ├───┼───┤ / │ 1 │ 2 │ / │ 3 │ 4 │
      expect(cellAt(n, { x: 2, y: 1 })).toEqual({ row: -1, col: 0 });
      expect(cellAt(n, { x: 2, y: 3 })).toEqual({ row: 0, col: 0 });
      expect(cellAt(n, { x: 4, y: 4 })).toEqual({ row: 1, col: 1 });
      expect(cellAt(n, { x: 6, y: 6 })).toEqual({ row: 2, col: 1 });
      expect(cellAt(n, { x: 20, y: 6 })).toBeNull();
    });

    it("rows: put in, moved and taken out, the header's divider staying under the first row", () => {
      let n = node(tableNode("| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n|---|---|\n| 5 | 6 |", { x: 0, y: 0 }));
      n = step(n, insertRow(n, 1));
      expect(parseTable(n.text).rows).toEqual([["a", "b"], ["", ""], ["1", "2"], ["3", "4"], ["5", "6"]]);
      expect([...parseTable(n.text).dividers]).toEqual([1, 4]);
      n = step(n, moveRow(n, 4, -1));
      expect(parseTable(n.text).rows.map((r) => r[0])).toEqual(["a", "", "1", "5", "3"]);
      expect([...parseTable(n.text).dividers]).toEqual([1, 4]);
      n = step(n, deleteRow(n, 0));
      expect(parseTable(n.text).rows.map((r) => r[0])).toEqual(["", "1", "5", "3"]);
      expect([...parseTable(n.text).dividers]).toEqual([1, 3]);
      expect(n.rect.h).toBe(drawn(n).split("\n").length);
    });

    it("columns: put in, moved and taken out, with their widths and alignment", () => {
      let n = node(tableNode("| a | b |\n|---|--:|\n| 1 | 2 |", { x: 0, y: 0 }));
      n = { ...n, ...withColumnWidth(n, 0, 6) };
      n = step(n, insertColumn(n, 1));
      expect(n.text).toBe("| a   |     | b   |\n| --- | --- | --: |\n| 1   |     | 2   |");
      expect(n.table?.widths).toEqual([6]);
      n = step(n, withCell(n, { row: 0, col: 1 }, "mid"));
      n = step(n, moveColumn(n, 0, 1));
      expect(n.table?.widths).toEqual([null, 6]);
      expect(drawn(n)).toBe([
        "┌─────┬────────┬───┐",
        "│ mid │ a      │ b │",
        "├─────┼────────┼───┤",
        "│     │ 1      │ 2 │",
        "└─────┴────────┴───┘",
      ].join("\n"));
      n = step(n, withColumnAlign(n, 2, "center"));
      n = step(n, deleteColumn(n, 1));
      expect(n.text).toBe("| mid | b   |\n| --- | :-: |\n|     | 2   |");
      expect(n.table?.widths).toBeUndefined();
      expect(drawn(n)).toBe([
        "┌─────┬───┐",
        "│ mid │ b │",
        "├─────┼───┤",
        "│     │ 2 │",
        "└─────┴───┘",
      ].join("\n"));
      // A table keeps one column and one row.
      expect(deleteColumn(node(tableNode("| a |\n|---|\n| 1 |", { x: 0, y: 0 })), 0)).toEqual({});
      expect(deleteRow(node(tableNode("| a |\n|---|", { x: 0, y: 0 })), 0)).toEqual({});
    });
  });
});
