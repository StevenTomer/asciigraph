import { type Point, type Rect, bottom, right } from "../geometry/geom";
import type { HAlign, LineStyle, Node, TableOptions } from "../model/types";
import { renderText } from "../render/markdown";
import { chars, wrap } from "../render/textLayout";
import { box, drawBorder, drawName } from "./box";
import type { ShapeDef } from "./registry";

/**
 * A table, from its text written as a Markdown table: cells between |, and a row of dashes for a
 * divider (`:--:` centers that column, `--:` right-aligns it).
 *
 *   Users                     ┌───────────────┐
 *   | Name | Type |           │     Users     │       a title: the line before the table, in
 *   |------|------|     →     ├──────┬────────┤       its own row or set in the top border
 *   | id   | int  |           │ Name │ Type   │
 *                             ├──────┼────────┤
 *                             │ id   │ int    │
 *                             └──────┴────────┘
 *
 * A cell spans lines when its row's line doesn't end with |: the row carries on on the next line
 * (`<br>` works too, and is what a Markdown export writes). Columns are as wide as their widest
 * line unless given a width (`Node.table.widths`); text that doesn't fit wraps (or, with wrapping
 * off, is cut off with …). A table drawn wider gives the room to its last auto-sized column;
 * drawn narrower, its auto-sized columns wrap. When any row spans lines, every row gets a line
 * under it, so where one ends and the next starts is clear.
 */

export interface TableText {
  /** The lines before the table. */
  title?: string;
  /** Cells, each possibly several lines. */
  rows: string[][];
  /** Rows with a divider above them (indexes into `rows`). */
  dividers: Set<number>;
  aligns: HAlign[];
  cols: number;
}

const SEPARATOR = /^\s*:?-+:?\s*$/;
const BR = /\s*<br\s*\/?>\s*/gi;
/** A `<br>` before an indented list item: the indentation stays. */
const BR_KEEP = /\s*<br\s*\/?>( +(?:[-*+]|\d+[.)])\s)/gi;

/** Whether a row's line ends it (with a | that isn't escaped). */
const closes = (line: string) => {
  const t = line.trimEnd();
  return t.endsWith("|") && !t.endsWith("\\|");
};

/**
 * The cells of a row (one line, or several when a cell spans lines): between |, the outer ones
 * optional. A cell's first line is trimmed; the lines after it keep their indentation past where
 * the cell's text starts (so a nested list item stays nested), less anything before it. `<br>`
 * starts a new line (keeping the indentation after it only for a list item).
 */
function cellsOf(row: string): string[] {
  const cells: { text: string; start: number }[] = [];
  let text = "";
  let col = 0;
  let start = -1;
  let opened = false;
  const end = () => {
    cells.push({ text, start: start < 0 ? col : start });
    text = "";
    start = -1;
  };
  const t = row.replace(/^\s*\|/, (m) => " ".repeat(m.length));
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "\\" && t[i + 1] === "|") {
      if (start < 0) start = col;
      text += "|";
      i++;
      col += 2;
      continue;
    }
    if (ch === "|") {
      end();
      opened = true;
      col++;
      continue;
    }
    if (ch === "\n") {
      text += "\n";
      col = 0;
      continue;
    }
    if (start < 0 && ch !== " " && ch !== "\t" && !text.includes("\n")) start = col;
    text += ch;
    col++;
  }
  // The text after the last |: a cell, unless the row ends with that | (then it's just space).
  if (text.trim() || !opened || !closes(row)) end();
  return cells.map(({ text: raw, start: at }) => {
    const lines = raw.replace(/\r/g, "").split("\n");
    const out = lines.map((l, i) => {
      if (i === 0) return l.trim();
      const lead = l.length - l.trimStart().length;
      return " ".repeat(Math.max(0, lead - at)) + l.trim();
    });
    return out
      .join("\n")
      .replace(BR_KEEP, "\n$1")
      .replace(BR, "\n")
      .split("\n")
      .map((l, i) => (i === 0 ? l : l.trimEnd()))
      .join("\n")
      .replace(/^\n+|\s+$/g, "");
  });
}

