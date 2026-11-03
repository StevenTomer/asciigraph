import { type Rect, bottom, inset, right } from "../geometry/geom";
import type { BorderStyle, LineStyle, Node } from "../model/types";
import type { CharGrid } from "../render/grid";
import { layoutText } from "../render/textLayout";
import type { ShapeDef } from "./registry";

/**
 * Flowchart shapes. Their flat top and bottom edges are line strokes (so connectors join them
 * with ┬ ┴); slanted edges and points are characters.
 *
 *   decision           input / output         start / end
 *    ╱──────╲            ╱────────╱           ╭────────╮
 *   <  ok?   >          ╱  read  ╱            (  Start  )
 *    ╲──────╱          ╱────────╱             ╰────────╯
 */

/** The line style an outline is drawn in (null: no outline). */
function outline(border: BorderStyle): LineStyle | null {
  if (border === "none") return null;
  return border === "rounded" ? "single" : border;
}

const slashes = (style: LineStyle) => (style === "ascii" ? ["/", "\\"] : ["╱", "╲"]);

function flat(grid: CharGrid, y: number, x0: number, x1: number, style: LineStyle) {
  for (let x = x0; x <= x1; x++) grid.stroke({ x, y }, ["left", "right"], style);
}

const text = (node: Node, area: Rect, grid: CharGrid) => {
  for (const [p, c] of layoutText(node.text, area, node.align)) grid.setChar(p, c);
};

const middle = (r: Rect) => Math.floor(r.h / 2);
const keepSize = (node: Node) => ({ w: node.rect.w, h: node.rect.h });

/** A stretched diamond: points at the middle row, flat top and bottom. Odd heights only. */
export const decision: ShapeDef = {
  label: "decision",
  defaultSize: { w: 16, h: 5 },
  minSize: () => ({ w: 7, h: 3 }),
  normalize(r) {
    const h = r.h % 2 ? r.h : r.h + 1;
    return { ...r, h, w: Math.max(r.w, 2 * Math.floor(h / 2) + 3) };
  },
  hasBorder: (n) => n.border !== "none",
  contentRect(n) {
    const r = n.rect, m = middle(r);
    return { x: r.x + m + 1, y: r.y + 1, w: Math.max(1, r.w - 2 * m - 2), h: Math.max(1, r.h - 2) };
  },
  sideRange(n, side) {
    const r = n.rect, m = middle(r);
    if (side === "left" || side === "right") return [r.y + m, r.y + m];
    const lo = r.x + m + 1, hi = right(r) - m - 1;
    return lo <= hi ? [lo, hi] : [r.x + Math.floor(r.w / 2), r.x + Math.floor(r.w / 2)];
  },
  fitSize: keepSize,
  rasterize(n, grid) {
    const r = n.rect, m = middle(r), style = outline(n.border);
    if (style) {
      const [up, down] = slashes(style);
      for (let i = 0; i < r.h; i++) {
        const dist = Math.abs(i - m), y = r.y + i, lx = r.x + dist, rx = right(r) - dist;
        if (i === m) {
          grid.setChar({ x: lx, y }, "<");
          grid.setChar({ x: rx, y }, ">");
        } else {
          grid.setChar({ x: lx, y }, i < m ? up : down);
          grid.setChar({ x: rx, y }, i < m ? down : up);
        }
        if (i === 0 || i === r.h - 1) flat(grid, y, lx + 1, rx - 1, style);
      }
    }
    text(n, this.contentRect(n), grid);
  },
};

/** A parallelogram leaning right, one column per row. */
export const io: ShapeDef = {
  label: "input/output",
  defaultSize: { w: 18, h: 3 },
  minSize: () => ({ w: 9, h: 3 }),
  normalize: (r) => ({ ...r, w: Math.max(r.w, 2 * r.h + 3) }),
  hasBorder: (n) => n.border !== "none",
  contentRect(n) {
    const r = n.rect;
    return { x: r.x + r.h, y: r.y + 1, w: Math.max(1, r.w - 2 * r.h), h: Math.max(1, r.h - 2) };
  },
  sideRange(n, side) {
    const r = n.rect, m = middle(r);
    if (side === "left" || side === "right") return [r.y + m, r.y + m];
    return side === "top" ? [r.x + r.h, right(r) - 1] : [r.x + 1, right(r) - r.h];
  },
  anchor(n, side, along) {
    const r = n.rect, m = middle(r);
    if (side === "left") return { x: r.x + (r.h - 1 - m), y: r.y + m };
    if (side === "right") return { x: right(r) - m, y: r.y + m };
    return { x: along, y: side === "top" ? r.y : bottom(r) };
  },
  fitSize: keepSize,
  rasterize(n, grid) {
    const r = n.rect, style = outline(n.border);
    if (style) {
      const [up] = slashes(style);
      for (let i = 0; i < r.h; i++) {
        const y = r.y + i, lx = r.x + (r.h - 1 - i), rx = right(r) - i;
        grid.setChar({ x: lx, y }, up);
        grid.setChar({ x: rx, y }, up);
        if (i === 0 || i === r.h - 1) flat(grid, y, lx + 1, rx - 1, style);
      }
    }
    text(n, this.contentRect(n), grid);
  },
};

/** A rounded "stadium" with ( ) ends: where a flow starts or stops. */
export const terminal: ShapeDef = {
  label: "start/end",
  defaultSize: { w: 14, h: 3 },
  minSize: () => ({ w: 5, h: 3 }),
  hasBorder: (n) => n.border !== "none",
  contentRect: (n) => inset(n.rect, 2, 1),
  sideRange(n, side) {
    const r = n.rect;
    return side === "top" || side === "bottom" ? [r.x + 1, right(r) - 1] : [r.y + 1, bottom(r) - 1];
  },
  fitSize: keepSize,
  rasterize(n, grid) {
    const r = n.rect, style = outline(n.border);
    if (style) {
      const rounded = style === "single";
      const x1 = right(r), y1 = bottom(r);
      grid.stroke({ x: r.x, y: r.y }, ["right", "bottom"], style, rounded);
      grid.stroke({ x: x1, y: r.y }, ["left", "bottom"], style, rounded);
      grid.stroke({ x: r.x, y: y1 }, ["right", "top"], style, rounded);
      grid.stroke({ x: x1, y: y1 }, ["left", "top"], style, rounded);
      flat(grid, r.y, r.x + 1, x1 - 1, style);
      flat(grid, y1, r.x + 1, x1 - 1, style);
      for (let y = r.y + 1; y < y1; y++) {
        grid.setChar({ x: r.x, y }, "(");
        grid.setChar({ x: x1, y }, ")");
      }
    }
    text(n, this.contentRect(n), grid);
  },
};
