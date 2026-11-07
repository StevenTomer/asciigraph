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
/** A cell starting with a tree's lines (│ ├── └──): in a tree table, how deep its row is. */
const BRANCHED = /^(?:│ {3}| {4})*[├└]──( |$)/;
const BR = /\s*<br\s*\/?>\s*/gi;
/** A `<br>` before an indented list item: the indentation stays. */
const BR_KEEP = /\s*<br\s*\/?>( +(?:[-*+]|\d+[.)])\s)/gi;

/** Whether the | at `i` is escaped: an odd number of backslashes right before it. A run of
 * backslashes before a | counts in pairs, each \\ one backslash (as in GitHub's Markdown):
 * `\|` is a | in a cell, `\\|` a backslash then the cell's end, `\\\|` a backslash and a |.
 * Backslashes anywhere else are just backslashes. */
const escapedAt = (s: string, i: number) => {
  let n = 0;
  while (i - n - 1 >= 0 && s[i - n - 1] === "\\") n++;
  return n % 2 === 1;
};

/** Whether a row's line ends it (with a | that isn't escaped). */
const closes = (line: string) => {
  const t = line.trimEnd();
  return t.endsWith("|") && !escapedAt(t, t.length - 1);
};

/**
 * The cells of a row (one line, or several when a cell spans lines): between |, the outer ones
 * optional. A cell's first line is trimmed; the lines after it keep their indentation past where
 * the cell's text starts (so a nested list item stays nested), less anything before it. `<br>`
 * starts a new line (keeping the indentation after it only for a list item).
 */
