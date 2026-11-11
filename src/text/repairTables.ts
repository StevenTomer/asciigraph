import { chars } from "../render/textLayout";

/**
 * Tables drawn by hand, or by a tool that miscounted, often have a row whose column lines
 * don't line up with the borders (a cell a few characters short or long). Such a row breaks
 * the table's lines, and the drawing no longer reads as a table. This re-pads every row of a
 * table to its columns, widening a column (and its borders) where a cell's text needs more
 * room. Lines that aren't in a table, and tables already aligned, come back as they were.
 */
const TOP = /^[┌╭╔┏+]$/, SIDE = /^[│┃║|]$/;
const FILL = /^[─━═\-=]$/;

/** A border or divider line: its corner/joint characters and fill, by column. */
function borderParts(c: string[]): { joints: string[]; fill: string[]; widths: number[] } | null {
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
  if (c.length < 2 || !SIDE.test(c[0]) || !SIDE.test(c[c.length - 1])) return null;
  const cells: string[][] = [[]];
  for (let i = 1; i < c.length - 1; i++) {
    if (SIDE.test(c[i])) cells.push([]);
    else cells[cells.length - 1].push(c[i]);
  }
  return cells;
}

export function repairTables(lines: string[]): string[] {
  const out = lines.slice();
  for (let y = 0; y < lines.length; y++) {
    const top = chars(lines[y].trimEnd());
    const indent = top.findIndex((ch) => ch !== " ");
    if (indent < 0 || !TOP.test(top[indent])) continue;
    const head = borderParts(top.slice(indent));
    if (!head) continue;
    const n = head.widths.length;
    // The table's lines: rows with n cells, and borders with n columns, until the bottom one.
    const block: { y: number; border?: ReturnType<typeof borderParts>; row?: string[][] }[] = [{ y, border: head }];
    let end = -1;
    for (let j = y + 1; j < lines.length; j++) {
      const c = chars(lines[j].trimEnd());
      if (c.slice(0, indent).some((ch) => ch !== " ")) break;
      const body = c.slice(indent);
      const row = splitRow(body);
      if (row && row.length === n && !borderParts(body)) { block.push({ y: j, row }); continue; }
      const b = borderParts(body);
      if (b && b.widths.length === n) {
        block.push({ y: j, border: b });
        end = j;
        if (/^[└╰╚┗]$/.test(b.joints[0])) break;
        continue;
      }
      break;
    }
    // It ends at its last border (a bottom corner, or an ASCII + line).
    while (block.length && block[block.length - 1].y > end) block.pop();
    if (end < 0) continue;
    const widths = head.widths.slice();
    let misaligned = block.some((l) => l.border && l.border.widths.some((w, i) => w !== widths[i]));
    for (const l of block) {
      l.row?.forEach((cell, i) => {
        if (cell.length !== widths[i]) misaligned = true;
        widths[i] = Math.max(widths[i], trimEnd(cell).length + 1);
      });
    }
    if (misaligned) {
      const pad = " ".repeat(indent);
      for (const l of block) {
        if (l.border) {
          const { joints, fill } = l.border;
          out[l.y] = pad + joints[0] + widths.map((w, i) => (fill[i] ?? fill[0]).repeat(w) + joints[i + 1]).join("");
        } else {
          const side = chars(lines[l.y]).slice(indent).filter((ch) => SIDE.test(ch))[0];
          out[l.y] = pad + side + l.row!.map((cell, i) => {
            const t = trimEnd(cell);
            return t.join("") + " ".repeat(widths[i] - t.length);
          }).join(side) + side;
        }
      }
    }
    y = end;
  }
  return out;
}

const trimEnd = (c: string[]) => { let n = c.length; while (n && c[n - 1] === " ") n--; return c.slice(0, n); };