/** `**Title**`, `# Title` (as a Markdown export or a README writes it): just the words. */
const titleOf = (line: string) => line.trim().replace(/^#+\s+/, "").replace(/^(\*\*|__)(.*)\1$/, "$2").trim();

export function parseTable(text: string): TableText {
  const lines = text.split("\n");
  let i = 0;
  const title: string[] = [];
  for (; i < lines.length && !lines[i].includes("|"); i++) if (lines[i].trim()) title.push(titleOf(lines[i]));
  // Rows can carry on over lines only in a table whose lines end with |.
  // (Lines starting with |, some ending with one: the first may not, if a header cell spans lines.)
  const piped = i < lines.length && lines[i].trim().startsWith("|") && lines.slice(i).some((l) => l.trim().length > 1 && closes(l));
  const rows: string[][] = [];
  const dividers = new Set<number>();
  let aligns: HAlign[] = [];
  let headed = false;
  const row = (raw: string) => {
    const cells = cellsOf(raw);
    // A divider: dashes, under the header (as Markdown has it), or (further down) at least three in
    // each cell, so a cell that's just "-" (a list being typed) isn't one.
    const dashes = cells.length && cells.every((c) => SEPARATOR.test(c)) && ((rows.length === 1 && !headed) || cells.every((c) => c.replace(/[:\s]/g, "").length >= 3));
    if (!raw.includes("\n") && dashes) {
      headed = true;
      if (rows.length) dividers.add(rows.length);
      if (!aligns.length) aligns = cells.map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"));
      return;
    }
    rows.push(cells);
  };
  let open: string | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (open !== null) {
      open += "\n" + line;
      if (closes(line)) {
        row(open);
        open = null;
      }
      continue;
    }
    if (!line.trim()) continue;
    if (piped && line.trim().startsWith("|") && (line.trim() === "|" || !closes(line))) open = line;
    else row(line);
  }
  if (open !== null) row(open);
  const cols = Math.max(1, ...rows.map((r) => r.length), aligns.length);
  return { ...(title.length && { title: title.join("\n") }), rows, dividers, aligns, cols };
}

/** Whether text is a Markdown table: maybe a title line, then a row of cells and a divider row. */
export function isTableText(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  const start = lines.findIndex((l) => l.includes("|"));
  if (start < 0 || start > 1 || lines.length - start < 2) return false;
  const table = lines.slice(start);
  const piped = closes(table[0]) && table[0].trim().startsWith("|");
  return cellsOf(table[1]).every((c) => SEPARATOR.test(c)) && cellsOf(table[0]).length >= 1 && (piped || table.every((l) => l.includes("|")));
}

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

const optionsOf = (n: Pick<Node, "table">): Required<Omit<TableOptions, "widths">> & { widths: (number | null)[] } => ({
  title: n.table?.title ?? "row",
  titleAlign: n.table?.titleAlign ?? "center",
  widths: n.table?.widths ?? [],
  wrap: n.table?.wrap !== false,
  lists: n.table?.lists !== false,
});

/** Auto-sized columns narrow down to this (or their text, if less) before the table stops shrinking. */
const MIN_AUTO = 4;

const lineCount = (text: string) => Math.max(1, ...text.split("\n").map((l) => chars(l).length));

/** How a cell's text is shown: wrapped (or cut off) and with Markdown lists (or as typed). */
type CellStyle = { wrap: boolean; lists: boolean };

/** A cell's lines in `room` columns: wrapped, or (wrapping off) as written; lists as lists. */
const cellLines = (text: string, room: number, o: CellStyle) => cellText_(text, room, o).lines;

/** A cell as shown, and whether it's a list (laid out from the left, whatever the column's
 * alignment). */
function cellText_(text: string, room: number, o: CellStyle): { lines: string[]; list: boolean } {
  if (!o.lists) return { lines: o.wrap ? wrap(text, room) : text.split("\n"), list: false };
  return renderText(text, o.wrap ? room : 100000, false);
}

/** A cell's width at its widest line, as shown. */
const cellWidth = (text: string, o: CellStyle) => (o.lists ? Math.max(1, ...cellLines(text, 100000, { ...o, wrap: false }).map((l) => chars(l).length)) : lineCount(text));