function cellsOf(row: string): string[] {
  const cells: { text: string; start: number; begin: number }[] = [];
  let text = "";
  let col = 0;
  let start = -1;
  let opened = false;
  const lead = /^\s*\|/.exec(row);
  // Where the cell's text may start: after its | and the one space that usually follows.
  let begin = lead ? lead[0].length + 1 : 0;
  const end = () => {
    cells.push({ text, start: start < 0 ? col : start, begin });
    text = "";
    start = -1;
    begin = col + 2;
  };
  const t = row.replace(/^\s*\|/, (m) => " ".repeat(m.length));
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "\\") {
      let m = 1;
      while (t[i + m] === "\\") m++;
      if (t[i + m] === "|") {
        // Before a |: in pairs, each one backslash; one left over makes the | part of the text.
        if (start < 0) start = col;
        text += "\\".repeat(Math.floor(m / 2)) + (m % 2 ? "|" : "");
        i += m % 2 ? m : m - 1;
        col += m % 2 ? m + 1 : m;
        continue;
      }
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
  return cells.map(({ text: raw, start: at, begin: from }) => {
    const lines = raw.replace(/\r/g, "").split("\n");
    const out = lines.map((l, i) => {
      // A tree's branch (a tree table's first column) keeps the room in front of it: its depth.
      if (i === 0) return (BRANCHED.test(l.trim()) ? " ".repeat(Math.max(0, at - from)) : "") + l.trim();
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
  // (A tree's room written as no-break spaces, as a Markdown export does, is room all the same.)
  const lines = (/[├└]──/.test(text) ? text.replace(/\u00a0/g, " ") : text).split("\n");
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
// Tree tables: the first column is a tree (drawn as `tree` draws folders), the others describe
// each entry. In the text, each first cell starts with the tree's lines down to it:
//
//   | Name        | About       |
//   |-------------|-------------|
//   | src/        | the source  |
//   | ├── main.ts | entry point |
//   | └── ui/     |             |
//   |     └── App | the app     |
//
// Rows above the header's divider are the header; the rest are the tree. A row's depth is read
// from its lines (four characters a level); the lines themselves are drawn from the depths, so
// they're always right, and carry on down past rows that span lines.
// ---------------------------------------------------------------------------------------------

const BRANCH_PREFIX = /^((?:│ {3}| {4})*[├└]──(?: |$))/;

/** A first cell's depth (0 with no tree lines) and its name. */
export function branchOf(cell: string): { level: number; name: string } {
  const m = BRANCH_PREFIX.exec(cell);
  const prefix = m ? m[1] : "";
  // (A row with no name yet has its line's end space trimmed off.)
  return { level: Math.ceil(chars(prefix).length / 4), name: cell.slice(prefix.length).replace(/\s*\n\s*/g, " ").trim() };
}

/** Whether a table's text has tree lines in its first column (so it's a tree table). */
export const hasTree = (t: TableText): boolean => t.rows.some((r) => BRANCH_PREFIX.test(r[0] ?? ""));

/** The first tree row: the one after the header's divider (0 when there's none). */
export const treeStart = (t: Pick<TableText, "dividers" | "rows">): number =>
  Math.min(t.rows.length, ...[...t.dividers].filter((d) => d > 0), t.dividers.size ? Infinity : 0);

/** Each row's depth (-1: a header row), each no more than one below the row before. */
export function treeLevels(t: TableText): number[] {
  const head = treeStart(t);
  let before = -1;
  return t.rows.map((r, i) => {
    if (i < head) return -1;
    before = Math.min(branchOf(r[0] ?? "").level, before + 1);
    return before;
  });
}

export interface TreeRow {
  level: number;
  name: string;
  /** The lines before its name (├── and those of the levels above). */
  prefix: string;
  /** The lines on the row's further lines, when it spans lines: the trunks passing by, and its
   * own going down to its children. */
  through: string;
}

/** The tree's rows (null for header rows), from each row's depth and name. */
export function treeRows(levels: number[], names: string[]): (TreeRow | null)[] {
  // Whether each row is the last of its parent's children.
  const last = levels.map((l, i) => {
    if (l < 0) return true;
    for (let j = i + 1; j < levels.length; j++) if (levels[j] <= l) return levels[j] < l;
    return true;
  });
  const hasChildren = levels.map((l, i) => l >= 0 && i + 1 < levels.length && levels[i + 1] > l);
  const chain: number[] = []; // the row at each depth above, down to this one
  return levels.map((l, i) => {
    if (l < 0) return null;
    chain.length = l;
    chain.push(i);
    const trunk = (row: number) => (last[row] ? "    " : "│   ");
    let prefix = "";
    for (let d = 1; d < l; d++) prefix += trunk(chain[d]);
    if (l > 0) prefix += last[i] ? "└── " : "├── ";
    let through = "";
    for (let d = 1; d <= l; d++) through += trunk(chain[d]);
    if (hasChildren[i]) through += "│";
    return { level: l, name: names[i], prefix, through: through.trimEnd() };
  });
}

/** The tree of a tree table's text (null for a plain table, and for header rows). */
function treeOf(n: Pick<Node, "table">, t: TableText): (TreeRow | null)[] | null {
  if (!n.table?.tree) return null;
  const slashes = n.table.treeSlashes !== false;
  const rows = treeRows(treeLevels(t), t.rows.map((r) => branchOf(r[0] ?? "").name));
  if (n.table.treeLines !== false && slashes) return rows;
  // As drawn: just indented (two a level), and folders without their "/".
  return rows.map((b) => b && {
    ...b,
    ...(n.table!.treeLines === false && { prefix: "  ".repeat(b.level), through: "" }),
    ...(!slashes && b.name.length > 1 && { name: b.name.replace(/\/$/, "") }),
  });
}

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------

const optionsOf = (n: Pick<Node, "table">): Required<Omit<TableOptions, "widths" | "tree" | "treeLines" | "treeSlashes">> & { widths: (number | null)[] } => ({
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
  const tree = treeOf(n, t);
  /** A cell's text as laid out: a tree's entry is its lines and name, on one line. */
  const cellOf = (row: number, c: number) => {
    const b = c === 0 && tree?.[row];
    return b ? b.prefix + b.name : t.rows[row][c] ?? "";
  };
  const fixed = Array.from({ length: t.cols }, (_, c) => o.widths[c] ?? null);
  const natural = fixed.map((f, c) => f ?? Math.max(1, ...t.rows.map((_, i) => cellWidth(cellOf(i, c), o))));
  // (The tree doesn't wrap: its column is as narrow as its widest entry.)
  const least = natural.map((w, c) => (fixed[c] !== null || !o.wrap || (tree && c === 0) ? w : Math.min(w, MIN_AUTO)));
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
  const heights = t.rows.map((_, i) => Math.max(1, ...rooms.map((w, c) => (tree?.[i] && c === 0 ? 1 : cellLines(cellOf(i, c), w, o).length))));
  // A tree's rows aren't lined off (its lines run down through them, and show where each starts):
  // just the header's divider.
  const head = treeStart(t);
  const dividers = tree
    ? new Set(head > 0 && head < t.rows.length ? [head] : [])
    : heights.some((h) => h > 1)
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
    const tree = treeOf(n, t);
    t.rows.forEach((row, i) => {
      const b = tree?.[i];
      for (let c = 0; c < t.cols; c++) {
        if (b && c === 0) {
          // The tree's lines and the entry's name, and its lines carrying on below it.
          put(b.prefix + b.name, edges[0] + 2, rowY[i], rooms[0], "left");
          for (let j = 1; j < heights[i]; j++) put(b.through, edges[0] + 2, rowY[i] + j, rooms[0], "left");
          continue;
        }
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
  // Tree lines in the first column: a tree table (its lines written afresh, so they're right).
  const tree = hasTree(t);
  // <br> (as Markdown writes a line break in a cell) is shown as the line break it is.
  const shown = tree ? write(t, treeLevels(t)) : /<br\s*\/?>/i.test(text) || /^\s*(#|\*\*|__)/.test(text) ? tableText(t) : text.trim();
  const fields = {
    kind: "table" as const, text: shown, autosize: true, lists: false, align: { h: "left" as const, v: "top" as const },
    ...(tree && { table: { tree: true } as TableOptions }),
  };
  const { natural } = tableLayout(parseTable(shown), { border: "single", table: fields.table }, { x: at.x, y: at.y, w: 0, h: 0 });
  return { ...fields, rect: { x: at.x, y: at.y, ...natural } };
}

/** A cell's text as written between |s: each | escaped, and the backslashes right before it
 * doubled (see escapedAt), so it reads back the same. */
const escape = (s: string) => s.replace(/(\\*)\|/g, (_, bs: string) => bs + bs + "\\|");

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
  // A tree's lines with no-break spaces, which Markdown keeps (it would drop a cell's leading
  // spaces, and a page squeeze the rest together).
  const branch = (s: string) => {
    const m = BRANCH_PREFIX.exec(s);
    return m ? m[1].replace(/ /g, "\u00a0") + s.slice(m[1].length) : s;
  };
  const cells = t.rows.map((r) => Array.from({ length: cols }, (_, c) => cell(c === 0 ? branch(r[0] ?? "") : r[c] ?? "")));
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

/**
 * A table's text written back from its parts (each row given every column). A tree table's
 * depths (`levels`, -1 for header rows) are written as the tree's lines at the start of each
 * first cell, drawn afresh (any in other cells, from a column moved, are taken off).
 */
function write(t: TableText, levels?: number[] | null): string {
  let rows = t.rows.map((r) => Array.from({ length: t.cols }, (_, c) => r[c] ?? ""));
  if (levels) {
    const bare = rows.map((r) => r.map((cell) => (BRANCH_PREFIX.test(cell) ? branchOf(cell).name : cell)));
    const tree = treeRows(levels, bare.map((r) => r[0]));
    rows = bare.map((r, i) => (tree[i] ? [tree[i]!.prefix + r[0], ...r.slice(1)] : r));
  }
  return tableText({ rows, dividers: t.dividers, aligns: t.aligns, title: t.title });
}

/** A tree table's depths (null for a plain table). */
const levelsOf = (n: Node, t: TableText) => (n.table?.tree ? treeLevels(t) : null);

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
  // (A tree's entry is typed after its lines.)
  const b = col === 0 ? treeOf(n, t)?.[row] : null;
  const indent = b ? Math.min(chars(b.prefix).length, l.rooms[0] - 1) : 0;
  const text = { x: l.edges[col] + 2 + indent, y: l.rowY[row], w: l.rooms[col] - indent, h: l.heights[row] };
  return { text, area: { ...text, x: l.edges[col] + 1, w: l.rooms[col] + 2 } };
}

/** What's in a cell (the title, for row -1; a tree's entry, without its lines). */
export function cellText(text: string, at: TableCell): string {
  const t = parseTable(text);
  const cell = at.row < 0 ? t.title ?? "" : t.rows[at.row]?.[at.col] ?? "";
  return at.col === 0 && BRANCH_PREFIX.test(cell) ? branchOf(cell).name : cell;
}

/** The table's text with one cell (or the title) changed. */
export function withCellText(text: string, at: TableCell, value: string): string {
  const t = parseTable(text);
  if (at.row < 0) return withTitle(text, value);
  if (!t.rows[at.row]) return text;
  const rows = t.rows.map((r) => [...r]);
  // (Lines after the first keep their indentation: nested list items.)
  const typed = value.split("\n").map((l, i) => (i === 0 ? l.trim() : l.trimEnd())).join("\n").replace(/^\n+|\s+$/g, "");
  // A tree's entry keeps its lines (and its name stays on one line).
  const prefix = at.col === 0 ? BRANCH_PREFIX.exec(rows[at.row][0] ?? "")?.[1] : undefined;
  rows[at.row][at.col] = prefix ? prefix.trimEnd() + " " + typed.replace(/\s*\n\s*/g, " ") : typed;
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
  const levels = levelsOf(n, t);
  // In a tree: as deep as the row it goes above (so it's that one's sibling), or the one before
  // it, at the end.
  levels?.splice(at, 0, at >= treeStart(t) ? Math.max(0, levels[at] ?? levels[at - 1] ?? 0) : -1);
  return refit(n, write({ ...t, rows, dividers }, levels), n.table, n.rect.w);
}

/** Row `row` taken out (a table keeps at least one). */
export function deleteRow(n: Node, row: number): Partial<Node> {
  const t = parseTable(n.text);
  if (t.rows.length <= 1) return {};
  const rows = t.rows.filter((_, i) => i !== row);
  const dividers = shiftDividers(t.dividers, (d) => (d > row ? d - 1 : d), rows.length);
  // In a tree, its children move up a level, into its place.
  let levels = levelsOf(n, t);
  if (levels) {
    const l = levels[row];
    const end = subtreeEnd(levels, row);
    levels = levels.map((v, i) => (i > row && i < end && l >= 0 ? v - 1 : v)).filter((_, i) => i !== row);
  }
  return refit(n, write({ ...t, rows, dividers }, levels), n.table, n.rect.w);
}

/** The row after a tree row's children (and theirs). */
function subtreeEnd(levels: number[], row: number): number {
  let end = row + 1;
  while (end < levels.length && levels[end] > levels[row]) end++;
  return end;
}

/** Where row `row` of a tree goes moved up (by -1) or down (by 1), with its children: past the
 * entry before or after it at its depth. -1 when it can't (it's first or last of its parent's). */
export function treeMoveTarget(n: Node, row: number, by: -1 | 1): number {
  const t = parseTable(n.text);
  const levels = treeLevels(t);
  const l = levels[row];
  if (l < 0) return -1;
  if (by < 0) {
    for (let j = row - 1; j >= 0 && levels[j] >= l; j--) if (levels[j] === l) return j;
    return -1;
  }
  const next = subtreeEnd(levels, row);
  if (next >= levels.length || levels[next] !== l) return -1;
  // Its first row lands where the next one's children end, less its own.
  return row + (subtreeEnd(levels, next) - next);
}

/** A tree row (with its children) moved past its sibling before (-1) or after (1). */
function moveTreeRow(n: Node, t: TableText, row: number, by: -1 | 1): Partial<Node> {
  const levels = treeLevels(t);
  const sibling = by < 0 ? treeMoveTarget(n, row, -1) : subtreeEnd(levels, row);
  if (sibling < 0 || (by > 0 && treeMoveTarget(n, row, 1) < 0)) return {};
  const [a, b] = by < 0 ? [sibling, row] : [row, sibling];
  const aEnd = b, bEnd = subtreeEnd(levels, b);
  const order = [...levels.keys()];
  const moved = [...order.slice(0, a), ...order.slice(b, bEnd), ...order.slice(a, aEnd), ...order.slice(bEnd)];
  return refit(n, write({ ...t, rows: moved.map((i) => t.rows[i]) }, moved.map((i) => levels[i])), n.table, n.rect.w);
}

/** A tree row made a level deeper (by 1: a child of the entry before it) or shallower (by -1),
 * its children going with it. */
export function indentRow(n: Node, row: number, by: -1 | 1): Partial<Node> {
  const t = parseTable(n.text);
  if (!canIndent(n, row, by)) return {};
  const levels = treeLevels(t);
  const end = subtreeEnd(levels, row);
  const next = levels.map((l, i) => (i >= row && i < end ? l + by : l));
  return refit(n, write(t, next), n.table, n.rect.w);
}

/** Whether a tree row can go a level deeper (there's an entry before it at its depth) or
 * shallower (it isn't at the top). */
export function canIndent(n: Node, row: number, by: -1 | 1): boolean {
  if (!n.table?.tree) return false;
  const levels = treeLevels(parseTable(n.text));
  const l = levels[row];
  if (l === undefined || l < 0) return false;
  return by < 0 ? l > 0 : row > 0 && levels[row - 1] >= l;
}

/** A table made a tree table (its first column the tree; rows that say nothing of their depth at
 * the top), or a plain table again (the tree's lines left as text in the first column). */
export function withTree(n: Node, on: boolean): Partial<Node> {
  const table = withOptions(n, { tree: on || undefined }).table;
  if (!on) return refit(n, n.text, table, n.rect.w);
  const t = parseTable(n.text);
  return refit(n, write(t, treeLevels(t)), table, n.rect.w);
}

/** A tree table's tree drawn with or without its lines, and its folders' "/"; the table refitted. */
export function withTreeLook(n: Node, change: Pick<TableOptions, "treeLines" | "treeSlashes">): Partial<Node> {
  return refit(n, n.text, withOptions(n, change).table, n.rect.w);
}

/** Row `row` swapped with the one above (by -1) or below (by 1). */
export function moveRow(n: Node, row: number, by: -1 | 1): Partial<Node> {
  const t = parseTable(n.text);
  const to = row + by;
  if (to < 0 || to >= t.rows.length) return {};
  if (n.table?.tree && row >= treeStart(t)) return moveTreeRow(n, t, row, by);
  const rows = [...t.rows];
  [rows[row], rows[to]] = [rows[to], rows[row]];
  return refit(n, write({ ...t, rows }, levelsOf(n, t)), n.table, n.rect.w);
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
  return refit(n, write({ ...t, rows, aligns, cols: t.cols + 1 }, levelsOf(n, t)), withWidths(n, widths), n.rect.w + room + 3);
}

/** Column `col` taken out (a table keeps at least one); the table narrows by its width. */
export function deleteColumn(n: Node, col: number): Partial<Node> {
  const t = parseTable(n.text);
  if (t.cols <= 1) return {};
  const room = tableLayout(t, n, n.rect).rooms[col] ?? 0;
  const rows = t.rows.map((r) => Array.from({ length: t.cols }, (_, c) => r[c] ?? "").filter((_, c) => c !== col));
  const aligns = Array.from({ length: t.cols }, (_, c) => t.aligns[c] ?? "left").filter((_, c) => c !== col);
  const widths = widthsOf(n, t.cols).filter((_, c) => c !== col);
  return refit(n, write({ ...t, rows, aligns, cols: t.cols - 1 }, levelsOf(n, t)), withWidths(n, widths), n.rect.w - room - 3);
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
  return refit(n, write({ ...t, rows, aligns }, levelsOf(n, t)), withWidths(n, widths), n.rect.w);
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
