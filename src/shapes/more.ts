import { type Point, type Rect, bottom, right, stepSide, OPPOSITE } from "../geometry/geom";
import type { BorderStyle, LineStyle, Node } from "../model/types";
import type { CharGrid } from "../render/grid";
import { layoutText, textLines } from "../render/textLayout";
import type { ShapeDef } from "./registry";

/**
 * More flowchart shapes, and notes:
 *
 *   database        document           subroutine        note
 *   ╭────────╮      ┌────────────┐     ┌─┬────────┬─┐    ┌───────┬╮
 *   ├────────┤      │  report    │     │ │ sub    │ │    │ note  ╰┤
 *   │  data  │      ╰──╮  ╭──╮  ╭╯     └─┴────────┴─┘    │        │
 *   ╰────────╯         ╰──╯  ╰──╯                        └────────┘
 */

function lineStyle(border: BorderStyle): LineStyle | null {
  if (border === "none") return null;
  return border === "rounded" ? "single" : border;
}

/** Stroke a path of orthogonally adjacent cells (a closed outline if it ends where it started). */
function strokePath(grid: CharGrid, cells: Point[], style: LineStyle, roundedAt: (p: Point) => boolean = () => false) {
  for (let k = 1; k < cells.length; k++) {
    const dir = stepSide(cells[k - 1], cells[k]);
    grid.stroke(cells[k - 1], dir, style, roundedAt(cells[k - 1]));
    grid.stroke(cells[k], OPPOSITE[dir], style, roundedAt(cells[k]));
  }
}

/** Every cell along a list of corner points. */
function through(points: Point[]): Point[] {
  const out: Point[] = [points[0]];
  for (const target of points.slice(1)) {
    let p = out[out.length - 1];
    while (p.x !== target.x || p.y !== target.y) {
      p = { x: p.x + Math.sign(target.x - p.x), y: p.y + Math.sign(target.y - p.y) };
      out.push(p);
    }
  }
  return out;
}

function rectOutline(r: Rect): Point[] {
  return through([{ x: r.x, y: r.y }, { x: right(r), y: r.y }, { x: right(r), y: bottom(r) }, { x: r.x, y: bottom(r) }, { x: r.x, y: r.y }]);
}

const drawText = (n: Node, area: Rect, grid: CharGrid) => {
  for (const [p, c] of layoutText(n.text, area, n.align, n.lists === false)) grid.setChar(p, c);
};

const keepSize = (n: Node) => ({ w: n.rect.w, h: n.rect.h });
const flatSides = (n: Node, side: string): [number, number] => {
  const r = n.rect;
  return side === "top" || side === "bottom" ? [r.x + 1, right(r) - 1] : [r.y + 1, bottom(r) - 1];
};

/** A cylinder: rounded top with a rim line below it. */
export const database: ShapeDef = {
  label: "database",
  defaultSize: { w: 14, h: 5 },
  minSize: () => ({ w: 5, h: 4 }),
  hasBorder: (n) => n.border !== "none",
  contentRect: (n) => ({ x: n.rect.x + 2, y: n.rect.y + 2, w: Math.max(1, n.rect.w - 4), h: Math.max(1, n.rect.h - 3) }),
  sideRange: (n, side) => (side === "left" || side === "right" ? [n.rect.y + 2, bottom(n.rect) - 1] : flatSides(n, side)),
  fitSize: keepSize,
  rasterize(n, grid) {
    const r = n.rect, style = lineStyle(n.border);
    if (style) {
      const round = style === "single";
      const corner = (p: Point) => round && (p.x === r.x || p.x === right(r)) && (p.y === r.y || p.y === bottom(r));
      strokePath(grid, rectOutline(r), style, corner);
      // The rim: ├────┤ one row down.
      strokePath(grid, through([{ x: r.x, y: r.y + 1 }, { x: right(r), y: r.y + 1 }]), style);
    }
    drawText(n, this.contentRect(n), grid);
  },
};

