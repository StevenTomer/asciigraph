import { type Rect, bottom, right } from "../geometry/geom";
import type { HAlign, LineStyle } from "../model/types";
import { chars } from "../render/textLayout";
import { box, drawBorder } from "./box";
import type { ShapeDef } from "./registry";

/**
 * A table, from its text written as a Markdown table: cells between |, and a row of dashes for a
 * divider (`:--:` centers that column, `--:` right-aligns it). Columns are as wide as their
 * widest cell; a table drawn bigger than that gives the room to its last column and row.
 *
 *   | Name | Type |          ┌──────┬──────┐
 *   |------|------|    →     │ Name │ Type │
 *   | id   | int  |          ├──────┼──────┤
 *                            │ id   │ int  │
 *                            └──────┴──────┘
 */

export interface TableText {
  rows: string[][];
  /** Rows with a divider above them (indexes into `rows`). */
  dividers: Set<number>;
  aligns: HAlign[];
  cols: number;
}

const SEPARATOR = /^\s*:?-+:?\s*$/;

/** The cells of one line: between |, with the outer ones optional. */
function cellsOf(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

export function parseTable(text: string): TableText {
  const rows: string[][] = [];
  const dividers = new Set<number>();
  let aligns: HAlign[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const cells = cellsOf(line);
    if (cells.length && cells.every((c) => SEPARATOR.test(c))) {
      if (rows.length) dividers.add(rows.length);
      if (!aligns.length) aligns = cells.map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left"));
      continue;
    }
    rows.push(cells);
  }
  const cols = Math.max(1, ...rows.map((r) => r.length), aligns.length);
  return { rows, dividers, aligns, cols };
}

/** Whether text is a Markdown table (a row of cells, then a divider row). */
export function isTableText(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  return lines.length >= 2 && lines.every((l) => l.includes("|")) && cellsOf(lines[1]).every((c) => SEPARATOR.test(c)) && cellsOf(lines[0]).length >= 1;
}

/** Column widths (inside, with a space each side) and row positions for a table in `r`. */
function layout(t: TableText, r: Rect) {
  const widths = Array.from({ length: t.cols }, (_, c) => Math.max(1, ...t.rows.map((row) => chars(row[c] ?? "").length)) + 2);
  const need = widths.reduce((s, w) => s + w, 0) + t.cols + 1;
  if (r.w > need) widths[widths.length - 1] += r.w - need;
  // Each column's left edge (its divider line), from the left border.
  const edges: number[] = [];
  let x = r.x;
  for (const w of widths) {
    edges.push(x);
    x += w + 1;
  }
  const rowY: number[] = [];
  let y = r.y + 1;
  t.rows.forEach((_, i) => {
    if (t.dividers.has(i)) y++;
    rowY.push(y);
    y++;
  });
  return { widths, edges, rowY, need: { w: need, h: t.rows.length + t.dividers.size + 2 } };
}

export const table: ShapeDef = {
  ...box,
  label: "table",
  defaultSize: { w: 21, h: 6 },
  minSize: () => ({ w: 3, h: 3 }),
  contentRect: (n) => ({ x: n.rect.x + 2, y: n.rect.y + 1, w: Math.max(1, n.rect.w - 4), h: Math.max(1, n.rect.h - 2) }),

  fitSize(n, text) {
    // As big as its cells need, at least (a table drawn bigger keeps its size).
    const t = parseTable(text);
    if (!t.rows.length) return { w: n.rect.w, h: n.rect.h };
    const { need } = layout(t, { ...n.rect, w: 0 });
    // Made from text (autosize): just that big, so it shrinks again too.
    if (n.autosize) return need;
    return { w: Math.max(n.rect.w, need.w), h: Math.max(n.rect.h, need.h) };
  },

  rasterize(n, grid) {
    const r = n.rect;
    const style: LineStyle | null = n.border === "none" ? null : n.border === "rounded" ? "single" : n.border;
    if (style) drawBorder(grid, r, n);
    const t = parseTable(n.text);
    if (!t.rows.length) return;
    const { widths, edges, rowY } = layout(t, r);
    const y1 = bottom(r), x1 = right(r);
    if (style) {
      // Column lines, top to bottom, joined to the border (┬ ┴).
      for (const x of edges.slice(1)) {
        if (x >= x1) break;
        for (let y = r.y; y <= y1; y++) grid.stroke({ x, y }, y === r.y ? ["bottom"] : y === y1 ? ["top"] : ["top", "bottom"], style);
      }
      // Dividers, across (├ ┼ ┤).
      for (const i of t.dividers) {
        const y = rowY[i] - 1;
        if (y <= r.y || y >= y1) continue;
        for (let x = r.x; x <= x1; x++) grid.stroke({ x, y }, x === r.x ? ["right"] : x === x1 ? ["left"] : ["left", "right"], style);
      }
    }
    t.rows.forEach((row, i) => {
      const y = rowY[i];
      if (y >= y1) return;
      for (let c = 0; c < t.cols; c++) {
        const text = chars(row[c] ?? "");
        const room = widths[c] - 2;
        const shown = text.length > room ? [...text.slice(0, Math.max(0, room - 1)), "…"] : text;
        const align = t.aligns[c] ?? "left";
        const left = edges[c] + 2 + (align === "right" ? room - shown.length : align === "center" ? Math.floor((room - shown.length) / 2) : 0);
        shown.forEach((ch, j) => {
          if (left + j < x1) grid.setChar({ x: left + j, y }, ch);
        });
      }
    });
  },
};

/** A table node's fields for some Markdown table text, at `at`: it fits its cells. */
export function tableNode(text: string, at: { x: number; y: number }) {
  const t = parseTable(text);
  const { need } = layout(t, { x: at.x, y: at.y, w: 0, h: 0 });
  return { kind: "table" as const, rect: { x: at.x, y: at.y, ...need }, text: text.trim(), autosize: true, lists: false, align: { h: "left" as const, v: "top" as const } };
}

/** A table's Markdown text from rows of cells, with a divider under the first. */
export function tableText(rows: string[][], dividers: Set<number> = new Set([1]), aligns: HAlign[] = []): string {
  const cols = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: cols }, (_, c) => Math.max(3, ...rows.map((r) => chars(r[c] ?? "").length)));
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - chars(s).length));
  const line = (cells: string[]) => "| " + widths.map((w, c) => pad(cells[c] ?? "", w)).join(" | ") + " |";
  const rule = (w: number, c: number) =>
    aligns[c] === "center" ? ":" + "-".repeat(w - 2) + ":" : aligns[c] === "right" ? "-".repeat(w - 1) + ":" : "-".repeat(w);
  const out: string[] = [];
  // Alignment needs a divider row to say it in: under the first row, if there's none.
  const where = dividers.size || !aligns.some((a) => a && a !== "left") ? dividers : new Set([1]);
  rows.forEach((r, i) => {
    if (where.has(i)) out.push("| " + widths.map(rule).join(" | ") + " |");
    out.push(line(r));
  });
  return out.join("\n");
}