export interface TableLayout {
  /** Each column's text width (its cells have a space each side too). */
  rooms: number[];
  /** Each column's left line (x). */
  edges: number[];
  /** Each row's first line (y), and how many lines it has. */
  rowY: number[];
  heights: number[];
  /** Rows with a line above them: those written, or all when a row spans lines. */
  dividers: Set<number>;
  /** The title's lines, in its own row (none when it's in the border). */
  titleLines: string[];
  /** Where the column lines start: the top border, or the line under the title. */
  columnsFrom: number;
  /** Its size: at its widest columns (`natural`), at its narrowest (`least`), and at `r`. */
  natural: { w: number; h: number };
  least: { w: number; h: number };
  size: { w: number; h: number };
}

/** Where everything goes in a table drawn in `r` (only `r.w` matters for the sizes). */
export function tableLayout(t: TableText, n: Pick<Node, "table" | "border">, r: Rect): TableLayout {
  const o = optionsOf(n);
  const fixed = Array.from({ length: t.cols }, (_, c) => o.widths[c] ?? null);
  const natural = fixed.map((f, c) => f ?? Math.max(1, ...t.rows.map((row) => cellWidth(row[c] ?? "", o))));
  const least = natural.map((w, c) => (fixed[c] !== null || !o.wrap ? w : Math.min(w, MIN_AUTO)));
  const outside = 3 * t.cols + 1; // a space each side of each column, and the lines between them
  const sum = (ws: number[]) => ws.reduce((s, w) => s + w, 0);
  const inBorder = o.title === "border" && n.border !== "none";
  const title = t.title ?? "";
  const titleW = !title ? 0 : inBorder ? chars(title.replace(/\n/g, " ")).length + 6 : lineCount(title) + 4;

  // Fit the columns into the width: extra room to the last auto-sized column; too little, and
  // the widest auto-sized columns give it up first.
  const rooms = [...natural];
  let extra = r.w - outside - sum(rooms);
  if (extra > 0) {
    const autos = fixed.map((f, c) => (f === null ? c : -1)).filter((c) => c >= 0);
    rooms[autos.length ? autos[autos.length - 1] : t.cols - 1] += extra;
  }
  while (extra < 0) {
    let widest = -1;
    rooms.forEach((w, c) => {
      if (w > least[c] && (widest < 0 || w > rooms[widest])) widest = c;
    });
    if (widest < 0) break;
    rooms[widest]--;
    extra++;
  }

  const edges: number[] = [];
  let x = r.x;
  for (const w of rooms) {
    edges.push(x);
    x += w + 3;
  }
  const width = Math.max(r.w, outside + sum(rooms));
  const titleLines = title && !inBorder ? cellLines(title, Math.max(1, width - 4), { wrap: o.wrap, lists: false }) : [];
  const heights = t.rows.map((row) => Math.max(1, ...rooms.map((w, c) => cellLines(row[c] ?? "", w, o).length)));
  const dividers = heights.some((h) => h > 1)
    ? new Set(t.rows.map((_, i) => i).filter((i) => i > 0))
    : new Set([...t.dividers].filter((i) => i > 0 && i < t.rows.length));
  let y = r.y + 1;
  if (titleLines.length) y += titleLines.length + 1;
  const columnsFrom = titleLines.length ? y - 1 : r.y;
  const rowY: number[] = [];
  t.rows.forEach((_, i) => {
    if (dividers.has(i)) y++;
    rowY.push(y);
    y += heights[i];
  });
  const h = y - r.y + 1;
  const measure = (ws: number[]) => {
    const w = Math.max(outside + sum(ws), titleW);
    return { w, h: w === r.w ? h : tableLayout(t, n, { ...r, w }).size.h };
  };
  let nat: { w: number; h: number } | undefined, lst: { w: number; h: number } | undefined;
  return {
    rooms, edges, rowY, heights, dividers, titleLines, columnsFrom,
    size: { w: width, h },
    // Worked out only when asked for (each is another layout).
    get natural() {
      return (nat ??= measure(natural));
    },
    get least() {
      return (lst ??= measure(least));
    },
  };
}

const layoutOf = (n: Node, text = n.text) => tableLayout(parseTable(text), n, n.rect);

