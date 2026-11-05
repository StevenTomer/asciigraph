import { type Point, type Side, OPPOSITE } from "../geometry/geom";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode } from "../model/ops";
import type { BorderStyle, Diagram, Endpoint, HAlign, Head, Id, LineStyle, NodeKind, VAlign } from "../model/types";
import { DIR_BITS, DOWN, LEFT, RIGHT, UP, lineGlyph } from "../render/charsets";
import { rasterize } from "../render/rasterize";
import { chars } from "../render/textLayout";

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
  ["#", { head: "diamond", points: null, ascii: true }], ["*", { head: "dot", points: null, ascii: true }],
  ["o", { head: "circle", points: null, ascii: true }], ["x", { head: "cross", points: null, ascii: true }],
]);

interface Box {
  x0: number; y0: number; x1: number; y1: number;
  name?: string;
  border: BorderStyle;
  kind: NodeKind;
  dividers: number[];
  id: Id;
  /** Slanted shapes (decision, input/output): their outline cells and the side each is on. */
  cells?: Map<number, Side | null>;
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
}

export function importAscii(input: string, probe = false): ImportResult {
  const warnings: string[] = [];
  const rows = input.replace(/\r/g, "").split("\n").map((l) => chars(expandTabs(l)));
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
      const b = traceBox(x, y);
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
      if (UP_SLASH.has(ch(x, y)) && has(x + 1, y, "left") && has(x + 1, y, "right")) traceIo(x, y);
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
    // A start/end shape has ( ) for sides.
    let stadium = false;
    for (;;) {
      if (y < H && ch(x1, y) === ")" && ch(x0, y) === "(") {
        stadium = true;
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
    const isRounded = rounded.has(k(x0, y0)) || rounded.has(k(x1, y1));
    const border: BorderStyle = isRounded && st === "single" ? "rounded" : st;
    const b: Box = { x0, y0, x1, y1, name, border, kind: stadium ? "terminal" : "box", dividers: [], id: "" };
    if (nameStart >= 0) for (let xx = nameStart; xx <= nameEnd; xx++) nameCells.add(k(xx, y0));
    return b;
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
      return has(x, b.y0, "bottom") && has(x, b.y1, "top");
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
    } else if (b.x1 - b.x0 >= 6 && fullColumn(b.x0 + 2) && fullColumn(b.x1 - 2)) {
      b.kind = "subroutine";
      markColumn(b.x0 + 2);
      markColumn(b.x1 - 2);
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
            if (outline.has(k(n.x, n.y)) || HEADS.has(ch(n.x, n.y))) structural = true;
            if (isLine(n.x, n.y) && has(n.x, n.y, OPPOSITE[s]) && !seen.has(k(n.x, n.y))) {
              seen.add(k(n.x, n.y));
              stack.push(n);
            }
          }
        }
        if (!structural && comp.length < 3) for (const p of comp) mask.delete(k(p.x, p.y));
      }
    }
  }
  /** Heads: next to a line that runs into them. */
  const headAt = new Map<number, { head: Head; points: Side }>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const h = HEADS.get(ch(x, y));
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
      // Touching a border (or, as hand-drawn ASCII often is, a space or two short of one).
      for (let gap = 1; gap <= 3; gap++) {
        const n = { x: p.x + STEP[s].x * gap, y: p.y + STEP[s].y * gap };
        const owners = outline.get(k(n.x, n.y));
        if (owners) {
          // The box whose border this is, from the outside.
          // (A lifeline's line takes messages from either side.)
          const b = owners.find((o) => sideOf(o, n.x, n.y) === OPPOSITE[s] || (o.life?.has(k(n.x, n.y)) && (s === "left" || s === "right")));
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
  const edges: { from: Terminal; to: Terminal; path: Point[]; label?: string; labelAt?: LabelAt }[] = [];
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
      const path = shortest(a.cell, b.cell, next, k);
      if (!path) continue;
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
  const used = new Set<number>([...labelCells, ...nameCells]);
  const runs = textRuns(rows, W, (x, y) => {
    const key = k(x, y);
    return mask.has(key) || outline.has(key) || structure.has(key) || headAt.has(key) || used.has(key);
  });
  for (const run of runs) {
    if (run.text.includes("  ")) continue;
    for (const e of edges) {
      if (e.label) continue;
      const beside = e.path.some((p, i) => {
        const vertical = (i > 0 && e.path[i - 1].x === p.x) || (i + 1 < e.path.length && e.path[i + 1].x === p.x);
        return vertical && p.y === run.y && (run.x === p.x + 2 || run.x + run.len === p.x - 1);
      });
      if (beside && !boxes.some((b) => inBox(run.x, run.y, b) !== inBox(e.path[0].x, e.path[0].y, b))) {
        e.label = run.text;
        const cell = e.path.find((p) => p.y === run.y && (run.x === p.x + 2 || run.x + run.len === p.x - 1))!;
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
    const parts: { y0: number; y1: number }[] = [];
    let top = b.y0 + 1;
    for (const dy of [...b.dividers, b.y1]) {
      parts.push({ y0: top, y1: dy - 1 });
      top = dy + 1;
    }
    const left = b.x0 + 1, right = b.x1 - 1;
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
        ...(b.kind === "class" && { lists: false }),
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
    const line = lineStyleOf(own.map((p) => style.get(k(p.x, p.y))!), e.path.filter(straight).map((p) => style.get(k(p.x, p.y))!));
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
  if (!/[┌╭╔┏+]/.test(text) || text.split("\n").length < 2) return false;
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
