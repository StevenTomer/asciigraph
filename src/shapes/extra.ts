import { type Point, type Rect, bottom, right } from "../geometry/geom";
import type { LineStyle, Node } from "../model/types";
import type { CharGrid } from "../render/grid";
import { layoutText, textLines } from "../render/textLayout";
import { chars } from "../render/textLayout";
import { document, lineStyle, strokePath, through } from "./more";
import type { ShapeDef } from "./registry";

/**
 * Hexagon, stacked boxes and documents, queue, actor:
 *
 *     ╱──────────╲      ┌──────────┐      ┌───────────┐     ╭──────────┬─╮        ○
 *    ╱  prepare   ╲    ┌┴─────────┐│     ┌┴──────────┐│     │  orders  │ │       ╱│╲
 *    ╲            ╱    │ workers  ├┘     │  reports  ├┘     ╰──────────┴─╯       ╱ ╲
 *     ╲──────────╱     └──────────┘      │           │                         User
 *                                        ╰──╮  ╭──╮  ╭╯
 *                                           ╰──╯  ╰──╯
 *
 * A hexagon's points are a ╱ over a ╲ (the decision shape has < > points instead); stacks show
 * the edge of another one behind, up and to the right; a queue is a cylinder on its side (a rim
 * near its right end, like the database's near its top).
 */

const slashes = (style: LineStyle) => (style === "ascii" ? ["/", "\\"] : ["╱", "╲"]);
const drawText = (n: Node, area: Rect, grid: CharGrid) => {
  for (const [p, c] of layoutText(n.text, area, n.align, n.lists === false)) grid.setChar(p, c);
};
const keepSize = (n: Node) => ({ w: n.rect.w, h: n.rect.h });
const rectOutline = (r: Rect): Point[] =>
  through([{ x: r.x, y: r.y }, { x: right(r), y: r.y }, { x: right(r), y: bottom(r) }, { x: r.x, y: bottom(r) }, { x: r.x, y: r.y }]);
const isCorner = (r: Rect) => (p: Point) => (p.x === r.x || p.x === right(r)) && (p.y === r.y || p.y === bottom(r));

// ---------------------------------------------------------------------------------------------

/** How far in each row's ends are (the middle two rows: 0). Even heights. */
const hexInset = (h: number, i: number) => {
  const k = h / 2;
  return i < k ? k - 1 - i : i - k;
};

export const hexagon: ShapeDef = {
  label: "hexagon",
  defaultSize: { w: 16, h: 4 },
  minSize: () => ({ w: 7, h: 4 }),
  // Even heights: the points fall between the middle two rows.
  normalize(r) {
    const h = r.h % 2 ? r.h + 1 : r.h;
    return { ...r, h, w: Math.max(r.w, h + 3) };
  },
  hasBorder: (n) => n.border !== "none",
  contentRect(n) {
    const r = n.rect, k = Math.floor(r.h / 2);
    return { x: r.x + k + 1, y: r.y + 1, w: Math.max(1, r.w - 2 * k - 2), h: Math.max(1, r.h - 2) };
  },
  sideRange(n, side) {
    const r = n.rect, k = Math.floor(r.h / 2);
    if (side === "left" || side === "right") return [r.y + k - 1, r.y + k];
    return [r.x + k, Math.max(r.x + k, right(r) - k)];
  },
  fitSize: keepSize,
  footprint(n) {
    const r = n.rect;
    return Array.from({ length: r.h }, (_, i) => {
      const d = hexInset(r.h, i);
      return { x: r.x + d, y: r.y + i, w: r.w - 2 * d, h: 1 };
    });
  },
  hitTest(n, p) {
    const r = n.rect, i = p.y - r.y;
    if (i < 0 || i >= r.h) return false;
    const d = hexInset(r.h, i);
    return p.x >= r.x + d && p.x <= right(r) - d;
  },
  rasterize(n, grid) {
    const r = n.rect, style = lineStyle(n.border);
    if (style) {
      const [up, down] = slashes(style);
      const k = r.h / 2;
      for (let i = 0; i < r.h; i++) {
        const d = hexInset(r.h, i), y = r.y + i, top = i < k;
        grid.setChar({ x: r.x + d, y }, top ? up : down);
        grid.setChar({ x: right(r) - d, y }, top ? down : up);
        if (i === 0 || i === r.h - 1) for (let x = r.x + d + 1; x < right(r) - d; x++) grid.stroke({ x, y }, ["left", "right"], style);
      }
    }
    drawText(n, this.contentRect(n), grid);
  },
};

// ---------------------------------------------------------------------------------------------

/** The front one of a stack: all but the top row and right column. */
export const frontOf = (r: Rect): Rect => ({ x: r.x, y: r.y + 1, w: r.w - 1, h: r.h - 1 });