export const table: ShapeDef = {
  ...box,
  label: "table",
  defaultSize: { w: 21, h: 6 },
  minSize(n) {
    const t = parseTable(n.text);
    if (!t.rows.length) return { w: 3, h: 3 };
    // As narrow as its columns go; as tall as its rows are at the width it is.
    const l = tableLayout(t, n, n.rect);
    return { w: l.least.w, h: l.size.h };
  },
  contentRect: (n) => ({ x: n.rect.x + 2, y: n.rect.y + 1, w: Math.max(1, n.rect.w - 4), h: Math.max(1, n.rect.h - 2) }),

  fitSize(n, text) {
    const t = parseTable(text);
    if (!t.rows.length) return { w: n.rect.w, h: n.rect.h };
    // Made from text (autosize): just as big as its cells, so it shrinks again too.
    if (n.autosize) return tableLayout(t, n, { ...n.rect, w: 0 }).natural;
    // Sized by hand: that width (wrapping what doesn't fit), and tall enough for it.
    const l = tableLayout(t, n, n.rect);
    const w = Math.max(n.rect.w, l.least.w);
    return { w, h: Math.max(n.rect.h, w === n.rect.w ? l.size.h : tableLayout(t, n, { ...n.rect, w }).size.h) };
  },

  rasterize(n, grid) {
    const r = n.rect;
    const style: LineStyle | null = n.border === "none" ? null : n.border === "rounded" ? "single" : n.border;
    if (style) drawBorder(grid, r, n);
    const t = parseTable(n.text);
    const o = optionsOf(n);
    if (!t.rows.length) return;
    const l = tableLayout(t, n, r);
    const { rooms, edges, rowY, heights } = l;
    const y1 = bottom(r), x1 = right(r);
    const across = (y: number) => {
      if (y <= r.y || y >= y1) return;
      for (let x = r.x; x <= x1; x++) grid.stroke({ x, y }, x === r.x ? ["right"] : x === x1 ? ["left"] : ["left", "right"], style!);
    };
    if (style) {
      // The line under a title row; column lines from there down, joined to it (┬ ┴); dividers
      // across (├ ┼ ┤).
      if (l.titleLines.length) across(l.columnsFrom);
      for (const x of edges.slice(1)) {
        if (x >= x1) break;
        for (let y = l.columnsFrom; y <= y1; y++) grid.stroke({ x, y }, y === l.columnsFrom ? ["bottom"] : y === y1 ? ["top"] : ["top", "bottom"], style);
      }
      for (const i of l.dividers) across(rowY[i] - 1);
    }
    /** Text in `room` columns from `x`, on line `y`: aligned, and cut off with … if too long. */
    const put = (text: string, x: number, y: number, room: number, align: HAlign) => {
      if (y >= y1) return;
      const cs = chars(text);
      const shown = cs.length > room ? [...cs.slice(0, Math.max(0, room - 1)), "…"] : cs;
      const left = x + (align === "right" ? room - shown.length : align === "center" ? Math.floor((room - shown.length) / 2) : 0);
      shown.forEach((ch, j) => {
        if (left + j < x1) grid.setChar({ x: left + j, y }, ch);
      });
    };
    l.titleLines.forEach((line, j) => put(line, r.x + 2, r.y + 1 + j, Math.max(1, r.w - 4), o.titleAlign));
    t.rows.forEach((row, i) => {
      for (let c = 0; c < t.cols; c++) {
        const shown = cellText_(row[c] ?? "", rooms[c], o);
        const align = shown.list ? "left" : t.aligns[c] ?? "left";
        shown.lines.slice(0, heights[i]).forEach((line, j) => put(line, edges[c] + 2, rowY[i] + j, rooms[c], align));
      }
    });
    if (style && t.title && o.title === "border") drawName(grid, r, t.title, o.titleAlign);
  },
};

/**
 * The column whose right-hand line is at `cell` (for dragging it to change the column's width),
 * or null. The table's own right border isn't one: that resizes the whole table.
 */
