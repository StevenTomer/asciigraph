import { type Point, type Side, OPPOSITE, stepSide } from "../geometry/geom";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode } from "../model/ops";
import type { BorderStyle, Diagram, Endpoint, HAlign, Head, Id, LineStyle as AnyLineStyle, NodeKind, VAlign } from "../model/types";
import { DIR_BITS, DOWN, LEFT, RIGHT, UP, asciiChar, lineGlyph } from "../render/charsets";
import { rasterize } from "../render/rasterize";
import { findBuses } from "./busRead";
import { chars } from "../render/textLayout";
import { table, tableNode, tableText } from "../shapes/table";
import { ellipseOutline, ellipseSide } from "../shapes/ellipse";
import { folderOutline, folderTab, stackBehind, stackJoin } from "../shapes/extra";
import { repairTables } from "./repairTables";
import { shapeFor } from "../shapes/registry";
/** The styles a drawing's characters can show (a bus is read back as its two walls). */
type LineStyle = Exclude<AnyLineStyle, "bus">;

/**
 * Reading a drawing back into objects: paste box-drawing (or +--+ ASCII) text and get boxes,
 * connectors and labels that can be moved and restyled.
 *
 *  1. Every character that draws lines gets the directions it connects (┬: left, right, down;
 *     an ASCII + whatever its neighbors reach it from).
 *  2. Boxes: outlines traced from their top-left corners round to where they started. A name may
 *     interrupt the top border (┌─ Name ──┐). Rounded, double, heavy, dashed, dotted and ASCII
 *     borders; a rim under a rounded top is a database, ┬ ┴ bars a subroutine, full-width
 *     ├──┤ rows divide a class box. A box with only boxes inside is a frame.
 *  3. Connectors: the remaining lines, followed from end to end. An end touching a box (a ┴ on
 *     its border, an arrowhead against it, or a line running up to it) is attached to that side.
 *     Arrowheads (► ▷ ◆ ◊ ● ○ × and > < ^ v) are heads; text in a gap in a line (── yes ──►) or
 *     just beside a vertical one is its label. Lines that branch (one trunk to several boxes)
 *     become one connector per branch.
 *  4. What's left is text: inside a box its text (alignment read from the margins), outside
 *     free labels.
 *
 * Connectors are attached by side and routed automatically; where the automatic route would
 * differ from the drawing, the drawn position along the side and then the drawn bends are kept.
 */

export interface ImportResult {
  diagram: Diagram;
  warnings: string[];
  /** How many boxes were found (0: probably not a drawing). */
  boxes: number;
}

const STEP: Record<Side, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
const SIDES: Side[] = ["top", "right", "bottom", "left"];
const BIT: Record<Side, number> = { top: UP, right: RIGHT, bottom: DOWN, left: LEFT };
const popcount = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

interface Glyph {
  mask: number;
  style: LineStyle;
  rounded?: boolean;
}

/** Every line-drawing glyph the renderer makes, with what it connects to; plus a few others. */
const GLYPHS: Map<string, Glyph> = (() => {
  const out = new Map<string, Glyph>();
  const put = (ch: string, g: Glyph) => {
    const had = out.get(ch);
    if (ch && ch !== " " && (!had || popcount(g.mask) > popcount(had.mask))) out.set(ch, g);
  };
  const styles: LineStyle[] = ["single", "double", "heavy", "dashed", "dotted"];
  for (const style of styles) {
    for (let mask = 1; mask < 16; mask++) {
      const s = DIR_BITS.map((b) => (mask & b ? style : undefined));
      put(lineGlyph(s, false, false), { mask, style });
      const r = lineGlyph(s, true, false);
      if (r !== lineGlyph(s, false, false)) put(r, { mask, style, rounded: true });
    }
  }
  // Mixed weights (a single line meeting a double border: ╤).
  const kinds: (LineStyle | undefined)[] = [undefined, "single", "heavy", "double"];
  for (let i = 0; i < 256; i++) {
    const s = [0, 1, 2, 3].map((k) => kinds[(i >> (2 * k)) & 3]);
    const mask = DIR_BITS.reduce((m, b, k) => (s[k] ? m | b : m), 0);
    const g = lineGlyph(s, false, false);
    if (g && !out.has(g)) put(g, { mask, style: "single" });
  }
  for (const [ch, mask, style] of [["╌", LEFT | RIGHT, "dashed"], ["╎", UP | DOWN, "dashed"], ["┅", LEFT | RIGHT, "dashed"], ["┇", UP | DOWN, "dashed"], ["┉", LEFT | RIGHT, "dotted"], ["┋", UP | DOWN, "dotted"]] as const) {
    put(ch, { mask, style });
  }
  return out;
})();

/** Heads: the way a directional one points, or null for those that look the same every way. */
const HEADS: Map<string, { head: Head; points: Side | null; ascii?: boolean }> = new Map([
  ["►", { head: "arrow", points: "right" }], ["▶", { head: "arrow", points: "right" }], ["→", { head: "arrow", points: "right" }],
  ["◄", { head: "arrow", points: "left" }], ["◀", { head: "arrow", points: "left" }], ["←", { head: "arrow", points: "left" }],
  ["▲", { head: "arrow", points: "top" }], ["↑", { head: "arrow", points: "top" }],
  ["▼", { head: "arrow", points: "bottom" }], ["↓", { head: "arrow", points: "bottom" }],
  ["▷", { head: "triangle", points: "right" }], ["◁", { head: "triangle", points: "left" }],
  ["△", { head: "triangle", points: "top" }], ["▽", { head: "triangle", points: "bottom" }],
  ["◆", { head: "diamond", points: null }], ["◊", { head: "hollow-diamond", points: null }], ["◇", { head: "hollow-diamond", points: null }],
  ["●", { head: "dot", points: null }], ["○", { head: "circle", points: null }], ["×", { head: "cross", points: null }],
  [">", { head: "arrow", points: "right", ascii: true }], ["<", { head: "arrow", points: "left", ascii: true }],
  ["^", { head: "arrow", points: "top", ascii: true }], ["v", { head: "arrow", points: "bottom", ascii: true }],
  // ASCII as asciigraph writes it (* o as Mermaid's composition and aggregation, @ a dot, O a
  // circle, A V a hollow arrow; |> <| are read before this), and # as older drawings have it.
  ["*", { head: "diamond", points: null, ascii: true }], ["#", { head: "diamond", points: null, ascii: true }],
  ["o", { head: "hollow-diamond", points: null, ascii: true }], ["@", { head: "dot", points: null, ascii: true }],
  ["O", { head: "circle", points: null, ascii: true }], ["x", { head: "cross", points: null, ascii: true }],
  ["A", { head: "triangle", points: "top", ascii: true }], ["V", { head: "triangle", points: "bottom", ascii: true }],
]);

interface Box {
  x0: number; y0: number; x1: number; y1: number;
  name?: string;
  /** Where the name sits in the top border. */
  nameAlign?: HAlign;
  /** Its cells (x), the spaces either side included. */
  nameSpan?: [number, number];
  border: BorderStyle;
  kind: NodeKind;
  dividers: number[];
  id: Id;
  /** A trapezoid wider at the bottom. */
  flip?: boolean;
  /** Found by drawing its shape there (the rest of the shapes): its text is read from where
   * the shape puts text. */
  generic?: boolean;
  /** Slanted shapes (decision, input/output): their outline cells and the side each is on. */
  cells?: Map<number, Side | null>;
  /** A table's column lines (x), and the line under its title row (y), if it has one. */
  columns?: number[];
  titleRow?: number;
  /** A lifeline: its line's cells (messages attach on either side), and its last row. */
  life?: Set<number>;
  lineEnd?: number;
}

const UP_SLASH = new Set(["╱", "/"]), DOWN_SLASH = new Set(["╲", "\\"]);

interface Terminal {
  /** The path's end cell (outside a box, next to its border). */
  cell: Point;
  head?: Head;
  /** Attached: the box, the side, and the cell on its border. */
  box?: Box;
  side?: Side;
  border?: Point;
  /** A bar head's cell, between the line's end and the border. */
  tip?: Point;
}

