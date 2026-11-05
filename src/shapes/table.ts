import { type Point, type Rect, bottom, right } from "../geometry/geom";
import type { HAlign, LineStyle, Node, TableOptions } from "../model/types";
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
const BR = /<br\s*\/?>/gi;

/** Whether a row's line ends it (with a | that isn't escaped). */
const closes = (line: string) => {
  const t = line.trimEnd();
  return t.endsWith("|") && !t.endsWith("\\|");
};

/** The cells of a row (one line, or several when a cell spans lines): between |, the outer ones
 * optional. Each line of a cell is trimmed; `<br>` starts a new one. */
function cellsOf(row: string): string[] {
  let t = row.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (closes(t)) t = t.trimEnd().slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) =>
    c.replace(BR, "\n").replace(/\\\|/g, "|").split("\n").map((l) => l.trim()).join("\n").trim()
  );
}

/** `**Title**`, `# Title` (as a Markdown export or a README writes it): just the words. */
const titleOf = (line: string) => line.trim().replace(/^#+\s+/, "").replace(/^(\*\*|__)(.*)\1$/, "$2").trim();

export function parseTable(text: string): TableText {
  const lines = text.split("\n");
  let i = 0;
  const title: string[] = [];
  for (; i < lines.length && !lines[i].includes("|"); i++) if (lines[i].trim()) title.push(titleOf(lines[i]));
  // Rows can carry on over lines only in a table whose lines end with |.
  const piped = i < lines.length && lines[i].trim().length > 1 && closes(lines[i]);
  const rows: string[][] = [];
  const dividers = new Set<number>();
  let aligns: HAlign[] = [];
  const row = (raw: string) => {
    const cells = cellsOf(raw);
    if (!raw.includes("\n") && cells.length && cells.every((c) => SEPARATOR.test(c))) {
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
});

/** Auto-sized columns narrow down to this (or their text, if less) before the table stops shrinking. */
const MIN_AUTO = 4;

const lineCount = (text: string) => Math.max(1, ...text.split("\n").map((l) => chars(l).length));

/** A cell's lines in `room` columns: wrapped, or (wrapping off) as written. */
const cellLines = (text: string, room: number, wraps: boolean) => (wraps ? wrap(text, room) : text.split("\n"));

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
  const natural = fixed.map((f, c) => f ?? Math.max(1, ...t.rows.map((row) => lineCount(row[c] ?? ""))));
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
  const titleLines = title && !inBorder ? cellLines(title, Math.max(1, width - 4), o.wrap) : [];
  const heights = t.rows.map((row) => Math.max(1, ...rooms.map((w, c) => cellLines(row[c] ?? "", w, o.wrap).length)));
  const dividers = heights.some((h) => h > 1) ? new Set(t.rows.map((_, i) => i).filter((i) => i > 0)) : t.dividers;
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
        cellLines(row[c] ?? "", rooms[c], o.wrap)
          .slice(0, heights[i])
          .forEach((line, j) => put(line, edges[c] + 2, rowY[i] + j, rooms[c], t.aligns[c] ?? "left"));
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