export function columnLineAt(n: Node, cell: Point): number | null {
  if (n.kind !== "table" || n.border === "none") return null;
  const l = layoutOf(n);
  if (cell.y <= l.columnsFrom || cell.y >= bottom(n.rect)) return null;
  const i = l.edges.indexOf(cell.x);
  return i > 0 ? i - 1 : null;
}

/** Where a table's column lines are (x), for drawing their drag handles. */
export function columnLines(n: Node): { x: number; y0: number; y1: number }[] {
  if (n.kind !== "table" || n.border === "none") return [];
  const l = layoutOf(n);
  return l.edges.slice(1).filter((x) => x < right(n.rect)).map((x) => ({ x, y0: l.columnsFrom, y1: bottom(n.rect) }));
}

/** A column's left line (x). */
export const columnLeft = (n: Node, col: number): number => layoutOf(n).edges[col];

/** The columns' text widths as drawn now. */
export const columnRooms = (n: Node): number[] => layoutOf(n).rooms;

/**
 * The change that gives column `col` the width `room` (null: back to auto-sized): the table's
 * right edge moves with the column's, so the other columns stay as they are.
 */
export function withColumnWidth(n: Node, col: number, room: number | null): Partial<Node> {
  const t = parseTable(n.text);
  const before = tableLayout(t, n, n.rect).rooms;
  const widths: (number | null)[] = Array.from({ length: t.cols }, (_, c) => n.table?.widths?.[c] ?? null);
  widths[col] = room === null ? null : Math.max(1, room);
  while (widths.length && widths[widths.length - 1] === null) widths.pop();
  const { table } = withOptions(n, { widths: widths.length ? widths : undefined });
  const next = { ...n, table };
  const now = room === null ? tableLayout(t, next, { ...n.rect, w: 0 }).rooms[col] : widths[col]!;
  return { table, rect: { ...n.rect, w: n.rect.w + now - (before[col] ?? now) } };
}

/** A change to a table's settings (an undefined one goes back to its default). */
export function withOptions(n: Node, change: Partial<TableOptions>): Partial<Node> {
  const merged: Record<string, unknown> = { ...n.table, ...change };
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k];
  return { table: Object.keys(merged).length ? (merged as TableOptions) : undefined };
}

/** Every column auto-sized again, and the table back to the size of its text. */
export const autoSized = (n: Node): Partial<Node> => ({ ...withOptions(n, { widths: undefined }), autosize: true });

/** A table node's fields for some Markdown table text, at `at`: it fits its cells. */
export function tableNode(text: string, at: { x: number; y: number }) {
  const t = parseTable(text);
  // <br> (as Markdown writes a line break in a cell) is shown as the line break it is.
  const shown = /<br\s*\/?>/i.test(text) || /^\s*(#|\*\*|__)/.test(text) ? tableText(t) : text.trim();
  const fields = { kind: "table" as const, text: shown, autosize: true, lists: false, align: { h: "left" as const, v: "top" as const } };
  const { natural } = tableLayout(t, { border: "single" }, { x: at.x, y: at.y, w: 0, h: 0 });
  return { ...fields, rect: { x: at.x, y: at.y, ...natural } };
}

const escape = (s: string) => s.replace(/\|/g, "\\|");

/**
 * A table's text from its rows: aligned in columns, a divider under the first row (or where
 * `t.dividers` says), a cell's further lines carried on under where it starts.
 */
export function tableText(t: Pick<TableText, "rows"> & Partial<TableText>): string {
  const { rows, dividers = new Set([1]), aligns = [], title } = t;
  const cols = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) => Math.max(3, ...rows.map((r) => lineCount(escape(r[c] ?? "")))));
  const line = (cells: string[]) => {
    let out = "| ";
    let at = 2;
    widths.forEach((w, c) => {
      const ls = escape(cells[c] ?? "").split("\n");
      out += ls[0];
      for (const l of ls.slice(1)) out += "\n" + " ".repeat(at) + l;
      const last = chars(out.slice(out.lastIndexOf("\n") + 1)).length;
      out += " ".repeat(Math.max(0, at + w - last)) + (c < cols - 1 ? " | " : " |");
      at += w + 3;
    });
    return out;
  };
  const rule = (w: number, c: number) =>
    aligns[c] === "center" ? ":" + "-".repeat(w - 2) + ":" : aligns[c] === "right" ? "-".repeat(w - 1) + ":" : "-".repeat(w);
  const out: string[] = title ? [title] : [];
  // Alignment needs a divider row to say it in: under the first row, if there's none.
  const where = dividers.size || !aligns.some((a) => a && a !== "left") ? dividers : new Set([1]);
  rows.forEach((r, i) => {
    if (where.has(i)) out.push("| " + widths.map(rule).join(" | ") + " |");
    out.push(line(r));
  });
  // (A table of just a header row still says how its columns line up.)
  if (where.has(rows.length)) out.push("| " + widths.map(rule).join(" | ") + " |");
  return out.join("\n");
}