export function importAscii(input: string, probe = false): ImportResult {
  const warnings: string[] = [];
  const rows = repairTables(input.replace(/\r/g, "").split("\n").map(expandTabs))
    // An ASCII hollow arrow left or right, |> or <|, at the end of a line: one head (and a line).
    .map((l) => l.replace(/([-+])\|>/g, "$1-▷").replace(/<\|([-+])/g, "◁-$1"))
    .map((l) => chars(l));
  // Leading and trailing blank lines don't matter; nor does a common indent.
  while (rows.length && !rows[0].join("").trim()) rows.shift();
  while (rows.length && !rows[rows.length - 1].join("").trim()) rows.pop();
  const indent = Math.min(...rows.filter((r) => r.join("").trim()).map((r) => r.findIndex((c) => c !== " ")));
  if (indent > 0 && indent < Infinity) rows.forEach((r, i) => (rows[i] = r.slice(indent)));
  const H = rows.length;
  const W = Math.max(0, ...rows.map((r) => r.length));
  const ch = (x: number, y: number) => (y >= 0 && y < H && x >= 0 ? rows[y][x] ?? " " : " ");
  const k = (x: number, y: number) => y * (W + 2) + x + 1;

  // 1. Line masks. ASCII + - | first by themselves, then + by what reaches it.
  const mask = new Map<number, number>();
  const style = new Map<number, LineStyle>();
  const rounded = new Set<number>();
  const asciiCell = new Set<number>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = ch(x, y);
      const g = GLYPHS.get(c);
      if (g) {
        mask.set(k(x, y), g.mask);
        style.set(k(x, y), g.style);
        if (g.rounded) rounded.add(k(x, y));
      } else if (c === "-" || c === "|" || c === "=") {
        mask.set(k(x, y), c === "|" ? UP | DOWN : LEFT | RIGHT);
        style.set(k(x, y), c === "=" ? "double" : "ascii");
        asciiCell.add(k(x, y));
      } else if (c === "+") {
        asciiCell.add(k(x, y));
        style.set(k(x, y), "ascii");
      }
    }
  }
  // A circle's corners in ASCII: . where a curve bends down, ' where it bends up, joined to a -
  // (or the next bend) on one side, the line going on below (or above). (Before the +s, which
  // may join them.)
  const bends = new Set([".", "'"]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = ch(x, y);
      if (!bends.has(c)) continue;
      const joins = (n: string) => n === "-" || n === "+" || (bends.has(n) && n !== c);
      const l = joins(ch(x - 1, y)), r = joins(ch(x + 1, y));
      if (l === r) continue;
      const v = c === "." ? ch(x, y + 1) : ch(x, y - 1);
      if (!(v === "|" || v === "+" || (bends.has(v) && v !== c))) continue;
      mask.set(k(x, y), (c === "." ? DOWN : UP) | (l ? LEFT : RIGHT));
      style.set(k(x, y), "ascii");
      asciiCell.add(k(x, y));
    }
  }
  const reaches = (x: number, y: number, toward: Side): boolean => {
    // Does the cell at (x, y) have a stroke toward `toward`, or is it a + (or an ASCII head
    // pointing away)?
    const c = ch(x, y);
    if (c === "+") return true;
    const m = mask.get(k(x, y));
    if (m !== undefined) return !!(m & BIT[toward]);
    const h = HEADS.get(c);
    return !!h && h.points === OPPOSITE[toward];
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (ch(x, y) !== "+") continue;
      let m = 0;
      for (const s of SIDES) {
        const n = { x: x + STEP[s].x, y: y + STEP[s].y };
        if (ch(n.x, n.y) !== "+" && reaches(n.x, n.y, OPPOSITE[s])) m |= BIT[s];
      }
      // Two + side by side (+-++-+) or one above another still join; so does a start/end
      // shape's ( ) side.
      if (ch(x - 1, y) === "+") m |= LEFT;
      if (ch(x + 1, y) === "+") m |= RIGHT;
      if (ch(x, y - 1) === "+" || ch(x, y - 1) === "(" || ch(x, y - 1) === ")") m |= UP;
      // (A card's corner, right under its cut: /, then +--.)
      if ((ch(x, y - 1) === "/" || ch(x, y - 1) === "\\") && m & (LEFT | RIGHT)) m |= UP;
      if (ch(x, y + 1) === "+" || ch(x, y + 1) === "(" || ch(x, y + 1) === ")") m |= DOWN;
      if (m && popcount(m) >= 2) mask.set(k(x, y), m);
    }
  }

  const has = (x: number, y: number, s: Side) => !!((mask.get(k(x, y)) ?? 0) & BIT[s]);

  // 2. Boxes.
  const boxes: Box[] = [];
  const outline = new Map<number, Box[]>();
  const nameCells = new Set<number>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // A corner: right and down only (├ ┬ ┼ start dividers and branches, not boxes).
      if (!(has(x, y, "right") && has(x, y, "bottom")) || has(x, y, "top") || has(x, y, "left")) continue;
      const b = traceBox(x, y) ?? traceDocument(x, y) ?? traceEllipse(x, y) ?? traceFolder(x, y);
      if (!b) continue;
      boxes.push(b);
    }
  }
  // Decisions (a diamond with < > points) and input/output (a parallelogram), both drawn with
  // slashes and flat tops and bottoms.
  const flatRun = (x: number, y: number) => {
    let e = x;
    while (has(e, y, "left") && has(e, y, "right")) e++;
    return e; // first cell past the run
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (ch(x, y) === "<") traceDecision(x, y);
      if (UP_SLASH.has(ch(x, y)) && has(x + 1, y, "left") && has(x + 1, y, "right")) {
        traceIo(x, y);
        traceHexagon(x, y);
        traceTrapezoid(x, y, true);
      }
      if (DOWN_SLASH.has(ch(x, y)) && has(x + 1, y, "left") && has(x + 1, y, "right")) traceTrapezoid(x, y, false);
    }
  }
  function slanted(kind: NodeKind, x0: number, y0: number, x1: number, y1: number, cells: [number, number, Side | null][]) {
    if (boxes.some((b) => b.x0 === x0 && b.y0 === y0 && b.x1 === x1 && b.y1 === y1)) return;
    const styles = cells.map(([x, y]) => style.get(k(x, y))).filter((s): s is LineStyle => !!s);
    const st = majority(styles) ?? "single";
    boxes.push({ x0, y0, x1, y1, border: st === "dashed" || st === "dotted" ? "single" : st, kind, dividers: [], id: "", cells: new Map(cells.map(([x, y, s]) => [k(x, y), s])) });
  }
  function traceDecision(lx: number, ym: number) {
    // Up and to the right from <: slashes, to a flat top.
    let m = 1;
    while (m < 20 && UP_SLASH.has(ch(lx + m, ym - m)) && DOWN_SLASH.has(ch(lx + m, ym + m)) && !has(lx + m + 1, ym - m, "left")) m++;
    if (!(UP_SLASH.has(ch(lx + m, ym - m)) && DOWN_SLASH.has(ch(lx + m, ym + m)))) return;
    const e = flatRun(lx + m + 1, ym - m);
    if (e === lx + m + 1 || !DOWN_SLASH.has(ch(e, ym - m))) return;
    const rx = e + m;
    if (ch(rx, ym) !== ">" || flatRun(lx + m + 1, ym + m) !== e || !UP_SLASH.has(ch(e, ym + m))) return;
    const cells: [number, number, Side | null][] = [[lx, ym, "left"], [rx, ym, "right"]];
    for (let i = 1; i <= m; i++) cells.push([lx + i, ym - i, null], [lx + i, ym + i, null], [rx - i, ym - i, null], [rx - i, ym + i, null]);
    for (let x = lx + m + 1; x < e; x++) cells.push([x, ym - m, "top"], [x, ym + m, "bottom"]);
    slanted("decision", lx, ym - m, rx, ym + m, cells);
  }
  /** A trapezoid: ╲────╱ on top, each row a column further in, to a flat bottom (or upside down,
   * `flip`: ╱────╲, each row further out). */
  function traceTrapezoid(a: number, y0: number, flip: boolean) {
    const e = flatRun(a + 1, y0);
    const [inL, inR] = flip ? [UP_SLASH, DOWN_SLASH] : [DOWN_SLASH, UP_SLASH];
    if (e === a + 1 || !inR.has(ch(e, y0))) return;
    const step = flip ? -1 : 1;
    let h = 1;
    for (; h < 20; h++) {
      const l = a + step * h, r = e - step * h, y = y0 + h;
      if (!inL.has(ch(l, y)) || !inR.has(ch(r, y))) return;
      if (r - l > 1 && flatRun(l + 1, y) === r) break;
    }
    h++;
    if (h < 3 || h >= 20) return;
    const x0 = flip ? a - (h - 1) : a, x1 = flip ? e + (h - 1) : e, y1 = y0 + h - 1;
    const cells: [number, number, Side | null][] = [];
    for (let i = 0; i < h; i++) {
      const d = flip ? h - 1 - i : i, end = i === 0 || i === h - 1;
      cells.push([x0 + d, y0 + i, end ? null : "left"], [x1 - d, y0 + i, end ? null : "right"]);
    }
    for (let x = a + 1; x < e; x++) cells.push([x, y0, "top"]);
    for (let x = x0 + (flip ? 0 : h - 1) + 1; x < x1 - (flip ? 0 : h - 1); x++) cells.push([x, y1, "bottom"]);
    slanted("trapezoid", x0, y0, x1, y1, cells);
    if (flip) boxes[boxes.length - 1].flip = true;
  }
  function traceHexagon(a: number, y0: number) {
    // ╱────╲ on top; ╱ … ╲ each row further out, then ╲ … ╱ back in, to a flat bottom.
    const e = flatRun(a + 1, y0);
    if (e === a + 1 || !DOWN_SLASH.has(ch(e, y0))) return;
    let k = 1;
    while (k < 20 && UP_SLASH.has(ch(a - k, y0 + k)) && DOWN_SLASH.has(ch(e + k, y0 + k))) k++;
    if (k < 2) return;
    const x0 = a - (k - 1), x1 = e + (k - 1), y1 = y0 + 2 * k - 1;
    for (let j = 0; j < k; j++) {
      if (!DOWN_SLASH.has(ch(x0 + j, y0 + k + j)) || !UP_SLASH.has(ch(x1 - j, y0 + k + j))) return;
    }
    if (flatRun(a + 1, y1) !== e) return;
    const cells: [number, number, Side | null][] = [];
    for (let i = 0; i < 2 * k; i++) {
      const d = i < k ? k - 1 - i : i - k, middle = i === k - 1 || i === k;
      cells.push([x0 + d, y0 + i, middle ? "left" : null], [x1 - d, y0 + i, middle ? "right" : null]);
    }
    for (let x = a + 1; x < e; x++) cells.push([x, y0, "top"], [x, y1, "bottom"]);
    slanted("hexagon", x0, y0, x1, y1, cells);
  }
  function traceIo(a: number, y0: number) {
    // ╱────╱ on top, each row below one column further left, to a flat bottom.
    const b = flatRun(a + 1, y0);
    if (!UP_SLASH.has(ch(b, y0))) return;
    let h = 1;
    while (h < 20 && UP_SLASH.has(ch(a - h, y0 + h)) && UP_SLASH.has(ch(b - h, y0 + h))) {
      h++;
      if (flatRun(a - h + 2, y0 + h - 1) === b - h + 1 && h >= 3) break;
    }
    if (h < 3 || flatRun(a - h + 2, y0 + h - 1) !== b - h + 1) return;
    const x0 = a - (h - 1), x1 = b, y1 = y0 + h - 1, m = Math.floor(h / 2);
    const cells: [number, number, Side | null][] = [];
    for (let i = 0; i < h; i++) {
      cells.push([a - i, y0 + i, i === m ? "left" : null], [b - i, y0 + i, i === m ? "right" : null]);
    }
    for (let x = a + 1; x < b; x++) cells.push([x, y0, "top"]);
    for (let x = x0 + 1; x < b - h + 1; x++) cells.push([x, y1, "bottom"]);
    slanted("io", x0, y0, x1, y1, cells);
  }
  /**
   * A document: straight top and sides, a wavy bottom across its last two rows (╰──╮  ╭──╯ over
   * ╰──╯). Walked clockwise from the top-left corner, keeping the inside on the right (so at a
   * junction, where a connector leaves, it turns right rather than going out along it).
   */
  /** An outline walked clockwise from a top-left corner (null if it doesn't come back). */
  function walk(x0: number, y0: number, straightFirst = false): Point[] | null {
    const RIGHT_OF: Record<Side, Side> = { right: "bottom", bottom: "left", left: "top", top: "right" };
    const LEFT_OF: Record<Side, Side> = { right: "top", top: "left", left: "bottom", bottom: "right" };
    // First step: right, along the top (clockwise).
    const cells: Point[] = [{ x: x0, y: y0 }, { x: x0 + 1, y: y0 }];
    let p = { x: x0 + 1, y: y0 }, dir: Side = "right";
    for (let steps = 0; steps < 4 * (W + H); steps++) {
      // (Straight on first past lines that branch inward: a lined document's.)
      const options: Side[] = (straightFirst ? [dir, RIGHT_OF[dir], LEFT_OF[dir]] : [RIGHT_OF[dir], dir, LEFT_OF[dir]]).filter((s) => {
        const n = { x: p.x + STEP[s].x, y: p.y + STEP[s].y };
        return has(p.x, p.y, s) && has(n.x, n.y, OPPOSITE[s]);
      });
      if (!options.length) return null;
      dir = options[0];
      p = { x: p.x + STEP[dir].x, y: p.y + STEP[dir].y };
      if (p.x === x0 && p.y === y0) return cells;
      cells.push(p);
    }
    return null;
  }

  /** A circle (shapes/ellipse.ts): exactly the outline the renderer draws for its bounds. */
  function traceEllipse(x0: number, y0: number): Box | null {
    const cells = walk(x0, y0);
    if (!cells || cells.length < 12) return null;
    const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
    const rect = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs) + 1, h: Math.max(...ys) - Math.min(...ys) + 1 };
    if (rect.y !== y0 || rect.h < 5 || rect.h % 2 === 0 || rect.w < 9) return null;
    const want = ellipseOutline(rect);
    // From its own top-left corner only (not a step lower down), and the same cells exactly.
    if (want[0].x !== x0 || want.length !== cells.length) return null;
    const got = new Set(cells.map((c) => k(c.x, c.y)));
    if (!want.every((c) => got.has(k(c.x, c.y)))) return null;
    const x1 = rect.x + rect.w - 1, y1 = rect.y + rect.h - 1;
    if (boxes.some((b) => b.x0 === rect.x && b.y0 === rect.y && b.x1 === x1 && b.y1 === y1)) return null;
    const edge = cells.filter((c) => mask.get(k(c.x, c.y)) === (LEFT | RIGHT)).map((c) => style.get(k(c.x, c.y))!);
    const st = majority(edge) ?? "single";
    return {
      x0: rect.x, y0: rect.y, x1, y1, border: st === "dashed" || st === "dotted" ? st : st, kind: "ellipse", dividers: [], id: "",
      cells: new Map(cells.map((c) => [k(c.x, c.y), ellipseSide(rect, c)])),
    };
  }

  /** A folder (shapes/extra.ts): exactly the outline the renderer draws for its bounds. */
  function traceFolder(x0: number, y0: number): Box | null {
    const cells = walk(x0, y0);
    if (!cells || cells.length < 14) return null;
    const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
    const rect = { x: x0, y: y0, w: Math.max(...xs) - x0 + 1, h: Math.max(...ys) - y0 + 1 };
    if (Math.min(...xs) !== x0 || Math.min(...ys) !== y0 || rect.w < 7 || rect.h < 4) return null;
    const want = folderOutline(rect);
    if (want.length !== cells.length) return null;
    const got = new Set(cells.map((c) => k(c.x, c.y)));
    if (!want.every((c) => got.has(k(c.x, c.y)))) return null;
    const x1 = x0 + rect.w - 1, y1 = y0 + rect.h - 1, tx = x0 + folderTab(rect.w);
    const edge = cells.filter((c) => mask.get(k(c.x, c.y)) === (LEFT | RIGHT)).map((c) => style.get(k(c.x, c.y))!);
    const st = majority(edge) ?? "single";
    const border: BorderStyle = st === "single" && rounded.has(k(x0, y0)) ? "rounded" : st;
    const side = (c: Point): Side | null =>
      c.y === y0 && c.x > x0 && c.x < tx ? "top"
      : c.y === y1 && c.x > x0 && c.x < x1 ? "bottom"
      : c.x === x0 && c.y > y0 && c.y < y1 ? "left"
      : c.x === x1 && c.y > y0 + 1 && c.y < y1 ? "right"
      : null;
    return { x0, y0, x1, y1, border, kind: "folder", dividers: [], id: "", cells: new Map(cells.map((c) => [k(c.x, c.y), side(c)])) };
  }

  function traceDocument(x0: number, y0: number): Box | null {
    const cells = walk(x0, y0);
    if (!cells) return null;
    const x1 = Math.max(...cells.map((c) => c.x)), y1 = Math.max(...cells.map((c) => c.y));
    if (x1 - x0 < 6 || y1 - y0 < 3 || boxes.some((b) => b.x0 === x0 && b.y0 === y0)) return null;
    // The top runs all the way across, the left side straight down to the crest row, and the
    // bottom two rows hold everything else (the wave).
    const on = new Set(cells.map((c) => k(c.x, c.y)));
    for (let x = x0; x <= x1; x++) if (!on.has(k(x, y0))) return null;
    for (let y = y0; y <= y1 - 1; y++) if (!on.has(k(x0, y))) return null;
    if (cells.some((c) => c.y > y0 && c.y < y1 - 1 && c.x !== x0 && c.x !== x1)) return null;
    const trough = cells.filter((c) => c.y === y1);
    if (!trough.length || trough.length === x1 - x0 + 1) return null;
    const side = (c: Point): Side | null =>
      c.y === y0 && c.x > x0 && c.x < x1 ? "top"
      : c.x === x0 && c.y > y0 && c.y < y1 - 1 ? "left"
      : c.x === x1 && c.y > y0 && c.y < y1 - 1 ? "right"
      : c.y === y1 && has(c.x, c.y, "left") && has(c.x, c.y, "right") ? "bottom"
      : null;
    const edge = cells.filter((c) => c.y === y0 && mask.get(k(c.x, c.y)) === (LEFT | RIGHT)).map((c) => style.get(k(c.x, c.y))!);
    const st = majority(edge) ?? "single";
    return {
      x0, y0, x1, y1, border: st === "dashed" || st === "dotted" ? st : st, kind: "document", dividers: [], id: "",
      cells: new Map(cells.map((c) => [k(c.x, c.y), side(c)])),
    };
  }

  function traceBox(x0: number, y0: number): Box | null {
    // Along the top, allowing one gap for a name.
    let x = x0 + 1, name: string | undefined, nameStart = -1, nameEnd = -1;
    for (;;) {
      if (x >= W) return null;
      if (has(x, y0, "left")) {
        if (has(x, y0, "bottom") && !has(x, y0, "right")) {
          if (has(x, y0, "top")) return null;
          break;
        }
        if (!has(x, y0, "right")) return null;
        x++;
        continue;
      }
      if (name !== undefined || ch(x, y0) !== " " || !has(x - 1, y0, "right")) return null;
      let e = x + 1;
      while (e < W && !has(e, y0, "left")) e++;
      const text = rows[y0].slice(x, e).join("");
      if (e >= W || ch(e - 1, y0) !== " " || !text.trim()) return null;
      name = text.trim();
      nameStart = x;
      nameEnd = e - 1;
      x = e;
    }
    const x1 = x;
    let y = y0 + 1;
    // A start/end shape has ( ) for sides; a delay, a straight left side and ) on the right.
    let stadium = false, delayed = false;
    for (;;) {
      if (y < H && ch(x1, y) === ")" && ch(x0, y) === "(") {
        stadium = true;
        y++;
        continue;
      }
      if (y < H && ch(x1, y) === ")" && has(x0, y, "top") && has(x0, y, "bottom")) {
        delayed = true;
        y++;
        continue;
      }
      if (y >= H || !has(x1, y, "top")) return null;
      if (has(x1, y, "left") && !has(x1, y, "bottom")) {
        if (has(x1, y, "right")) return null;
        break;
      }
      if (!has(x1, y, "bottom")) return null;
      y++;
    }
    const y1 = y;
    for (let xx = x1 - 1; xx > x0; xx--) if (!(has(xx, y1, "left") && has(xx, y1, "right"))) return null;
    if (!(has(x0, y1, "top") && has(x0, y1, "right")) || has(x0, y1, "left") || has(x0, y1, "bottom")) return null;
    for (let yy = y1 - 1; yy > y0; yy--) if (!(has(x0, yy, "top") && has(x0, yy, "bottom")) && !(stadium && ch(x0, yy) === "(")) return null;
    if (boxes.some((b) => b.x0 === x0 && b.y0 === y0 && b.x1 === x1 && b.y1 === y1)) return null;

    // The border's style: from its top edge (ignoring the corners and any junctions).
    const edgeStyles: LineStyle[] = [];
    for (let xx = x0 + 1; xx < x1; xx++) if (mask.get(k(xx, y0)) === (LEFT | RIGHT)) edgeStyles.push(style.get(k(xx, y0))!);
    for (let yy = y0 + 1; yy < y1; yy++) if (mask.get(k(x0, yy)) === (UP | DOWN)) edgeStyles.push(style.get(k(x0, yy))!);
    const st = majority(edgeStyles) ?? "single";
    // (A delay's right corners are always round: its left ones say.)
    const isRounded = delayed ? rounded.has(k(x0, y0)) || rounded.has(k(x0, y1)) : rounded.has(k(x0, y0)) || rounded.has(k(x1, y1));
    const border: BorderStyle = isRounded && st === "single" ? "rounded" : st;
    const b: Box = { x0, y0, x1, y1, name, border, kind: stadium ? "terminal" : delayed && !stadium ? "delay" : "box", dividers: [], id: "" };
    if (nameStart >= 0) {
      b.nameSpan = [nameStart, nameEnd];
      b.nameAlign = nameStart === x0 + 2 ? "left" : nameEnd === x1 - 2 ? "right" : "center";
    }
    if (nameStart >= 0) for (let xx = nameStart; xx <= nameEnd; xx++) nameCells.add(k(xx, y0));
    return b;
  }
  // Stacks: a box or document with another behind it, up and to the right (┌┴───┐│ … ├┘, as
  // shapes/extra.ts draws it).
  for (const b of boxes) {
    if ((b.kind !== "box" && b.kind !== "document") || (b.kind === "box" && b.cells)) continue;
    const whole = { x: b.x0, y: b.y0 - 1, w: b.x1 - b.x0 + 2, h: b.y1 - b.y0 + 2 };
    const join = stackJoin(whole, b.kind === "document");
    const behind = stackBehind(whole, join);
    const joined = behind.every((p, i) => {
      if (i === 0) return true;
      const s = stepSide(behind[i - 1], p);
      return has(behind[i - 1].x, behind[i - 1].y, s) && has(p.x, p.y, OPPOSITE[s]);
    });
    if (!joined || b.y1 - b.y0 < 2) continue;
    const fx1 = b.x1, fy0 = b.y0;
    const sides = new Map<number, Side | null>();
    if (b.cells) {
      for (const [key, side] of b.cells) sides.set(key, side);
    } else {
      for (let x = b.x0; x <= b.x1; x++) sides.set(k(x, b.y0), null).set(k(x, b.y1), x > b.x0 && x < b.x1 ? "bottom" : null);
      for (let y = b.y0 + 1; y < b.y1; y++) sides.set(k(b.x0, y), "left").set(k(b.x1, y), "right");
    }
    // The one behind has the top, and the right side down to where it joins the front one.
    for (let x = b.x0; x <= fx1; x++) sides.set(k(x, fy0), null);
    for (let y = fy0; y <= join; y++) sides.set(k(fx1, y), null);
    for (const p of behind) {
      const top = p.y === fy0 - 1 && p.x > b.x0 + 1 && p.x < fx1 + 1, side = p.x === fx1 + 1 && p.y >= fy0 && p.y < join;
      sides.set(k(p.x, p.y), top ? "top" : side ? "right" : sides.get(k(p.x, p.y)) ?? null);
    }
    b.kind = b.kind === "document" ? "docs" : "stack";
    b.cells = sides;
    b.y0 = fy0 - 1;
    b.x1 = fx1 + 1;
  }
  // Actors: a stick figure (○ ╱│╲ ╱ ╲, or o /|\ / \), its name under it.
  for (let y = 0; y + 2 < H; y++) {
    for (let x = 1; x < W; x++) {
      if (!["○", "o", "O"].includes(ch(x, y)) || ch(x - 1, y) !== " " || ch(x + 1, y) !== " ") continue;
      if (!UP_SLASH.has(ch(x - 1, y + 1)) || !["│", "|"].includes(ch(x, y + 1)) || !DOWN_SLASH.has(ch(x + 1, y + 1))) continue;
      if (!UP_SLASH.has(ch(x - 1, y + 2)) || ch(x, y + 2) !== " " || !DOWN_SLASH.has(ch(x + 1, y + 2))) continue;
      // The name: words (single spaces between) across the figure's column, row by row.
      const lines: { x: number; text: string }[] = [];
      for (let r = y + 3; r < H; r++) {
        let s0 = ch(x, r) !== " " ? x : ch(x - 1, r) !== " " ? x - 1 : -1;
        if (s0 < 0) break;
        let s1 = s0;
        while (s0 > 0 && (ch(s0 - 1, r) !== " " || (ch(s0 - 2, r) !== " " && s0 - 2 >= 0))) s0--;
        while (s1 + 1 < W && (ch(s1 + 1, r) !== " " || ch(s1 + 2, r) !== " ")) s1++;
        while (ch(s1, r) === " ") s1--;
        while (ch(s0, r) === " ") s0++;
        if (Array.from({ length: s1 - s0 + 1 }, (_, i) => s0 + i).some((xx) => mask.has(k(xx, r)) && ch(xx, r) !== "-")) break;
        lines.push({ x: s0, text: rows[r].slice(s0, s1 + 1).join("") });
      }
      const w = Math.max(3, ...lines.map((l) => chars(l.text).length));
      const x0 = x - Math.floor((w - 1) / 2), x1 = x0 + w - 1, y1 = y + 2 + lines.length;
      const cells = new Map<number, Side | null>([
        [k(x, y), "top"], [k(x - 1, y + 1), "left"], [k(x, y + 1), null], [k(x + 1, y + 1), "right"],
        [k(x - 1, y + 2), lines.length ? null : "bottom"], [k(x + 1, y + 2), lines.length ? null : "bottom"],
      ]);
      if (!lines.length) cells.set(k(x, y + 2), "bottom");
      for (let r = y + 3; r <= y1; r++) for (let xx = x0; xx <= x1; xx++) cells.set(k(xx, r), r === y1 ? "bottom" : null);
      for (const key of cells.keys()) mask.delete(key);
      boxes.push({ x0, y0: y, x1, y1, border: "single", kind: "actor", dividers: [], id: "", cells, name: lines.map((l) => l.text).join("\n") });
    }
  }
  // The rest of the shapes (shapes/symbols.ts): wherever one is drawn exactly as the renderer
  // draws it. Candidate places come from the boxes found so far, outlines walked straight round,
  // and a few telltale characters; each candidate is checked by drawing the shape there.
  {
    const candidates: { rect: { x: number; y: number; w: number; h: number }; kinds: NodeKind[] }[] = [];
    const add = (x0: number, y0: number, x1: number, y1: number, kinds: NodeKind[]) => {
      if (x1 >= x0 && y1 >= y0) candidates.push({ rect: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, kinds });
    };
    /** Down a side from (x, y) to its bottom corner. */
    const down = (x: number, y: number) => {
      while (y < H && has(x, y, "bottom")) y++;
      return y;
    };
    for (const b of boxes) {
      if (b.cells) continue;
      add(b.x0, b.y0, b.x1, b.y1, ["disk", "storage", "divided", "lined", "summary"]);
      add(b.x0 - 2, b.y0, b.x1, b.y1, ["component"]);
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = ch(x, y);
        if (has(x, y, "right") && has(x, y, "bottom") && !has(x, y, "top") && !has(x, y, "left")) {
          const cells = walk(x, y, true);
          if (cells) {
            const xs = cells.map((p) => p.x), ys = cells.map((p) => p.y);
            add(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), ["cloud", "tape", "manual", "lineddoc"]);
          }
          // Stored data: ( down both sides.
          if (ch(x, y + 1) === "(") {
            let yy = y + 1;
            while (ch(x, yy) === "(") yy++;
            add(x, y, flatRun(x + 1, y), yy, ["stored"]);
          }
        }
        const flatAfter = has(x + 1, y, "left") && has(x + 1, y, "right");
        if (UP_SLASH.has(c) && flatAfter) {
          // A card or loop limit: a cut corner, then the top.
          const e = flatRun(x + 1, y), x1 = DOWN_SLASH.has(ch(e, y)) ? e + 1 : e;
          add(x - 1, y, x1, down(x1, y + 1), ["card", "loop"]);
        }
        if (DOWN_SLASH.has(c) && flatAfter) {
          const e = flatRun(x + 1, y);
          add(x, y, e, down(e, y + 1), ["flag"]);
          // Merge and collate: narrowing rows below.
          let i = 1;
          while (DOWN_SLASH.has(ch(x + i, y + i)) && UP_SLASH.has(ch(e - i, y + i)) && e - i > x + i) i++;
          add(x, y, e, y + i - 1, ["merge"]);
          add(x, y, e, y + (e - x), ["collate"]);
        }
        if (UP_SLASH.has(c) && DOWN_SLASH.has(ch(x + 1, y))) {
          let h = 1;
          while (UP_SLASH.has(ch(x - h, y + h)) && DOWN_SLASH.has(ch(x + 1 + h, y + h))) h++;
          add(x - (h - 1), y, x + h, y + h - 1, ["extract"]);
        }
        if (c === "<") {
          let m = 1;
          while (UP_SLASH.has(ch(x + m, y - m))) m++;
          m--;
          add(x, y - m, flatRun(x + m + 1, y - m), y + m, ["display"]);
        }
        // Dots: ● or ◉ (o or @ in ASCII) with nothing round them but connectors running into
        // them. (One at the end of a connector, right by a box, is the connector's head.)
        if (c === "●" || c === "◉" || c === "o" || c === "@") {
          let lines = 0, clear = true;
          for (const s of SIDES) {
            const n = { x: x + STEP[s].x, y: y + STEP[s].y }, nc = ch(n.x, n.y);
            if (nc === " ") continue;
            if (has(n.x, n.y, OPPOSITE[s]) || HEADS.get(nc)?.points === OPPOSITE[s]) lines++;
            else clear = false;
          }
          const ascii = c === "o" || c === "@";
          if (clear && (lines || !ascii)) add(x, y, x, y, [c === "●" || c === "o" ? "dot" : "ring"]);
        }
      }
    }
    const drawnBy = (kind: NodeKind, rect: { x: number; y: number; w: number; h: number }, border: BorderStyle) => {
      const node = makeNode(rect, { kind, border });
      const placed = addNode(emptyDiagram(), node);
      const n = placed.nodes[node.id];
      if (n.rect.w !== rect.w || n.rect.h !== rect.h) return null;
      return { node: n, grid: rasterize(placed).grid };
    };
    const ROUND = new Set(["╭", "╮", "╰", "╯"]);
    const SQUARE = new Set(["┌", "┐", "└", "┘"]);
    /** Whether the drawing has `kind` at `rect` (with this border): every cell the renderer draws
     * for it, and no line of its own running inside it (that's some other shape). */
    const fits = (kind: NodeKind, rect: { x: number; y: number; w: number; h: number }, border: BorderStyle) => {
      const d = drawnBy(kind, rect, border);
      if (!d) return null;
      const drawn = new Set<number>();
      for (const key of d.grid.cells.keys()) {
        const [x, y] = key.split(",").map(Number);
        if (d.grid.glyph({ x, y }) && d.grid.glyph({ x, y }) !== " ") drawn.add(k(x, y));
      }
      // Inside it: what can't be reached from outside without crossing what it draws.
      const outside = new Set<number>();
      {
        const x0 = rect.x - 1, y0 = rect.y - 1, x1 = rect.x + rect.w, y1 = rect.y + rect.h;
        const stack: Point[] = [{ x: x0, y: y0 }];
        outside.add(k(x0, y0));
        while (stack.length) {
          const p = stack.pop()!;
          for (const s of SIDES) {
            const n = { x: p.x + STEP[s].x, y: p.y + STEP[s].y };
            if (n.x < x0 || n.x > x1 || n.y < y0 || n.y > y1 || outside.has(k(n.x, n.y)) || drawn.has(k(n.x, n.y))) continue;
            outside.add(k(n.x, n.y));
            stack.push(n);
          }
        }
      }
      for (const [key, cell] of d.grid.cells) {
        const [x, y] = key.split(",").map(Number);
        const g = d.grid.glyph({ x, y });
        if (!g || g === " ") continue;
        const c = ch(x, y);
        if (cell.ch === undefined && cell.mask) {
          const m = mask.get(k(x, y)) ?? 0;
          // Only where it joins more of the line: a stub reaching toward a slash (a loop limit's
          // sides) can't show in ASCII, where it's a +.
          let need = cell.mask;
          for (const s of SIDES) {
            const n = d.grid.get({ x: x + STEP[s].x, y: y + STEP[s].y });
            if (!n || n.ch !== undefined || !n.mask) need &= ~BIT[s];
          }
          if ((m & need) !== need) return null;
          if ((ROUND.has(g) && SQUARE.has(c)) || (SQUARE.has(g) && ROUND.has(c))) return null;
          // A line going on inside it.
          for (const s of SIDES) {
            if (!(m & BIT[s]) || cell.mask & BIT[s]) continue;
            const n = { x: x + STEP[s].x, y: y + STEP[s].y };
            if (!drawn.has(k(n.x, n.y)) && !outside.has(k(n.x, n.y))) return null;
          }
        } else if (c !== g && c !== asciiChar(g)) return null;
      }
      return { ...d, drawn };
    };
    const tried = new Set<string>();
    for (const { rect, kinds } of candidates) {
      // (Not where another shape is already: a circle can look like a small cloud.)
      const x1 = rect.x + rect.w - 1, y1 = rect.y + rect.h - 1;
      if (boxes.some((b) => (b.generic || b.cells) && b.x0 === rect.x && b.y0 === rect.y && b.x1 === x1 && b.y1 === y1)) continue;
      for (const kind of kinds) {
        const key = `${kind} ${rect.x} ${rect.y} ${rect.w} ${rect.h}`;
        if (tried.has(key)) continue;
        tried.add(key);
        // The border: the style of most of its lines (single or rounded: whichever fits).
        const styles = [] as LineStyle[];
        for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
          const st = style.get(k(x, y));
          if (st && (mask.get(k(x, y)) === (LEFT | RIGHT) || mask.get(k(x, y)) === (UP | DOWN))) styles.push(st);
        }
        const st = majority(styles) ?? "single";
        // (In ASCII a divided box is a database: that wins.)
        if (kind === "divided" && st === "ascii") continue;
        const borders: BorderStyle[] = st === "single" ? ["single", "rounded"] : [st === "dashed" || st === "dotted" ? st : st];
        let found: ReturnType<typeof fits> = null, border: BorderStyle = "single";
        for (const b of borders) {
          found = fits(kind, rect, b);
          if (found) {
            border = b;
            break;
          }
        }
        if (!found) continue;
        // It takes the place of what was found there before as part of it (the box at a
        // component's middle, say).
        for (let i = boxes.length - 1; i >= 0; i--) {
          const b = boxes[i];
          const inside = b.x0 >= rect.x && b.x1 < rect.x + rect.w && b.y0 >= rect.y && b.y1 < rect.y + rect.h;
          const part = b.cells ? [...b.cells.keys()].some((c) => found!.drawn.has(c)) : found.drawn.has(k(b.x0, b.y0)) || found.drawn.has(k(b.x1, b.y1));
          if (inside && part) boxes.splice(i, 1);
        }
        const shape = shapeFor(kind), cells = new Map<number, Side | null>();
        for (const c of found.drawn) cells.set(c, null);
        for (const side of SIDES) {
          const [lo, hi] = shape.sideRange(found.node, side);
          for (let along = lo; along <= hi; along++) {
            const r = found.node.rect;
            const a = shape.anchor?.(found.node, side, along) ??
              (side === "top" ? { x: along, y: r.y } : side === "bottom" ? { x: along, y: r.y + r.h - 1 } : side === "left" ? { x: r.x, y: along } : { x: r.x + r.w - 1, y: along });
            cells.set(k(a.x, a.y), side);
          }
        }
        boxes.push({ x0: rect.x, y0: rect.y, x1: rect.x + rect.w - 1, y1: rect.y + rect.h - 1, border, kind, dividers: [], id: "", cells, generic: true });
        break;
      }
    }
  }
  if (probe) return { diagram: emptyDiagram(), warnings, boxes: boxes.length };
  // Outline cells, and what's inside each box (its structure: rims, bars, dividers).
  const structure = new Set<number>();
  for (const b of boxes) {
    if (b.cells) {
      for (const key of b.cells.keys()) outline.set(key, [...(outline.get(key) ?? []), b]);
      continue;
    }
    for (let x = b.x0; x <= b.x1; x++) for (const y of [b.y0, b.y1]) addOutline(x, y, b);
    for (let y = b.y0 + 1; y < b.y1; y++) for (const x of [b.x0, b.x1]) addOutline(x, y, b);
    const fullRow = (y: number) => {
      for (let x = b.x0 + 1; x < b.x1; x++) if (!(has(x, y, "left") && has(x, y, "right"))) return false;
      return has(b.x0, y, "right") && has(b.x1, y, "left");
    };
    const fullColumn = (x: number) => {
      for (let y = b.y0 + 1; y < b.y1; y++) if (!(has(x, y, "top") && has(x, y, "bottom"))) return false;
      // (Under a name set in the top border, the line's top end is hidden.)
      const named = b.nameSpan && x >= b.nameSpan[0] && x <= b.nameSpan[1];
      return (has(x, b.y0, "bottom") || !!named) && has(x, b.y1, "top");
    };
    const rows = [];
    for (let y = b.y0 + 1; y < b.y1; y++) if (fullRow(y)) rows.push(y);
    const markRow = (y: number) => {
      for (let x = b.x0 + 1; x < b.x1; x++) structure.add(k(x, y));
    };
    const markColumn = (x: number) => {
      for (let y = b.y0 + 1; y < b.y1; y++) structure.add(k(x, y));
    };
    // A note's folded corner: ┬╮ over ╰┤.
    if (has(b.x1 - 1, b.y0, "bottom") && has(b.x1 - 1, b.y0 + 1, "top") && has(b.x1 - 1, b.y0 + 1, "right") && has(b.x1, b.y0 + 1, "left") && b.y1 - b.y0 >= 2) {
      b.kind = "note";
      structure.add(k(b.x1 - 1, b.y0 + 1));
    } else if ((b.border === "rounded" || b.border === "ascii") && rows[0] === b.y0 + 1 && b.y1 - b.y0 >= 3) {
      b.kind = "database";
      markRow(b.y0 + 1);
      rows.shift();
    } else if (b.x1 - b.x0 >= 7 && fullColumn(b.x1 - 2) && !rows.length
      && !Array.from({ length: b.x1 - b.x0 - 3 }, (_, i) => b.x0 + 1 + i).some(fullColumn)
      && Array.from({ length: b.y1 - b.y0 - 1 }, (_, i) => b.y0 + 1 + i).every((y) => ch(b.x1 - 1, y) === " ")) {
      // A queue: a cylinder on its side, its rim (the near end) two columns in from the right.
      b.kind = "queue";
      markColumn(b.x1 - 2);
    } else if (b.x1 - b.x0 >= 6 && fullColumn(b.x0 + 2) && fullColumn(b.x1 - 2) && !rows.length
      && !Array.from({ length: b.x1 - b.x0 - 5 }, (_, i) => b.x0 + 3 + i).some(fullColumn)) {
      b.kind = "subroutine";
      markColumn(b.x0 + 2);
      markColumn(b.x1 - 2);
    } else {
      // Column lines all the way down: a table (with any full-width rows its dividers).
      const columns: number[] = [];
      for (let x = b.x0 + 1; x < b.x1; x++) if (fullColumn(x)) columns.push(x);
      if (columns.length) {
        b.kind = "table";
        b.columns = columns;
        b.dividers = rows;
        columns.forEach(markColumn);
        rows.forEach(markRow);
        continue;
      }
      // Column lines from the first divider down, and none above: a table with a title row.
      if (rows.length) {
        const top = rows[0];
        const fromTitle = (x: number) => {
          for (let y = top + 1; y < b.y1; y++) if (!(has(x, y, "top") && has(x, y, "bottom"))) return false;
          return has(x, top, "bottom") && !has(x, top, "top") && has(x, b.y1, "top");
        };
        for (let x = b.x0 + 1; x < b.x1; x++) if (fromTitle(x)) columns.push(x);
        if (columns.length) {
          b.kind = "table";
          b.columns = columns;
          b.titleRow = top;
          b.dividers = rows.slice(1);
          for (const x of columns) for (let y = top + 1; y < b.y1; y++) structure.add(k(x, y));
          rows.forEach(markRow);
          continue;
        }
      }
    }
    if (rows.length) {
      b.kind = "class";
      b.dividers = rows;
      rows.forEach(markRow);
    }
  }
  function addOutline(x: number, y: number, b: Box) {
    const key = k(x, y);
    outline.set(key, [...(outline.get(key) ?? []), b]);
  }
  const inBox = (x: number, y: number, b: Box) => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1;

  // Lifelines: a three-row box with a line straight down from the middle of its bottom, through
  // any activation bars on it (│ │ boxes three wide), to where it stops. Dashed (as drawn here),
  // or with messages touching it.
  for (const b of boxes) {
    if (b.kind !== "box" || b.y1 - b.y0 !== 2 || b.cells) continue;
    const cx = b.x0 + Math.floor((b.x1 - b.x0) / 2);
    if (!has(cx, b.y1, "bottom")) continue;
    const life = new Set<number>(), bars: Box[] = [];
    let y = b.y1 + 1, end = b.y1, dashed = 0, solid = 0, touched = false, turns = false;
    for (;;) {
      const bar = boxes.find((a) => a !== b && a.x0 === cx - 1 && a.x1 === cx + 1 && a.y0 === y && has(cx, y, "top"));
      if (bar) {
        bars.push(bar);
        end = bar.y1;
        if (!has(cx, bar.y1, "bottom")) break;
        y = bar.y1 + 1;
        continue;
      }
      // A frame's border drawn across the line (a loop or alt block): it carries on below.
      const border = (outline.has(k(cx, y)) && has(cx, y, "left") && has(cx, y, "right") && !has(cx, y, "top")) || nameCells.has(k(cx, y));
      if (border && has(cx, y + 1, "top") && has(cx, y - 1, "bottom")) {
        y++;
        continue;
      }
      if (!has(cx, y, "top") || outline.has(k(cx, y))) break;
      life.add(k(cx, y));
      const st = style.get(k(cx, y));
      if (st === "dashed" || st === "dotted") dashed++;
      else if (mask.get(k(cx, y)) === (UP | DOWN)) solid++;
      if (has(cx, y, "left") || has(cx, y, "right") || HEADS.has(ch(cx - 1, y)) || HEADS.has(ch(cx + 1, y))) touched = true;
      end = y;
      // A line that turns a corner (a tree's trunk └──) isn't a lifeline.
      if (!has(cx, y, "bottom")) {
        turns = true;
        break;
      }
      y++;
    }
    if (turns || end - b.y1 < 2 || (dashed < solid && !touched && !bars.length)) continue;
    b.kind = "lifeline";
    b.life = life;
    b.lineEnd = end;
    for (const key of life) outline.set(key, [...(outline.get(key) ?? []), b]);
    for (const bar of bars) bar.kind = "activation";
  }
  /** The side of `b` a border cell is on (null for corners). */
  const sideOf = (b: Box, x: number, y: number): Side | null => {
    if (b.cells) return b.cells.get(k(x, y)) ?? null;
    const corner = (x === b.x0 || x === b.x1) && (y === b.y0 || y === b.y1);
    if (corner) return null;
    return y === b.y0 ? "top" : y === b.y1 ? "bottom" : x === b.x0 ? "left" : x === b.x1 ? "right" : null;
  };

  // Bar heads: a crossbar just outside a border (─┤│, -|| in ASCII), with a line running into it.
  const barAt = new Map<number, { box: Box; side: Side; border: Point }>();
  for (const b of boxes) {
    if (b.cells) continue;
    for (const [key, owners] of outline) {
      if (!owners.includes(b)) continue;
      const x = key % (W + 2) - 1, y = Math.floor(key / (W + 2));
      const side = sideOf(b, x, y);
      if (!side) continue;
      const q = { x: x + STEP[side].x, y: y + STEP[side].y }, beyond = { x: q.x + STEP[side].x, y: q.y + STEP[side].y };
      const across: Side[] = side === "left" || side === "right" ? ["top", "bottom"] : ["left", "right"];
      const c = ch(q.x, q.y);
      const isBar = c === (side === "left" || side === "right" ? "|" : "-")
        ? asciiCell.has(k(beyond.x, beyond.y)) || ch(beyond.x, beyond.y) === "+"
        : mask.get(k(q.x, q.y)) === (BIT[across[0]] | BIT[across[1]] | BIT[side]) && !outline.has(k(q.x, q.y));
      if (isBar && has(beyond.x, beyond.y, OPPOSITE[side]) && !outline.has(k(beyond.x, beyond.y))) {
        barAt.set(k(q.x, q.y), { box: b, side, border: { x, y } });
        structure.add(k(q.x, q.y));
      }
    }
  }

  // 3. Connectors. Line cells: strokes not on an outline or inside a box's structure.
  // A line crossing a border (┼ on a frame's top) goes on through it.
  const crossing = (x: number, y: number) =>
    outline.get(k(x, y))!.every((b) => {
      if (b.life?.has(k(x, y))) return has(x, y, "left") && has(x, y, "right");
      const side = sideOf(b, x, y);
      if (side === "top" || side === "bottom") return has(x, y, "top") && has(x, y, "bottom");
      if (side === "left" || side === "right") return has(x, y, "left") && has(x, y, "right");
      return false;
    });
  const isLine = (x: number, y: number) => mask.has(k(x, y)) && !structure.has(k(x, y)) && (!outline.has(k(x, y)) || crossing(x, y));
  /** A head's character, unless it's a letter in a word (the o in "auto-increment"). */
  const alnum = (x: number, y: number) => /[\p{L}\p{N}]/u.test(ch(x, y));
  const headChar = (x: number, y: number) => {
    const c = ch(x, y);
    return HEADS.has(c) && !(/\p{L}/u.test(c) && (alnum(x - 1, y) || alnum(x + 1, y)));
  };
  // Buses (three-wide bands, render/bus.ts): found first, and taken off the lines.
  const busUsed = new Set<number>();
  const buses = findBuses<Box>({
    ch,
    // (An ASCII crossbar beside a border reads as a bar head on a line: a bus's may be one.)
    maskAt: (x, y) => (structure.has(k(x, y)) && !barAt.has(k(x, y)) ? 0 : mask.get(k(x, y)) ?? 0),
    isOutline: (x, y) => outline.has(k(x, y)),
    isAscii: (x, y) => asciiCell.has(k(x, y)),
    isHeavy: (x, y) => style.get(k(x, y)) === "heavy",
    boxAt: (p, side) => outline.get(k(p.x, p.y))?.find((o) => sideOf(o, p.x, p.y) === side) ?? null,
    headOf: (c) => HEADS.get(c),
  }, W, H);
  for (const b of buses) {
    for (const { p, mask: bits } of b.strokes) {
      const left = (mask.get(k(p.x, p.y)) ?? 0) & ~bits;
      if (left) mask.set(k(p.x, p.y), left);
      else mask.delete(k(p.x, p.y));
    }
    for (const p of b.cells) {
      busUsed.add(k(p.x, p.y));
      if (barAt.delete(k(p.x, p.y))) structure.delete(k(p.x, p.y));
    }
  }
  // ASCII strokes that don't join anything (a hyphen in a word, a | between words) are text.
  {
    const seen = new Set<number>();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!isLine(x, y) || seen.has(k(x, y)) || !asciiCell.has(k(x, y))) continue;
        const comp: Point[] = [];
        let structural = false;
        const stack = [{ x, y }];
        seen.add(k(x, y));
        while (stack.length) {
          const p = stack.pop()!;
          comp.push(p);
          if (!asciiCell.has(k(p.x, p.y)) || ch(p.x, p.y) === "+") structural = true;
          for (const s of SIDES) {
            if (!has(p.x, p.y, s)) continue;
            const n = { x: p.x + STEP[s].x, y: p.y + STEP[s].y };
            if (outline.has(k(n.x, n.y)) || headChar(n.x, n.y)) structural = true;
            if (isLine(n.x, n.y) && has(n.x, n.y, OPPOSITE[s]) && !seen.has(k(n.x, n.y))) {
              seen.add(k(n.x, n.y));
              stack.push(n);
            }
          }
        }
        // (A hyphen joining a word: x-ray.)
        const hyphen = comp.length === 1 && ch(x, y) === "-" && alnum(x + 1, y) && (alnum(x - 1, y) || headChar(x - 1, y));
        if ((!structural || hyphen) && comp.length < 3) for (const p of comp) mask.delete(k(p.x, p.y));
      }
    }
  }
  /** Heads: next to a line that runs into them. */
  const headAt = new Map<number, { head: Head; points: Side }>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const h = headChar(x, y) ? HEADS.get(ch(x, y)) : undefined;
      if (!h || outline.has(k(x, y))) continue;
      const backs = SIDES.filter((s) => {
        const n = { x: x + STEP[s].x, y: y + STEP[s].y };
        return isLine(n.x, n.y) && has(n.x, n.y, OPPOSITE[s]);
      });
      if (h.points) {
        if (backs.includes(OPPOSITE[h.points]) && (!h.ascii || backs.length === 1)) headAt.set(k(x, y), { head: h.head, points: h.points });
      } else if (backs.length === 1) {
        headAt.set(k(x, y), { head: h.head, points: OPPOSITE[backs[0]] });
      }
    }
  }
  // Labels in a gap in a horizontal line: ── yes ──►
  const bridges = new Map<number, { to: Point; label: string; cells: number[] }>();
  const labelCells = new Set<number>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isLine(x, y) || !has(x, y, "right") || ch(x + 1, y) !== " ") continue;
      if (isLine(x + 1, y) || outline.has(k(x + 1, y))) continue;
      let e = x + 2;
      while (e < W && e - x < 60 && !mask.has(k(e, y)) && !headAt.has(k(e, y)) && !(ch(e, y) === " " && ch(e + 1, y) === " ")) e++;
      if (!(ch(e - 1, y) === " " && isLine(e, y) && has(e, y, "left"))) continue;
      const label = rows[y].slice(x + 2, e - 1).join("");
      if (!label.trim() || boxes.some((b) => inBox(x + 1, y, b) !== inBox(e, y, b))) continue;
      const cells = [];
      for (let xx = x + 1; xx < e; xx++) cells.push(k(xx, y));
      bridges.set(k(x, y), { to: { x: e, y }, label: label.trim(), cells });
      cells.forEach((c) => labelCells.add(c));
    }
  }
  /** Where a path can go from a cell: joined line cells, heads, and across label gaps. */
  const next = (p: Point): Point[] => {
    const out: Point[] = [];
    for (const s of SIDES) {
      if (!has(p.x, p.y, s) && !(headAt.has(k(p.x, p.y)) && headAt.get(k(p.x, p.y))!.points === OPPOSITE[s])) continue;
      const n = { x: p.x + STEP[s].x, y: p.y + STEP[s].y };
      if (isLine(n.x, n.y) && (has(n.x, n.y, OPPOSITE[s]) || headAt.has(k(p.x, p.y)))) out.push(n);
      else if (headAt.has(k(n.x, n.y)) && headAt.get(k(n.x, n.y))!.points === s) out.push(n);
    }
    const br = bridges.get(k(p.x, p.y));
    if (br) out.push(br.to);
    for (const [from, b] of bridges) if (b.to.x === p.x && b.to.y === p.y) out.push({ x: from % (W + 2) - 1, y: Math.floor(from / (W + 2)) });
    return out;
  };
  /** A path end at `p`: attached to a box if it touches one where it points. */
  const terminalAt = (p: Point): Terminal | null => {
    const h = headAt.get(k(p.x, p.y));
    const ways = SIDES.filter((s) => (h ? h.points === s : has(p.x, p.y, s)));
    const joined = next(p).length;
    for (const s of ways) {
      const bar = barAt.get(k(p.x + STEP[s].x, p.y + STEP[s].y));
      if (bar && bar.side === OPPOSITE[s]) return { cell: p, box: bar.box, side: bar.side, border: bar.border, head: "bar", tip: { x: p.x + STEP[s].x, y: p.y + STEP[s].y } };
      // Touching a border (or, as hand-drawn ASCII often is, a space or two short of one).
      for (let gap = 1; gap <= 3; gap++) {
        const n = { x: p.x + STEP[s].x * gap, y: p.y + STEP[s].y * gap };
        const owners = outline.get(k(n.x, n.y));
        if (owners) {
          // The box whose border this is, from the outside.
          // (A lifeline's line takes messages from either side.)
          // (A dot takes connectors on every side.)
          const b = owners.find((o) => sideOf(o, n.x, n.y) === OPPOSITE[s] || (o.life?.has(k(n.x, n.y)) && (s === "left" || s === "right")) || o.kind === "dot" || o.kind === "ring");
          if (b) return { cell: p, box: b, side: OPPOSITE[s], border: n, head: h?.head };
        }
        if (ch(n.x, n.y) !== " " || joined > 1) break;
      }
    }
    if (h) return { cell: p, head: h.head };
    if (joined <= 1) return { cell: p };
    return null;
  };

  // Walk each set of joined line cells: its ends, and the path between each pair.
  const visited = new Set<number>();
  /** `labelAt`: where the label's text starts as drawn, and the path cell it goes by. */
  type LabelAt = { start: Point; cell: Point };
  const edges: {
    from: Terminal; to: Terminal; path: Point[]; label?: string; labelAt?: LabelAt; endLabels?: { start?: string; end?: string };
    /** A bus (its style isn't in its cells), which reaches 2 cells either side of its path. */
    bus?: boolean;
  }[] = buses.map((b) => ({ from: b.from, to: b.to, path: b.path, label: b.label, labelAt: b.labelAt, bus: true }));
  const allLine: Point[] = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isLine(x, y) || headAt.has(k(x, y))) allLine.push({ x, y });
  for (const start of allLine) {
    if (visited.has(k(start.x, start.y))) continue;
    const comp: Point[] = [];
    const stack = [start];
    visited.add(k(start.x, start.y));
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      for (const n of next(p)) {
        if (!visited.has(k(n.x, n.y))) {
          visited.add(k(n.x, n.y));
          stack.push(n);
        }
      }
    }
    const terms = comp.map(terminalAt).filter((t): t is Terminal => t !== null);
    // A line inside a box from its border to its border, with nothing outside: part of the box.
    if (terms.length && terms.every((t) => t.box && t.box === terms[0].box && inBox(t.cell.x, t.cell.y, t.box))) {
      warnings.push("lines dividing a box into columns are left out");
      continue;
    }
    if (terms.length < 2) {
      if (comp.length > 1) warnings.push(`a line at row ${comp[0].y + 1} doesn't end anywhere; left out`);
      continue;
    }
    // Pair the ends: from the one(s) without a head to the one(s) with.
    const plain = terms.filter((t) => !t.head), headed = terms.filter((t) => t.head);
    let pairs: [Terminal, Terminal][];
    if (terms.length === 2) pairs = [[plain.length === 1 ? plain[0] : terms[0], plain.length === 1 ? headed[0] : terms[1]]];
    else if (plain.length === 1) pairs = headed.map((t) => [plain[0], t]);
    else if (headed.length === 1) pairs = plain.map((t) => [t, headed[0]]);
    else if (headed.length === 0) {
      // A tree of plain lines: from its top (or left) end to every other.
      const root = [...terms].sort((a, b) => a.cell.y - b.cell.y || a.cell.x - b.cell.x)[0];
      pairs = terms.filter((t) => t !== root).map((t) => [root, t]);
    } else {
      // Several each way: each headed end from the nearest plain one.
      pairs = headed.map((t) => [plain.sort((a, b) => dist(a.cell, t.cell) - dist(b.cell, t.cell))[0] ?? terms[0], t]);
      for (const p of plain) if (!pairs.some(([a]) => a === p)) pairs.push([p, headed[0]]);
    }
    for (const [a, b] of pairs) {
      const found = shortest(a.cell, b.cell, next, k);
      if (!found) continue;
      const path = [...(a.tip ? [a.tip] : []), ...found, ...(b.tip ? [b.tip] : [])];
      // Its label: a gap it crosses. (Where the label's middle is, to put it back there.)
      const on = new Set(path.map((p) => k(p.x, p.y)));
      let label: string | undefined, labelAt: LabelAt | undefined;
      for (const [from, br] of bridges) {
        if (label === undefined && on.has(from) && on.has(k(br.to.x, br.to.y))) {
          label = br.label;
          const x0 = from % (W + 2) - 1 + 2, y = br.to.y;
          labelAt = { start: { x: x0, y }, cell: { x: x0 + Math.floor((chars(br.label).length - 1) / 2), y } };
        }
      }
      edges.push({ from: a, to: b, path, label, labelAt });
    }
  }
  // Labels just beside a vertical line (│ label): the nearest connector's, if it has none.
  const used = new Set<number>([...labelCells, ...nameCells, ...busUsed]);
  const runs = textRuns(rows, W, (x, y) => {
    const key = k(x, y);
    return mask.has(key) || outline.has(key) || structure.has(key) || headAt.has(key) || used.has(key);
  });
  // End labels first: short text right by an end, where the renderer puts it (placeEndLabel):
  // above or below a line leaving sideways, beside one leaving up or down.
  const taken2 = new Set<string>();
  for (const e of edges) {
    if (e.path.length < 2) continue;
    for (const which of ["start", "end"] as const) {
      const cells = which === "start" ? e.path : [...e.path].reverse();
      const p0 = cells[0], away = stepSide(p0, cells[1]), s = e.bus ? 2 : 1;
      const fits = (r: { x: number; y: number; len: number }) =>
        away === "right" ? r.x === p0.x + 1 && (r.y === p0.y - s || r.y === p0.y + s)
        : away === "left" ? r.x + r.len === p0.x && (r.y === p0.y - s || r.y === p0.y + s)
        : r.y === p0.y && (r.x === p0.x + 1 + s || r.x + r.len === p0.x - s);
      const run = runs.find((r) => !taken2.has(`${r.x},${r.y}`) && r.len <= 16 && !r.text.includes("  ") && fits(r));
      if (!run) continue;
      taken2.add(`${run.x},${run.y}`);
      (e.endLabels ??= {})[which] = run.text;
      for (let x = run.x; x < run.x + run.len; x++) used.add(k(x, run.y));
    }
  }
  for (const run of runs) {
    if (run.text.includes("  ") || taken2.has(`${run.x},${run.y}`)) continue;
    for (const e of edges) {
      if (e.label) continue;
      const s = e.bus ? 2 : 1;
      const besideAt = (p: Point) => p.y === run.y && (run.x === p.x + 1 + s || run.x + run.len === p.x - s);
      const beside = e.path.some((p, i) => {
        const vertical = (i > 0 && e.path[i - 1].x === p.x) || (i + 1 < e.path.length && e.path[i + 1].x === p.x);
        return vertical && besideAt(p);
      });
      if (beside && !boxes.some((b) => inBox(run.x, run.y, b) !== inBox(e.path[0].x, e.path[0].y, b))) {
        e.label = run.text;
        const cell = e.path.find(besideAt)!;
        e.labelAt = { start: { x: run.x, y: run.y }, cell };
        for (let x = run.x; x < run.x + run.len; x++) used.add(k(x, run.y));
        break;
      }
    }
  }

  // 4. Text. Inside boxes (the innermost holding it), then free labels.
  const taken = (x: number, y: number) => {
    const key = k(x, y);
    return mask.has(key) || outline.has(key) || structure.has(key) || headAt.has(key) || used.has(key);
  };
  const inner = (b: Box) => boxes.filter((o) => o !== b && o.x0 > b.x0 && o.x1 < b.x1 && o.y0 > b.y0 && o.y1 < b.y1);
  const innermostAt = (x: number, y: number) =>
    boxes.filter((b) => inBox(x, y, b)).sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0))[0];
  let d = emptyDiagram();
  // Outer boxes first, so paint order puts contents in front.
  const area = (b: Box) => (b.x1 - b.x0) * ((b.lineEnd ?? b.y1) - b.y0);
  const byArea = [...boxes].sort((a, b) => area(b) - area(a));
  for (const b of byArea) {
    const insideOthers = inner(b);
    const free = (x: number, y: number) => !taken(x, y) && innermostAt(x, y) === b && !insideOthers.some((o) => x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1);
    if (b.kind === "table" && b.columns) {
      // Its cells, row by row, as a Markdown table (dividers where it has them).
      const bounds = [b.x0, ...b.columns, b.x1];
      const divs = new Set(b.dividers);
      const text = (x0: number, x1: number, y: number) => {
        let raw = "";
        for (let x = x0; x < x1; x++) raw += free(x, y) ? rows[y]?.[x] ?? " " : " ";
        return raw;
      };
      // A title row: its lines, and where they sit.
      let title: string | undefined, titleAlign: HAlign = "center";
      if (b.titleRow !== undefined) {
        const lines = Array.from({ length: b.titleRow - b.y0 - 1 }, (_, i) => text(b.x0 + 1, b.x1, b.y0 + 1 + i)).filter((l) => l.trim());
        if (lines.length) {
          title = lines.map((l) => l.trim()).join("\n");
          const l = Math.min(...lines.map((s) => s.length - s.trimStart().length)), r = Math.min(...lines.map((s) => s.length - s.trimEnd().length));
          titleAlign = l === 1 && r > 1 ? "left" : r === 1 && l > 1 ? "right" : "center";
        }
      }
      // Lines between dividers.
      const groups: string[][][] = [];
      const pads: { l: number; r: number }[][] = bounds.slice(1).map(() => []);
      for (let y = (b.titleRow ?? b.y0) + 1; y < b.y1; y++) {
        if (divs.has(y) || !groups.length) {
          groups.push([]);
          if (divs.has(y)) continue;
        }
        groups[groups.length - 1].push(bounds.slice(1).map((x1, c) => {
          const raw = text(bounds[c] + 1, x1, y);
          if (raw.trim()) pads[c].push({ l: raw.length - raw.trimStart().length, r: raw.length - raw.trimEnd().length });
          // (As drawn, less trailing space: a list's indentation matters.)
          return raw.trimEnd();
        }));
      }
      // Every row lined off, and lines that start with an empty cell carrying on the one above:
      // rows spanning lines (as a table whose rows span lines is drawn).
      const joined = groups.map((g) => g.reduce<string[][]>((acc, line) => {
        if (acc.length && !line[0].trim()) acc[acc.length - 1] = acc[acc.length - 1].map((c, i) => (line[i].trim() ? (c.trim() ? c + "\n" : "") + line[i] : c));
        else acc.push(line);
        return acc;
      }, []));
      const spans = groups.length > 1 && joined.every((g) => g.length === 1) && groups.some((g) => g.length > 1);
      const cellRows: string[][] = [], dividerAt = new Set<number>();
      (spans ? joined : groups).forEach((g, i) => {
        // (Rows spanning lines are all lined off anyway: just the header's line is written.)
        if (i > 0 && (!spans || i === 1)) dividerAt.add(cellRows.length);
        cellRows.push(...g.map((row) => row.map(cellFromLines)));
      });
      // Each column's alignment, from where its text sits.
      const aligns: HAlign[] = pads.map((ps) =>
        ps.length && ps.every((p) => p.r === 1) && ps.some((p) => p.l > 1) ? "right"
        : ps.length && ps.every((p) => Math.abs(p.l - p.r) <= 1) && ps.some((p) => p.l > 1) ? "center"
        : "left");
      // A name in the top border is the table's title, there.
      const options = {
        ...(b.name && title === undefined && { title: "border" as const }),
        ...(titleAlign !== "center" && { titleAlign }),
        ...(b.name && title === undefined && b.nameAlign !== "center" && { titleAlign: b.nameAlign }),
      };
      title ??= b.name;
      const fields = { ...tableNode(tableText({ rows: cellRows, dividers: dividerAt, aligns, title }), { x: b.x0, y: b.y0 }), border: b.border, ...(Object.keys(options).length && { table: options }) };
      const t = { ...fields, rect: { ...fields.rect, ...table.fitSize({ ...makeNode(fields.rect, fields) }, fields.text) } };
      const node = makeNode(t.rect, t);
      b.id = node.id;
      d = addNode(d, node);
      continue;
    }
    if (b.generic) {
      const n0 = makeNode({ x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 }, { kind: b.kind, border: b.border });
      const c = shapeFor(b.kind).contentRect(n0);
      const t = readText(rows, c.x - 1, c.x + c.w, c.y, c.y + c.h - 1, free);
      const node = { ...n0, text: t.text, align: { h: t.h, v: t.v } };
      b.id = node.id;
      d = addNode(d, node);
      continue;
    }
    if (b.kind === "actor") {
      const node = makeNode({ x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 }, { kind: "actor", text: b.name ?? "", align: { h: "center", v: "top" } });
      b.id = node.id;
      d = addNode(d, node);
      continue;
    }
    const parts: { y0: number; y1: number }[] = [];
    // (A stack's text is in the front one, below the edge of the one behind; a folder's, below
    // its tab.)
    const stacked = b.kind === "stack" || b.kind === "docs";
    let top = stacked || b.kind === "folder" ? b.y0 + 2 : b.y0 + 1;
    for (const dy of [...b.dividers, b.y1]) {
      parts.push({ y0: top, y1: dy - 1 });
      top = dy + 1;
    }
    // (A queue's text is left of its rim; a stack's, inside the front one.)
    const left = b.x0 + 1, right = b.kind === "queue" ? b.x1 - 3 : stacked ? b.x1 - 2 : b.x1 - 1;
    const read = (p: { y0: number; y1: number }) => readText(rows, left, right, p.y0, p.y1, free);
    const texts = parts.map(read);
    const first = texts[0];
    const text = texts.map((t) => t.text).join("\n---\n").replace(/^\n---\n$/, "");
    const node = makeNode(
      { x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: (b.lineEnd ?? b.y1) - b.y0 + 1 },
      {
        // Empty, and holding boxes or named (a loop or alt block): a frame.
        kind: b.kind === "box" && !text.trim() && (insideOthers.length || b.name) ? "frame" : b.kind,
        border: b.border,
        text,
        align: b.kind === "class" ? { h: first.h, v: "top" } : { h: first.h, v: first.v },
        ...(b.name && { name: b.name }),
        ...(b.name && b.nameAlign && b.nameAlign !== "left" && { nameAlign: b.nameAlign }),
        ...(b.kind === "class" && { lists: false }),
        ...(b.flip && { flip: true }),
      }
    );
    // Room for the text with the renderer's padding (one column inside the border).
    const widest = Math.max(0, ...texts.flatMap((t) => t.text.split("\n").map((l) => chars(l).length)));
    if (widest > node.rect.w - 4 && b.kind !== "subroutine") node.rect = { ...node.rect, w: widest + 4 };
    b.id = node.id;
    d = addNode(d, node);
  }
  // Free text: runs of text on a row (split at wide gaps), joined with the runs below them that
  // start in the same column.
  const loose = textRuns(rows, W, (x, y) => taken(x, y) || !!innermostAt(x, y));
  const labels: { x: number; y: number; lines: string[] }[] = [];
  for (const r of loose) {
    const prev = labels.find((l) => l.x === r.x && l.y + l.lines.length === r.y);
    if (prev) prev.lines.push(r.text);
    else labels.push({ x: r.x, y: r.y, lines: [r.text] });
  }
  for (const l of labels) {
    const text = l.lines.join("\n");
    d = addNode(d, makeNode({ x: l.x, y: l.y, w: Math.max(...l.lines.map((t) => chars(t).length)), h: l.lines.length }, {
      border: "none", autosize: true, text, align: { h: "left", v: "top" },
    }));
  }

  // Connectors: attached by side, each routed automatically if that reproduces the drawing;
  // otherwise with its ends where they were drawn, then also its bends.
  const made: { id: Id; drawn: Point[]; from: Terminal; to: Terminal; labelAt?: LabelAt }[] = [];
  // A connector's style is its own stretch's, not a trunk it shares with others.
  const uses = new Map<number, number>();
  for (const e of edges) for (const p of e.path) uses.set(k(p.x, p.y), (uses.get(k(p.x, p.y)) ?? 0) + 1);
  for (const e of edges) {
    const straight = (p: Point) => mask.get(k(p.x, p.y)) === (LEFT | RIGHT) || mask.get(k(p.x, p.y)) === (UP | DOWN);
    const own = e.path.filter((p) => straight(p) && uses.get(k(p.x, p.y)) === 1);
    const line: AnyLineStyle = e.bus ? "bus" : lineStyleOf(own.map((p) => style.get(k(p.x, p.y))!), e.path.filter(straight).map((p) => style.get(k(p.x, p.y))!));
    // Messages on lifelines and activation bars are attached by row.
    const end = (t: Terminal): Endpoint =>
      !t.box ? { kind: "free", at: t.cell }
      : t.box.kind === "lifeline" || t.box.kind === "activation" ? pin({ kind: "attached", node: t.box.id, side: t.side! }, t)
      : { kind: "attached", node: t.box.id, side: t.side! };
    const heads = { ...(e.from.head && e.from.head !== "arrow" && { start: e.from.head }), ...(e.to.head && e.to.head !== "arrow" && { end: e.to.head }) };
    const edge = makeEdge(end(e.from), end(e.to), {
      line,
      arrows: { start: !!e.from.head, end: !!e.to.head },
      ...(Object.keys(heads).length && { heads }),
      ...(e.label && { label: e.label }),
      ...(e.endLabels && { endLabels: e.endLabels }),
    });
    d = addEdge(d, edge);
    made.push({ id: edge.id, drawn: e.path, from: e.from, to: e.to, labelAt: e.labelAt });
  }
  for (let round = 0; round < 3; round++) {
    const r = rasterize(d);
    let changed = false;
    for (const m of made) {
      const got = r.edges.get(m.id)?.cells ?? [];
      if (samePath(got, m.drawn)) {
        // The right path; is the label where it was drawn?
        const at = r.edges.get(m.id)?.label;
        const want = m.labelAt;
        if (want && at && (at.x !== want.start.x || at.y !== want.start.y)) {
          const idx = got.findIndex((p) => p.x === want.cell.x && p.y === want.cell.y);
          if (idx > 0 && d.edges[m.id].labelAt === undefined) {
            d = { ...d, edges: { ...d.edges, [m.id]: { ...d.edges[m.id], labelAt: idx / (got.length - 1) } } };
            changed = true;
          }
        }
        continue;
      }
      const e = d.edges[m.id];
      changed = true;
      if (round === 0) d = { ...d, edges: { ...d.edges, [m.id]: { ...e, from: pin(e.from, m.from), to: pin(e.to, m.to) } } };
      else d = { ...d, edges: { ...d.edges, [m.id]: { ...e, via: corners(m.drawn) } } };
    }
    if (!changed) break;
  }
  if (!boxes.length && !edges.length && labels.length) warnings.push("no boxes or connectors found: it's drawn as text");
  return { diagram: d, warnings: [...new Set(warnings)], boxes: boxes.length };
}