/** The row where the one behind joins the front one's right side: just above the front's
 * bottom (a document's: just above its wave), so the one behind is as tall as the front. */
export const stackJoin = (r: Rect, wavy: boolean) => bottom(r) - (wavy ? 2 : 1);

/** The edge of the one behind: up from the front's top, along, down its right side, and into the
 * front's right side at `join` (┌┴───┐│ … ├┘). */
export function stackBehind(r: Rect, join: number): Point[] {
  return through([
    { x: r.x + 1, y: r.y + 1 }, { x: r.x + 1, y: r.y }, { x: right(r), y: r.y }, { x: right(r), y: join }, { x: right(r) - 1, y: join },
  ]);
}

/** A stack of `front` shapes (`wavy`: documents, whose right side stops above the wave). */
function stackOf(front: ShapeDef, label: string, min: { w: number; h: number }, size: { w: number; h: number }, wavy: boolean): ShapeDef {
  const f = (n: Node): Node => ({ ...n, rect: frontOf(n.rect) });
  return {
    label,
    defaultSize: size,
    minSize: () => min,
    hasBorder: (n) => n.border !== "none",
    contentRect: (n) => front.contentRect(f(n)),
    sideRange(n, side) {
      const r = n.rect;
      if (side === "top") return [r.x + 2, right(r) - 1];
      // The one behind's right side, above where it joins the front one.
      if (side === "right") return [r.y + 1, Math.max(r.y + 1, stackJoin(r, wavy) - 1)];
      return front.sideRange(f(n), side);
    },
    anchor(n, side, along) {
      if (side === "right" || side === "top") return undefined;
      return front.anchor?.(f(n), side, along);
    },
    fitSize: keepSize,
    footprint: (n) => [frontOf(n.rect), { x: n.rect.x + 1, y: n.rect.y, w: n.rect.w - 1, h: stackJoin(n.rect, wavy) - n.rect.y + 1 }],
    rasterize(n, grid) {
      const r = n.rect, style = lineStyle(n.border);
      front.rasterize(f(n), grid);
      if (style) {
        const round = n.border === "rounded", join = stackJoin(r, wavy);
        strokePath(grid, stackBehind(r, join), style, (p) => round && (p.y === r.y || (p.x === right(r) && p.y === join)));
      }
    },
  };
}

/** A box, as the front of a stack of boxes. */
const plainBox: ShapeDef = {
  label: "box",
  defaultSize: { w: 14, h: 3 },
  minSize: () => ({ w: 5, h: 3 }),
  hasBorder: (n) => n.border !== "none",
  contentRect: (n) => ({ x: n.rect.x + 2, y: n.rect.y + 1, w: Math.max(1, n.rect.w - 4), h: Math.max(1, n.rect.h - 2) }),
  sideRange: (n, side) => (side === "top" || side === "bottom" ? [n.rect.x + 1, right(n.rect) - 1] : [n.rect.y + 1, bottom(n.rect) - 1]),
  fitSize: keepSize,
  rasterize(n, grid) {
    const style = lineStyle(n.border);
    if (style) strokePath(grid, rectOutline(n.rect), style, (p) => n.border === "rounded" && isCorner(n.rect)(p));
    drawText(n, this.contentRect(n), grid);
  },
};

export const stack = stackOf(plainBox, "stacked", { w: 7, h: 4 }, { w: 16, h: 5 }, false);
export const docs = stackOf(document, "documents", { w: 8, h: 5 }, { w: 17, h: 6 }, true);

// ---------------------------------------------------------------------------------------------

export const queue: ShapeDef = {
  label: "queue",
  defaultSize: { w: 18, h: 3 },
  minSize: () => ({ w: 8, h: 3 }),
  hasBorder: (n) => n.border !== "none",
  contentRect: (n) => ({ x: n.rect.x + 2, y: n.rect.y + 1, w: Math.max(1, n.rect.w - 6), h: Math.max(1, n.rect.h - 2) }),
  sideRange: (n, side) => (side === "top" || side === "bottom" ? [n.rect.x + 1, right(n.rect) - 3] : [n.rect.y + 1, bottom(n.rect) - 1]),
  fitSize: keepSize,
  rasterize(n, grid) {
    const r = n.rect, style = lineStyle(n.border);
    if (style) {
      strokePath(grid, rectOutline(r), style, (p) => style === "single" && isCorner(r)(p));
      // The rim: the near end of the cylinder.
      strokePath(grid, through([{ x: right(r) - 2, y: r.y }, { x: right(r) - 2, y: bottom(r) }]), style);
    }
    drawText(n, this.contentRect(n), grid);
  },
};