/**
 * A table as Markdown to put in a document: the title in bold above it, line breaks in cells as
 * `<br>`, and the one divider Markdown has, under the first row.
 */
export function markdownTable(text: string): string {
  const t = parseTable(text);
  if (!t.rows.length) return "";
  const cols = t.cols;
  const cell = (s: string) => escape(s).replace(/\n/g, "<br>");
  const cells = t.rows.map((r) => Array.from({ length: cols }, (_, c) => cell(r[c] ?? "")));
  const widths = Array.from({ length: cols }, (_, c) => Math.max(3, ...cells.map((r) => chars(r[c]).length)));
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - chars(s).length));
  const line = (r: string[]) => "| " + r.map((s, c) => pad(s, widths[c])).join(" | ") + " |";
  const rule = (w: number, c: number) =>
    t.aligns[c] === "center" ? ":" + "-".repeat(w - 2) + ":" : t.aligns[c] === "right" ? "-".repeat(w - 1) + ":" : "-".repeat(w);
  const out = [line(cells[0]), "| " + widths.map(rule).join(" | ") + " |", ...cells.slice(1).map(line)];
  if (t.title) out.unshift(`**${t.title.replace(/\n/g, " ")}**`, "");
  return out.join("\n");
}

/** A table's text with its title (the lines before the table) changed; "" removes it. */
export function withTitle(text: string, title: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.includes("|"));
  const table = start < 0 ? [] : lines.slice(start);
  const head = title.trim() ? title.split("\n").filter((l) => l.trim() && !l.includes("|")) : [];
  return [...head, ...table].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Editing a table as a table: cells, and rows and columns added, removed and moved.
// ---------------------------------------------------------------------------------------------

/** A cell of a table: its row and column. Row -1 is the title. */
export interface TableCell {
  row: number;
  col: number;
}

/** A table's text written back from its parts (each row given every column). */
const write = (t: TableText): string =>
  tableText({ rows: t.rows.map((r) => Array.from({ length: t.cols }, (_, c) => r[c] ?? "")), dividers: t.dividers, aligns: t.aligns, title: t.title });

/** The cell at `cell` (a grid line counts with the cell after it), or null outside the table. */
export function cellAt(n: Node, cell: Point): TableCell | null {
  if (n.kind !== "table") return null;
  const t = parseTable(n.text);
  const r = n.rect;
  if (!t.rows.length || cell.x < r.x || cell.x > right(r) || cell.y < r.y || cell.y > bottom(r)) return null;
  const l = tableLayout(t, n, r);
  if (t.title && (n.table?.title === "border" ? cell.y === r.y : cell.y < l.columnsFrom)) return { row: -1, col: 0 };
  let col = 0;
  l.edges.forEach((x, c) => {
    if (x <= cell.x) col = c;
  });
  let row = 0;
  l.rowY.forEach((y, i) => {
    if (y - (l.dividers.has(i) ? 1 : 0) <= cell.y) row = i;
  });
  return { row, col };
}

/** Where a cell's text goes (for editing it in place), and the cell's whole area inside its lines. */
export function cellRect(n: Node, at: TableCell): { text: Rect; area: Rect } {
  const t = parseTable(n.text);
  const r = n.rect;
  const l = tableLayout(t, n, r);
  if (at.row < 0) {
    const text = n.table?.title === "border"
      ? { x: r.x + 2, y: r.y, w: Math.max(1, r.w - 4), h: 1 }
      : { x: r.x + 2, y: r.y + 1, w: Math.max(1, r.w - 4), h: Math.max(1, l.titleLines.length) };
    return { text, area: { ...text, x: text.x - 1, w: text.w + 2 } };
  }
  const row = Math.min(at.row, t.rows.length - 1), col = Math.min(at.col, t.cols - 1);
  const text = { x: l.edges[col] + 2, y: l.rowY[row], w: l.rooms[col], h: l.heights[row] };
  return { text, area: { ...text, x: text.x - 1, w: text.w + 2 } };
}