/** Whether some text looks like a drawing (it has at least one box). */
export function looksLikeDrawing(text: string): boolean {
  // A table missing its top border gets one when it's read.
  if (!/[┌╭╔┏+]/.test(repairTables(text.split("\n").map(expandTabs)).join("\n")) || text.split("\n").length < 2) return false;
  return importAscii(text, true).boxes > 0;
}

function expandTabs(line: string): string {
  let out = "";
  for (const c of line) out += c === "\t" ? " ".repeat(8 - (chars(out).length % 8)) : c;
  return out;
}

const dist = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function majority<T>(xs: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function lineStyleOf(straight: LineStyle[], all: LineStyle[]): LineStyle {
  return majority(straight) ?? majority(all) ?? "single";
}

/** An attached end pinned where it was drawn (its position along the side). */
function pin(ep: Endpoint, t: Terminal): Endpoint {
  if (ep.kind !== "attached" || !t.box || !t.border) return ep;
  const horizontal = t.side === "top" || t.side === "bottom";
  return { ...ep, offset: horizontal ? t.border.x - t.box.x0 : t.border.y - t.box.y0 };
}

/** Where a path turns. */
function corners(path: Point[]): Point[] {
  const out: Point[] = [];
  for (let i = 1; i + 1 < path.length; i++) {
    const a = path[i - 1], b = path[i], c = path[i + 1];
    if ((a.x === b.x) !== (b.x === c.x) || (a.y === b.y) !== (b.y === c.y)) out.push(b);
  }
  return out;
}

function samePath(a: Point[], b: Point[]): boolean {
  if (a.length === 0) return false;
  // A label gap leaves the drawn path short of cells: compare the turns and the ends.
  const ends = (p: Point[]) => [p[0], p[p.length - 1]];
  const same = (p: Point[], q: Point[]) => p.length === q.length && p.every((v, i) => v.x === q[i].x && v.y === q[i].y);
  return same(ends(a), ends(b)) && same(corners(a), corners(b));
}

/** Breadth-first: the fewest cells from a to b. */
function shortest(a: Point, b: Point, next: (p: Point) => Point[], k: (x: number, y: number) => number): Point[] | null {
  const prev = new Map<number, Point | null>([[k(a.x, a.y), null]]);
  const queue = [a];
  while (queue.length) {
    const p = queue.shift()!;
    if (p.x === b.x && p.y === b.y) {
      const path: Point[] = [];
      for (let c: Point | null = p; c; c = prev.get(k(c.x, c.y)) ?? null) path.unshift(c);
      return fill(path);
    }
    for (const n of next(p)) {
      if (!prev.has(k(n.x, n.y))) {
        prev.set(k(n.x, n.y), p);
        queue.push(n);
      }
    }
  }
  return null;
}

/** Fill in the cells of any jump (across a label gap). */
function fill(path: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (last) {
      let c = last;
      while (Math.abs(p.x - c.x) + Math.abs(p.y - c.y) > 1) {
        c = { x: c.x + Math.sign(p.x - c.x), y: c.y + Math.sign(p.y - c.y) };
        out.push(c);
      }
    }
    out.push(p);
  }
  return out;
}

