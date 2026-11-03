import { type Point, type Rect, bottom, right } from "../geometry/geom";
import type { Diagram, Id } from "../model/types";
import { footprint } from "../shapes/registry";

/**
 * Snapping while moving, resizing or drawing boxes: a box's edges and centre line up with other
 * boxes' edges and centres when within SNAP cells, and guides show what lined up.
 *
 * Only neighbours count: rows (tops, middles, bottoms) line up with boxes beside it, columns with
 * boxes above or below it. Boxes it overlaps along the other axis (lifelines a frame is dragged
 * across, the box it's inside) don't pull at it; in a diagram full of them, every position would
 * be near something and the box would jump about.
 */
const SNAP = 1;

/** A guide line: a column (axis "x") or row (axis "y") at `at`, spanning `from`..`to` across. */
export interface Guide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

/** Lines a rect offers: left/centre/right columns and top/middle/bottom rows (centres only when
 * they fall on a whole cell). */
function lines(r: Rect, axis: "x" | "y"): number[] {
  const [lo, size, hi] = axis === "x" ? [r.x, r.w, right(r)] : [r.y, r.h, bottom(r)];
  const mid = lo + (size - 1) / 2;
  return Number.isInteger(mid) ? [lo, mid, hi] : [lo, hi];
}

function others(d: Diagram, exclude: Set<Id>): Rect[] {
  // The opaque part: a lifeline's header, not its whole height. Activation bars are left out:
  // they sit on lifelines, sized by the messages, not things to line boxes up with.
  return d.order.filter((id) => !exclude.has(id) && d.nodes[id].kind !== "activation").flatMap((id) => {
    const parts = footprint(d.nodes[id]);
    return parts.length > 1 ? [d.nodes[id].rect] : parts;
  });
}

/** The targets that can pull `r` along `axis`: those beside it (for rows) or above/below it (for
 * columns), not ones it overlaps across. */
function neighbours(targets: Rect[], r: Rect, axis: "x" | "y"): Rect[] {
  return targets.filter((t) =>
    axis === "y"
      ? t.x > right(r) || right(t) < r.x
      : t.y > bottom(r) || bottom(t) < r.y
  );
}

/** The nearest target line within SNAP of any of `mine`: the shift to apply, or 0. */
function nearest(mine: number[], targets: Rect[], axis: "x" | "y"): number {
  let best = 0, bestDist = SNAP + 1;
  for (const t of targets) {
    for (const v of lines(t, axis)) {
      for (const m of mine) {
        const dist = Math.abs(v - m);
        if (dist < bestDist) {
          bestDist = dist;
          best = v - m;
        }
      }
    }
  }
  return best;
}

/** Guides for every line of `r` that exactly matches a line of a neighbouring box. */
function guidesFor(r: Rect, targets: Rect[], axes: { x: number[]; y: number[] }): Guide[] {
  const out: Guide[] = [];
  for (const axis of ["x", "y"] as const) {
    for (const m of axes[axis]) {
      const matches = neighbours(targets, r, axis).filter((t) => lines(t, axis).includes(m));
      if (!matches.length) continue;
      const span = [r, ...matches];
      out.push(
        axis === "x"
          ? { axis, at: m, from: Math.min(...span.map((s) => s.y)), to: Math.max(...span.map(bottom)) }
          : { axis, at: m, from: Math.min(...span.map((s) => s.x)), to: Math.max(...span.map(right)) }
      );
    }
  }
  return out;
}

/** Snap a rect being moved: the shift to add, and the guides to show. */
export function snapMove(d: Diagram, moving: Iterable<Id>, r: Rect): { shift: Point; guides: Guide[] } {
  const targets = others(d, new Set(moving));
  const shift = {
    x: nearest(lines(r, "x"), neighbours(targets, r, "x"), "x"),
    y: nearest(lines(r, "y"), neighbours(targets, r, "y"), "y"),
  };
  const moved = { ...r, x: r.x + shift.x, y: r.y + shift.y };
  return { shift, guides: guidesFor(moved, targets, { x: lines(moved, "x"), y: lines(moved, "y") }) };
}

/** Snap the edges of a rect being resized (only those named), keeping the others put. */
export function snapResize(
  d: Diagram, id: Id, r: Rect, edges: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean }
): { rect: Rect; guides: Guide[] } {
  const targets = others(d, new Set([id]));
  let x0 = r.x, x1 = right(r), y0 = r.y, y1 = bottom(r);
  const cols = neighbours(targets, r, "x"), rows = neighbours(targets, r, "y");
  if (edges.left) x0 += nearest([x0], cols, "x");
  if (edges.right) x1 += nearest([x1], cols, "x");
  if (edges.top) y0 += nearest([y0], rows, "y");
  if (edges.bottom) y1 += nearest([y1], rows, "y");
  if (x1 < x0 || y1 < y0) return { rect: r, guides: [] };
  const rect = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  const axes = {
    x: [...(edges.left ? [x0] : []), ...(edges.right ? [x1] : [])],
    y: [...(edges.top ? [y0] : []), ...(edges.bottom ? [y1] : [])],
  };
  return { rect, guides: guidesFor(rect, targets, axes) };
}

/** Snap a point (the corner of a box being drawn) to other boxes' lines. */
export function snapPoint(d: Diagram, exclude: Id[], p: Point): { point: Point; guides: Guide[] } {
  const targets = others(d, new Set(exclude));
  const cell = { ...p, w: 1, h: 1 };
  const point = { x: p.x + nearest([p.x], neighbours(targets, cell, "x"), "x"), y: p.y + nearest([p.y], neighbours(targets, cell, "y"), "y") };
  return { point, guides: guidesFor({ ...point, w: 1, h: 1 }, targets, { x: [point.x], y: [point.y] }) };
}
