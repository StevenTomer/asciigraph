import { chars } from "../render/textLayout";

/**
 * Tables drawn by hand, or by a tool that miscounted or cut them short, often:
 *  - have a row whose column lines don't line up with the borders (a cell a few characters
 *    short or long), which breaks the table's lines;
 *  - lack their top or bottom border (copied from the middle of a longer one, or drawn as
 *    rows with just a line under the header).
 * Either way the drawing no longer reads as a table. This re-pads every row to its columns,
 * widening a column (and its borders) where a cell's text needs more room, and adds a missing
 * top or bottom border. Lines that aren't in a table, and whole, aligned tables, come back as
 * they were.
 */
const SIDE = /^[│┃║|]$/;
const FILL = /^[─━═\-=]$/;
const TOP = /^[┌╭╔┏]$/, BOTTOM = /^[└╰╚┗]$/;

interface Border { joints: string[]; fill: string[]; widths: number[] }
type Line = { border: Border; row?: undefined } | { row: string[][]; border?: undefined };

/** A border or divider line: its corner/joint characters and fill, by column. */
function borderParts(c: string[]): Border | null {
  if (c.length < 3 || FILL.test(c[0]) || !FILL.test(c[1])) return null;
  const joints = [c[0]], fill: string[] = [], widths: number[] = [];
  let w = 0;
  for (let i = 1; i < c.length; i++) {
    if (FILL.test(c[i])) { w++; if (w === 1) fill.push(c[i]); continue; }
    if (!w) return null;
    widths.push(w); joints.push(c[i]); w = 0;
  }
  return w ? null : { joints, fill, widths };
}

function splitRow(c: string[]): string[][] | null {
  if (c.length < 3 || !SIDE.test(c[0]) || !SIDE.test(c[c.length - 1])) return null;
  const cells: string[][] = [[]];
  for (let i = 1; i < c.length - 1; i++) {
    if (SIDE.test(c[i])) cells.push([]);
    else cells[cells.length - 1].push(c[i]);
  }
  return cells;
}

/** A table line, at `indent`: a border/divider, or a row of cells. */
function parse(line: string, indent: number): Line | null {
  const c = chars(line.trimEnd());
  if (c.slice(0, indent).some((ch) => ch !== " ")) return null;
  const body = c.slice(indent);
  const border = borderParts(body);
  if (border) return { border };
  const row = splitRow(body);
  return row ? { row } : null;
}

/** Whether a line has a line-drawing character at `indent` (box drawing, or ASCII + |). */
const drawnAt = (line: string | undefined, indent: number) => /^[\u2500-\u257f+|]$/.test(chars(line ?? "")[indent] ?? "");

const columns = (l: Line) => (l.border ? l.border.widths.length : l.row.length);
const trimEnd = (c: string[]) => { let n = c.length; while (n && c[n - 1] === " ") n--; return c.slice(0, n); };

/** A top (┌┬┐) or bottom (└┴┘) border in the line style of `b`. */
function edge(b: Border, at: "top" | "bottom"): Border {
  const heavy = b.fill[0] === "━", double = b.fill[0] === "═";
  const ascii = b.joints[0] === "+" || b.fill[0] === "-" || b.fill[0] === "=";
  const [l, m, r] = ascii ? ["+", "+", "+"]
    : at === "top" ? (heavy ? ["┏", "┳", "┓"] : double ? ["╔", "╦", "╗"] : ["┌", "┬", "┐"])
    : (heavy ? ["┗", "┻", "┛"] : double ? ["╚", "╩", "╝"] : ["└", "┴", "┘"]);
  return { joints: [l, ...b.widths.slice(1).map(() => m), r], fill: b.fill, widths: b.widths };
}

export function repairTables(lines: string[]): string[] {
  const out: string[] = [];
  for (let y = 0; y < lines.length; ) {
    const indent = chars(lines[y]).findIndex((ch) => ch !== " ");
    const start = indent < 0 ? null : parse(lines[y], indent);
    // A table starts at its top border or, when that's missing, at a row.
    if (!start || (start.border && !TOP.test(start.border.joints[0]) && start.border.joints[0] !== "+")) {
      out.push(lines[y++]);
      continue;
    }
    const n = columns(start);
    const block: Line[] = [start];
    let j = y + 1;
    for (; j < lines.length; j++) {
      const l = parse(lines[j], indent);
      if (!l || columns(l) !== n || (l.border && TOP.test(l.border.joints[0]))) break;
      block.push(l);
      if (l.border && BOTTOM.test(l.border.joints[0])) { j++; break; }
    }
    const borders = block.filter((l) => l.border).map((l) => l.border!);
    const rows = block.filter((l) => l.row);
    const hasTop = !!start.border;
    const hasBottom = block.length > 1 && !!block[block.length - 1].border;
    // A border is only missing where nothing's drawn next to the rows (not where they carry on
    // as part of something else, like a table's title row above its columns).
    if ((!hasTop && drawnAt(lines[y - 1], indent)) || (!hasBottom && drawnAt(lines[j], indent))) {
      out.push(lines[y++]);
      continue;
    }
    // A whole table, or rows with a divider between them (not just a border above or below).
    const divided = block.some((l, i) => l.border && i > 0 && i < block.length - 1);
    if (!rows.length || !((hasTop && hasBottom) || divided)) {
      out.push(lines[y++]);
      continue;
    }
    const widths = borders[0].widths.slice();
    let changed = !hasTop || !hasBottom || borders.some((b) => b.widths.some((w, i) => w !== widths[i]));
    for (const l of rows) {
      l.row!.forEach((cell, i) => {
        if (cell.length !== widths[i]) changed = true;
        widths[i] = Math.max(widths[i], trimEnd(cell).length + 1);
      });
    }
    if (!changed) {
      out.push(...lines.slice(y, j));
      y = j;
      continue;
    }
    const pad = " ".repeat(indent);
    const side = lines.slice(y, j).map((s) => chars(s).slice(indent).find((ch) => SIDE.test(ch))).find(Boolean) ?? "│";
    const drawBorder = (b: Border) => pad + b.joints[0] + widths.map((w, i) => (b.fill[i] ?? b.fill[0]).repeat(w) + b.joints[i + 1]).join("");
    if (!hasTop) out.push(drawBorder(edge(borders[0], "top")));
    for (const l of block) {
      if (l.border) out.push(drawBorder(l.border));
      else out.push(pad + side + l.row.map((cell, i) => { const t = trimEnd(cell); return t.join("") + " ".repeat(widths[i] - t.length); }).join(side) + side);
    }
    if (!hasBottom) out.push(drawBorder(edge(borders[0], "bottom")));
    y = j;
  }
  return out;
}