/** Runs of text on each row (split where there are two or more spaces), skipping cells `skip`. */
function textRuns(rows: string[][], W: number, skip: (x: number, y: number) => boolean): { x: number; y: number; len: number; text: string }[] {
  const out: { x: number; y: number; len: number; text: string }[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < W) {
      const c = row[x] ?? " ";
      if (c === " " || skip(x, y)) {
        x++;
        continue;
      }
      // To the end of the run: a single space carries on if more text follows it.
      let e = x;
      while (e < W && !skip(e, y)) {
        if ((row[e] ?? " ") === " " && (e + 1 >= W || (row[e + 1] ?? " ") === " " || skip(e + 1, y))) break;
        e++;
      }
      const text = row.slice(x, e).join("").trimEnd();
      if (text) out.push({ x, y, len: chars(text).length, text });
      x = e + 1;
    }
  });
  return out;
}

/** A box's text from its inside, and how it's aligned. */
function readText(rows: string[][], left: number, right: number, y0: number, y1: number, free: (x: number, y: number) => boolean): { text: string; h: HAlign; v: VAlign } {
  const lines: { y: number; l: number; r: number; s: string }[] = [];
  for (let y = y0; y <= y1; y++) {
    const cells = [];
    for (let x = left; x <= right; x++) cells.push(free(x, y) ? rows[y]?.[x] ?? " " : " ");
    const s = cells.join("");
    if (!s.trim()) {
      lines.push({ y, l: -1, r: -1, s: "" });
      continue;
    }
    const l = s.length - s.trimStart().length, r = s.length - s.trimEnd().length;
    lines.push({ y, l, r, s });
  }
  const content = lines.filter((l) => l.l >= 0);
  if (!content.length) return { text: "", h: "center", v: "middle" };
  const firstY = content[0].y, lastY = content[content.length - 1].y;
  const body = lines.filter((l) => l.y >= firstY && l.y <= lastY);
  const centered = content.every((l) => Math.abs(l.l - l.r) <= 1) && content.some((l) => l.l > 1);
  const minL = Math.min(...content.map((l) => l.l));
  const h: HAlign = centered ? "center" : content.every((l) => l.r === content[0].r) && content.some((l) => l.l !== content[0].l) ? "right" : "left";
  const text = body.map((l) => (l.l < 0 ? "" : h === "left" ? l.s.slice(minL).trimEnd() : l.s.trim())).join("\n");
  const topGap = firstY - y0, bottomGap = y1 - lastY;
  const v: VAlign = Math.abs(topGap - bottomGap) <= 1 ? "middle" : topGap < bottomGap ? "top" : "bottom";
  return { text, h, v };
}