// ---------------------------------------------------------------------------------------------

/** The column of an actor's figure (in the middle; its name is centered under it). */
export const actorColumn = (r: Rect) => r.x + Math.floor((r.w - 1) / 2);

export const actor: ShapeDef = {
  label: "actor",
  defaultSize: { w: 5, h: 4 },
  minSize: () => ({ w: 3, h: 3 }),
  hasBorder: () => false,
  contentRect: (n) => ({ x: n.rect.x, y: n.rect.y + 3, w: n.rect.w, h: Math.max(1, n.rect.h - 3) }),
  sideRange(n, side) {
    const r = n.rect, cx = actorColumn(r);
    if (side === "left" || side === "right") return [r.y + 1, r.y + 1];
    if (side === "top") return [cx, cx];
    return [r.x, right(r)];
  },
  anchor(n, side, along) {
    const cx = actorColumn(n.rect);
    if (side === "left") return { x: cx - 1, y: along };
    if (side === "right") return { x: cx + 1, y: along };
    if (side === "top") return { x: cx, y: n.rect.y };
    return undefined;
  },
  // Exactly its name's size, under the figure.
  fitSize(n, text) {
    const lines = text.trim() ? textLines(text, 1000, n.lists === false) : [];
    return { w: Math.max(3, ...lines.map((l) => chars(l).length)), h: 3 + lines.length };
  },
  footprint(n) {
    const r = n.rect, cx = actorColumn(r);
    const out = [{ x: cx - 1, y: r.y, w: 3, h: 3 }];
    if (r.h > 3) out.push({ x: r.x, y: r.y + 3, w: r.w, h: r.h - 3 });
    return out;
  },
  rasterize(n, grid) {
    const r = n.rect, cx = actorColumn(r), y = r.y;
    grid.setChar({ x: cx, y }, "○");
    grid.setChar({ x: cx - 1, y: y + 1 }, "╱");
    grid.setChar({ x: cx, y: y + 1 }, "│");
    grid.setChar({ x: cx + 1, y: y + 1 }, "╲");
    grid.setChar({ x: cx - 1, y: y + 2 }, "╱");
    grid.setChar({ x: cx + 1, y: y + 2 }, "╲");
    if (r.h > 3) drawText({ ...n, align: { h: "center", v: "top" } }, this.contentRect(n), grid);
  },
};

// ---------------------------------------------------------------------------------------------

/**
 * Trapezoid, delay, folder:
 *
 *    ╲────────────╱        ┌────────╮        ┌─────┐
 *     ╲ by hand  ╱         │  wait  )        │     └──────┐
 *      ╲────────╱          └────────╯        │  billing   │
 *                                            └────────────┘
 *
 * A trapezoid is wider at the top (a manual operation), or with `flip` at the bottom.
 */

/** How far in a trapezoid's row is. */
const trapInset = (n: Node, i: number) => (n.flip ? n.rect.h - 1 - i : i);

export const trapezoid: ShapeDef = {
  label: "trapezoid",
  defaultSize: { w: 18, h: 3 },
  minSize: () => ({ w: 9, h: 3 }),
  normalize: (r) => ({ ...r, w: Math.max(r.w, 2 * r.h + 3) }),
  hasBorder: (n) => n.border !== "none",
  contentRect(n) {
    const r = n.rect;
    return { x: r.x + r.h, y: r.y + 1, w: Math.max(1, r.w - 2 * r.h), h: Math.max(1, r.h - 2) };
  },
  sideRange(n, side) {
    const r = n.rect;
    if (side === "left" || side === "right") return [r.y + 1, Math.max(r.y + 1, bottom(r) - 1)];
    const i = side === "top" ? 0 : r.h - 1, d = trapInset(n, i);
    return [r.x + d + 1, right(r) - d - 1];
  },
  anchor(n, side, along) {
    const r = n.rect, i = along - r.y;
    if (side === "left") return { x: r.x + trapInset(n, i), y: along };
    if (side === "right") return { x: right(r) - trapInset(n, i), y: along };
    return undefined;
  },
  fitSize: keepSize,
  footprint(n) {
    const r = n.rect;
    return Array.from({ length: r.h }, (_, i) => {
      const d = trapInset(n, i);
      return { x: r.x + d, y: r.y + i, w: r.w - 2 * d, h: 1 };
    });
  },
  hitTest(n, p) {
    const r = n.rect, i = p.y - r.y;
    if (i < 0 || i >= r.h) return false;
    const d = trapInset(n, i);
    return p.x >= r.x + d && p.x <= right(r) - d;
  },
  rasterize(n, grid) {
    const r = n.rect, style = lineStyle(n.border);
    if (style) {
      const [up, down] = slashes(style);
      for (let i = 0; i < r.h; i++) {
        const d = trapInset(n, i), y = r.y + i;
        grid.setChar({ x: r.x + d, y }, n.flip ? up : down);
        grid.setChar({ x: right(r) - d, y }, n.flip ? down : up);
        if (i === 0 || i === r.h - 1) for (let x = r.x + d + 1; x < right(r) - d; x++) grid.stroke({ x, y }, ["left", "right"], style);
      }
    }
    drawText(n, this.contentRect(n), grid);
  },
};