/** A page with a wavy bottom edge (two rows of curves, period 6). */
export const document: ShapeDef = {
  label: "document",
  defaultSize: { w: 16, h: 5 },
  minSize: () => ({ w: 7, h: 4 }),
  hasBorder: (n) => n.border !== "none",
  contentRect: (n) => ({ x: n.rect.x + 2, y: n.rect.y + 1, w: Math.max(1, n.rect.w - 4), h: Math.max(1, n.rect.h - 3) }),
  sideRange(n, side) {
    const r = n.rect;
    if (side === "left") return [r.y + 1, bottom(r) - 2];
    if (side === "right") return [r.y + 1, bottom(r) - 2];
    if (side === "top") return [r.x + 1, right(r) - 1];
    return [r.x + 4, Math.max(r.x + 4, right(r) - 1)];
  },
  anchor(n, side, along) {
    const r = n.rect;
    if (side !== "bottom") return undefined; // the default
    // The bottom joins a trough of the wave (columns 4–5 of each period of 6).
    const phase = (along - r.x) % 6;
    const x = phase >= 4 ? along : Math.min(right(r), along + (4 - phase));
    return { x, y: bottom(r) };
  },
  fitSize: keepSize,
  rasterize(n, grid) {
    const r = n.rect, style = lineStyle(n.border);
    if (style) {
      const crest = bottom(r) - 1, trough = bottom(r);
      // The wave, left to right: crests at columns 0–3 of each period, troughs at 3–6.
      const wave: Point[] = [{ x: r.x, y: crest }];
      let low = false;
      for (let x = r.x + 1; x <= right(r); x++) {
        const phase = (x - r.x) % 6;
        // (No step down right at the edge: the side would have to double back up.)
        if (!low && phase === 3 && x < right(r)) {
          wave.push({ x, y: crest }, { x, y: trough });
          low = true;
        } else if (low && phase === 0) {
          wave.push({ x, y: trough }, { x, y: crest });
          low = false;
        } else {
          wave.push({ x, y: low ? trough : crest });
        }
      }
      const end = wave[wave.length - 1];
      // Top, right side down to where the wave ends, the wave back, left side up.
      const outline = [
        ...through([{ x: r.x, y: crest }, { x: r.x, y: r.y }, { x: right(r), y: r.y }, end]),
        ...[...wave].reverse().slice(1),
      ];
      const waveCells = new Set(wave.map((p) => `${p.x},${p.y}`));
      strokePath(grid, outline, style, (p) => style === "single" && waveCells.has(`${p.x},${p.y}`));
    }
    drawText(n, this.contentRect(n), grid);
  },
};

/** A predefined process: a box with a second line inside each side. */
export const subroutine: ShapeDef = {
  label: "subroutine",
  defaultSize: { w: 18, h: 3 },
  minSize: () => ({ w: 9, h: 3 }),
  hasBorder: (n) => n.border !== "none",
  contentRect: (n) => ({ x: n.rect.x + 4, y: n.rect.y + 1, w: Math.max(1, n.rect.w - 8), h: Math.max(1, n.rect.h - 2) }),
  sideRange: flatSides,
  fitSize: keepSize,
  rasterize(n, grid) {
    const r = n.rect, style = lineStyle(n.border);
    if (style) {
      strokePath(grid, rectOutline(r), style, (p) => n.border === "rounded" && (p.x === r.x || p.x === right(r)) && (p.y === r.y || p.y === bottom(r)));
      for (const x of [r.x + 2, right(r) - 2]) strokePath(grid, through([{ x, y: r.y }, { x, y: bottom(r) }]), style);
    }
    drawText(n, this.contentRect(n), grid);
  },
};

/** A note: a box with its top-right corner folded over. */
export const note: ShapeDef = {
  label: "note",
  defaultSize: { w: 16, h: 4 },
  minSize: () => ({ w: 5, h: 3 }),
  hasBorder: (n) => n.border !== "none",
  contentRect: (n) => ({ x: n.rect.x + 2, y: n.rect.y + 1, w: Math.max(1, n.rect.w - 5), h: Math.max(1, n.rect.h - 2) }),
  sideRange: flatSides,
  fitSize(n, text) {
    // Grows (never shrinks) to fit its wrapped text, like a box.
    return { w: n.rect.w, h: Math.max(n.rect.h, textLines(text, this.contentRect(n).w, n.lists === false).length + 2) };
  },
  rasterize(n, grid) {
    const r = n.rect, style = lineStyle(n.border);
    if (style) {
      const x1 = right(r), y1 = bottom(r);
      // Outline, with the corner cut: ┌───┬╮ / ╰┤ fold.
      strokePath(grid, through([
        { x: x1 - 1, y: r.y }, { x: r.x, y: r.y }, { x: r.x, y: y1 }, { x: x1, y: y1 }, { x: x1, y: r.y + 1 }, { x: x1 - 1, y: r.y + 1 }, { x: x1 - 1, y: r.y },
      ]), style);
      strokePath(grid, [{ x: x1 - 1, y: r.y }, { x: x1, y: r.y }, { x: x1, y: r.y + 1 }], style, (p) => style === "single" && p.y === r.y && p.x === x1);
      grid.stroke({ x: x1 - 1, y: r.y + 1 }, [], style, style === "single");
    }
    drawText(n, this.contentRect(n), grid);
  },
};