/**
 * A table cell's text from its lines as drawn. A list (• ◦ ▪ bullets, or numbers) goes back to
 * Markdown: `- item`, nested by its indentation, with wrapped lines joined onto their item.
 * Anything else: each line trimmed.
 */
function cellFromLines(cell: string): string {
  const lines = cell.split("\n").filter((l) => l.trim());
  const MARKER = /^([•◦▪]|\d+[.)]|\[[ ✓xX]\])( |$)/;
  if (!lines.some((l) => MARKER.test(l.trim()))) return lines.map((l) => l.trim()).join("\n");
  const lead = (l: string) => l.length - l.trimStart().length;
  const base = Math.min(...lines.map(lead));
  const out: string[] = [];
  for (const l of lines) {
    const at = " ".repeat(lead(l) - base);
    const t = l.trim();
    if (MARKER.test(t)) {
      // A checklist item's box ([ ], [✓] or [x]) takes the bullet's place.
      const item = t.replace(/^[•◦▪] /, "- ").replace(/^(\d+[.)] )?\[([ ✓xX])\]( |$)/, (_, num, c, sp) => `${num ?? "- "}[${c === " " ? " " : "x"}]${sp}`);
      out.push(at + item);
    }
    else if (out.length && lead(l) > base) out[out.length - 1] += " " + t; // wrapped: part of the item above
    else out.push(t);
  }
  return out.join("\n");
}