export const delay: ShapeDef = {
  label: "delay",
  defaultSize: { w: 14, h: 3 },
  minSize: () => ({ w: 5, h: 3 }),
  hasBorder: (n) => n.border !== "none",
  contentRect: (n) => ({ x: n.rect.x + 2, y: n.rect.y + 1, w: Math.max(1, n.rect.w - 4), h: Math.max(1, n.rect.h - 2) }),
  sideRange: (n, side) => (side === "top" || side === "bottom" ? [n.rect.x + 1, right(n.rect) - 1] : [n.rect.y + 1, bottom(n.rect) - 1]),
  fitSize: keepSize,
  rasterize(n, grid) {
    const r = n.rect, style = lineStyle(n.border);
    if (style) {
      const x1 = right(r), y1 = bottom(r), round = style === "single";
      // Square on the left, rounded on the right: ┌──╮ │ ) └──╯.
      strokePath(grid, through([{ x: x1, y: r.y }, { x: r.x, y: r.y }, { x: r.x, y: y1 }, { x: x1, y: y1 }]), style, (p) => n.border === "rounded" && p.x === r.x);
      grid.stroke({ x: x1, y: r.y }, ["left", "bottom"], style, round);
      grid.stroke({ x: x1, y: y1 }, ["left", "top"], style, round);
      for (let y = r.y + 1; y < y1; y++) grid.setChar({ x: x1, y }, ")");
    }
    drawText(n, this.contentRect(n), grid);
  },
};

/** Where a folder's tab ends (its ┐), from the left. */
export const folderTab = (w: number) => Math.min(10, Math.max(3, Math.floor((w - 1) / 2)));

/** A folder's outline, clockwise from its top-left corner. */
export function folderOutline(r: Rect): Point[] {
  const tx = r.x + folderTab(r.w);
  const cells = through([
    { x: r.x, y: r.y }, { x: tx, y: r.y }, { x: tx, y: r.y + 1 }, { x: right(r), y: r.y + 1 }, { x: right(r), y: bottom(r) }, { x: r.x, y: bottom(r) }, { x: r.x, y: r.y },
  ]);
  return cells.slice(0, -1);
}

export const folder: ShapeDef = {
  label: "folder",
  defaultSize: { w: 16, h: 4 },
  minSize: () => ({ w: 7, h: 4 }),
  hasBorder: (n) => n.border !== "none",
  contentRect: (n) => ({ x: n.rect.x + 2, y: n.rect.y + 2, w: Math.max(1, n.rect.w - 4), h: Math.max(1, n.rect.h - 3) }),
  sideRange(n, side) {
    const r = n.rect;
    if (side === "top") return [r.x + 1, r.x + folderTab(r.w) - 1];
    if (side === "bottom") return [r.x + 1, right(r) - 1];
    return side === "left" ? [r.y + 1, bottom(r) - 1] : [r.y + 2, Math.max(r.y + 2, bottom(r) - 1)];
  },
  fitSize(n, text) {
    // Grows (never shrinks) to fit its wrapped text, like a box.
    return { w: n.rect.w, h: Math.max(n.rect.h, textLines(text, this.contentRect(n).w, n.lists === false).length + 3) };
  },
  footprint: (n) => [{ x: n.rect.x, y: n.rect.y, w: folderTab(n.rect.w) + 1, h: 1 }, { x: n.rect.x, y: n.rect.y + 1, w: n.rect.w, h: n.rect.h - 1 }],
  hitTest(n, p) {
    const r = n.rect;
    if (p.x < r.x || p.x > right(r) || p.y < r.y || p.y > bottom(r)) return false;
    return p.y > r.y || p.x <= r.x + folderTab(r.w);
  },
  rasterize(n, grid) {
    const r = n.rect, style = lineStyle(n.border);
    if (style) {
      const cells = folderOutline(r);
      const corner = (p: Point) => (p.x === r.x || p.x === right(r)) && (p.y === r.y || p.y === bottom(r));
      strokePath(grid, [...cells, cells[0]], style, (p) => n.border === "rounded" && (corner(p) || p.y <= r.y + 1));
    }
    drawText(n, this.contentRect(n), grid);
  },
};
