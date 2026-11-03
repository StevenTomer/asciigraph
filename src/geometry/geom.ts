/** Integer cell coordinates and rectangles. Everything here is plain data and pure functions. */

export interface Point {
  x: number;
  y: number;
}

/** A rectangle of cells: (x, y) is the top-left cell; w and h count cells (both ≥ 1). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = "top" | "right" | "bottom" | "left";
export const SIDES: Side[] = ["top", "right", "bottom", "left"];

/** Unit step for each direction (y grows downward). */
export const STEP: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export const OPPOSITE: Record<Side, Side> = {
  top: "bottom",
  bottom: "top",
  left: "right",
  right: "left",
};

export const pt = (x: number, y: number): Point => ({ x, y });
export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const eq = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
export const key = (p: Point) => `${p.x},${p.y}`;

export const right = (r: Rect) => r.x + r.w - 1;
export const bottom = (r: Rect) => r.y + r.h - 1;
export const center = (r: Rect): Point => ({ x: r.x + (r.w - 1) / 2, y: r.y + (r.h - 1) / 2 });

export function contains(r: Rect, p: Point) {
  return p.x >= r.x && p.x <= right(r) && p.y >= r.y && p.y <= bottom(r);
}

export function intersects(a: Rect, b: Rect) {
  return a.x <= right(b) && b.x <= right(a) && a.y <= bottom(b) && b.y <= bottom(a);
}

/** The rectangle spanned by two corner cells, in any order. */
export function rectFromCorners(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}

export function translate(r: Rect, d: Point): Rect {
  return { ...r, x: r.x + d.x, y: r.y + d.y };
}

export function inset(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, w: r.w - 2 * dx, h: r.h - 2 * dy };
}

/** Smallest rect containing all the given rects, or null for none. */
export function union(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, right(r));
    y1 = Math.max(y1, bottom(r));
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Direction of a unit step between two orthogonally adjacent cells. */
export function stepSide(from: Point, to: Point): Side {
  if (to.x > from.x) return "right";
  if (to.x < from.x) return "left";
  if (to.y > from.y) return "bottom";
  return "top";
}