/** What's in a cell (the title, for row -1). */
export function cellText(text: string, at: TableCell): string {
  const t = parseTable(text);
  return at.row < 0 ? t.title ?? "" : t.rows[at.row]?.[at.col] ?? "";
}

/** The table's text with one cell (or the title) changed. */
export function withCellText(text: string, at: TableCell, value: string): string {
  const t = parseTable(text);
  if (at.row < 0) return withTitle(text, value);
  if (!t.rows[at.row]) return text;
  const rows = t.rows.map((r) => [...r]);
  // (Lines after the first keep their indentation: nested list items.)
  rows[at.row][at.col] = value.split("\n").map((l, i) => (i === 0 ? l.trim() : l.trimEnd())).join("\n").replace(/^\n+|\s+$/g, "");
  return write({ ...t, rows });
}

/** The size a table is, as a node, for its (new) text and settings: `w` wide (or as narrow as it
 * goes), and exactly as tall as its rows. */
function refit(n: Node, text: string, table: TableOptions | undefined, w: number): Partial<Node> {
  const next = { ...n, text, table };
  const t = parseTable(text);
  if (n.autosize) {
    const natural = tableLayout(t, next, { ...n.rect, w: 0 }).natural;
    return { text, table, rect: { ...n.rect, ...natural } };
  }
  const width = Math.max(w, tableLayout(t, next, n.rect).least.w);
  return { text, table, rect: { ...n.rect, w: width, h: tableLayout(t, next, { ...n.rect, w: width }).size.h } };
}

/** A cell's text changed, and the table fitted to it (its height follows its rows). */
export function withCell(n: Node, at: TableCell, value: string): Partial<Node> {
  return refit(n, withCellText(n.text, at, value), n.table, n.rect.w);
}

/** The fixed widths, one per column (null: auto-sized). */
const widthsOf = (n: Node, cols: number) => Array.from({ length: cols }, (_, c) => n.table?.widths?.[c] ?? null);

/** Settings with these column widths (trailing auto ones dropped). */
function withWidths(n: Node, widths: (number | null)[]): TableOptions | undefined {
  const w = [...widths];
  while (w.length && w[w.length - 1] === null) w.pop();
  return withOptions(n, { widths: w.length ? w : undefined }).table;
}

/** A divider that isn't the header's moves with the rows below it. */
const shiftDividers = (dividers: Set<number>, f: (d: number) => number | null, rows: number) =>
  new Set([...dividers].map((d) => (d === 1 ? 1 : f(d))).filter((d): d is number => d !== null && d >= 1 && d <= rows));

/** An empty row put in at `at` (0: a new first row, `rows.length`: at the end). */
export function insertRow(n: Node, at: number): Partial<Node> {
  const t = parseTable(n.text);
  const rows = [...t.rows];
  rows.splice(at, 0, Array(t.cols).fill(""));
  const dividers = shiftDividers(t.dividers, (d) => (d > at ? d + 1 : d), rows.length);
  return refit(n, write({ ...t, rows, dividers }), n.table, n.rect.w);
}

/** Row `row` taken out (a table keeps at least one). */
export function deleteRow(n: Node, row: number): Partial<Node> {
  const t = parseTable(n.text);
  if (t.rows.length <= 1) return {};
  const rows = t.rows.filter((_, i) => i !== row);
  const dividers = shiftDividers(t.dividers, (d) => (d > row ? d - 1 : d), rows.length);
  return refit(n, write({ ...t, rows, dividers }), n.table, n.rect.w);
}

/** Row `row` swapped with the one above (by -1) or below (by 1). */
export function moveRow(n: Node, row: number, by: -1 | 1): Partial<Node> {
  const t = parseTable(n.text);
  const to = row + by;
  if (to < 0 || to >= t.rows.length) return {};
  const rows = [...t.rows];
  [rows[row], rows[to]] = [rows[to], rows[row]];
  return refit(n, write({ ...t, rows }), n.table, n.rect.w);
}

/** An empty column put in at `at`, as wide as the one beside it if that has a set width. */
export function insertColumn(n: Node, at: number): Partial<Node> {
  const t = parseTable(n.text);
  const rows = t.rows.map((r) => {
    const cells = Array.from({ length: t.cols }, (_, c) => r[c] ?? "");
    cells.splice(at, 0, "");
    return cells;
  });
  const aligns = Array.from({ length: t.cols }, (_, c) => t.aligns[c] ?? "left");
  aligns.splice(at, 0, "left");
  const widths = widthsOf(n, t.cols);
  const beside = widths[Math.min(at, t.cols - 1)] ?? null;
  widths.splice(at, 0, beside);
  const room = beside ?? 3;
  return refit(n, write({ ...t, rows, aligns, cols: t.cols + 1 }), withWidths(n, widths), n.rect.w + room + 3);
}

/** Column `col` taken out (a table keeps at least one); the table narrows by its width. */
export function deleteColumn(n: Node, col: number): Partial<Node> {
  const t = parseTable(n.text);
  if (t.cols <= 1) return {};
  const room = tableLayout(t, n, n.rect).rooms[col] ?? 0;
  const rows = t.rows.map((r) => Array.from({ length: t.cols }, (_, c) => r[c] ?? "").filter((_, c) => c !== col));
  const aligns = Array.from({ length: t.cols }, (_, c) => t.aligns[c] ?? "left").filter((_, c) => c !== col);
  const widths = widthsOf(n, t.cols).filter((_, c) => c !== col);
  return refit(n, write({ ...t, rows, aligns, cols: t.cols - 1 }), withWidths(n, widths), n.rect.w - room - 3);
}

/** Column `col` swapped with the one to its left (by -1) or right (by 1), width and all. */
export function moveColumn(n: Node, col: number, by: -1 | 1): Partial<Node> {
  const t = parseTable(n.text);
  const to = col + by;
  if (to < 0 || to >= t.cols) return {};
  const swap = <T,>(xs: T[]) => {
    const ys = [...xs];
    [ys[col], ys[to]] = [ys[to], ys[col]];
    return ys;
  };
  const rows = t.rows.map((r) => swap(Array.from({ length: t.cols }, (_, c) => r[c] ?? "")));
  const aligns = swap(Array.from({ length: t.cols }, (_, c) => t.aligns[c] ?? "left"));
  const widths = swap(widthsOf(n, t.cols));
  return refit(n, write({ ...t, rows, aligns }), withWidths(n, widths), n.rect.w);
}

/** How column `col`'s text lines up. */
export function withColumnAlign(n: Node, col: number, align: HAlign): Partial<Node> {
  const t = parseTable(n.text);
  const aligns = Array.from({ length: t.cols }, (_, c) => t.aligns[c] ?? "left");
  aligns[col] = align;
  return refit(n, write({ ...t, aligns }), n.table, n.rect.w);
}

/** Room for a new table's columns when none is given. */
export const NEW_COLUMN = 10;

/**
 * A new, empty table's fields: `cols` columns and `rows` rows (the first one its header), each
 * column `NEW_COLUMN` wide, or (given `width`) sharing that width out.
 */
export function newTable(cols: number, rows: number, at: Point, width?: number) {
  const room = width === undefined ? NEW_COLUMN : Math.max(3, Math.floor((width - (3 * cols + 1)) / cols));
  const t: TableText = { rows: Array.from({ length: rows }, () => Array(cols).fill("")), dividers: new Set([1]), aligns: [], cols };
  const table: TableOptions = { widths: Array(cols).fill(room) };
  const size = tableLayout(t, { border: "single", table }, { x: at.x, y: at.y, w: 0, h: 0 }).natural;
  return {
    kind: "table" as const, text: write(t), table, autosize: false, lists: false,
    align: { h: "left" as const, v: "top" as const }, rect: { x: at.x, y: at.y, ...size },
  };
}
