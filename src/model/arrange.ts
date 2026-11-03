import { type Rect, bottom, intersects, right, union } from "../geometry/geom";
import { within, withContents } from "./containment";
import { moveObjects } from "./ops";
import type { Diagram, Id } from "./types";

/**
 * Arranging nodes: stacking order, alignment and distribution. Names follow PowerPoint/Office.
 * Nesting still wins over stacking order (a box inside another is always in front of it; see
 * containment.ts), so these reorder nodes among the ones they overlap at the same depth.
 */

export function sendToBack(d: Diagram, ids: Iterable<Id>): Diagram {
  const back = new Set(ids);
  return { ...d, order: [...d.order.filter((id) => back.has(id)), ...d.order.filter((id) => !back.has(id))] };
}

/** Move each selected node in front of the next node above it that it overlaps (or back past the
 * next one below, for `backward`). Moving past nodes it doesn't touch would change nothing visible. */
function step(d: Diagram, ids: Iterable<Id>, backward: boolean): Diagram {
  const sel = new Set(ids);
  const order = backward ? [...d.order].reverse() : [...d.order];
  const rect = (id: Id) => d.nodes[id].rect;
  // Work from the end we're moving towards, so selected nodes don't leapfrog each other.
  for (let i = order.length - 2; i >= 0; i--) {
    const id = order[i];
    if (!sel.has(id)) continue;
    const j = order.findIndex((o, k) => k > i && !sel.has(o) && intersects(rect(o), rect(id)));
    if (j < 0) continue;
    order.splice(i, 1);
    order.splice(j, 0, id); // j shifted down by one after the removal: lands just past order[j]
  }
  return { ...d, order: backward ? order.reverse() : order };
}

export const bringForward = (d: Diagram, ids: Iterable<Id>) => step(d, ids, false);
export const sendBackward = (d: Diagram, ids: Iterable<Id>) => step(d, ids, true);

/** The selected nodes that aren't inside another selected node (those move with their container). */
export function topLevel(d: Diagram, ids: Id[]): Id[] {
  const nodes = ids.filter((id) => d.nodes[id]);
  return nodes.filter((id) => !nodes.some((o) => o !== id && within(d.nodes[id].rect, d.nodes[o].rect)));
}

/** Move a node (and what it carries) so its top-left cell is at (x, y). */
function moveTo(d: Diagram, id: Id, x: number, y: number): Diagram {
  const r = d.nodes[id].rect;
  return moveObjects(d, withContents(d, [id]), { x: x - r.x, y: y - r.y });
}

export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** Align nodes to the edge or centre of their combined bounds (PowerPoint's "Align Selected Objects"). */
export function align(d: Diagram, ids: Id[], how: Alignment): Diagram {
  const nodes = topLevel(d, ids);
  const bounds = union(nodes.map((id) => d.nodes[id].rect));
  if (!bounds || nodes.length < 2) return d;
  // Measure from the diagram as it was: moving one node can't change where the others go.
  const rects = new Map(nodes.map((id) => [id, d.nodes[id].rect]));
  let out = d;
  for (const [id, r] of rects) {
    const x =
      how === "left" ? bounds.x
      : how === "right" ? right(bounds) - r.w + 1
      : how === "center" ? Math.round(bounds.x + (bounds.w - r.w) / 2)
      : r.x;
    const y =
      how === "top" ? bounds.y
      : how === "bottom" ? bottom(bounds) - r.h + 1
      : how === "middle" ? Math.round(bounds.y + (bounds.h - r.h) / 2)
      : r.y;
    out = moveTo(out, id, x, y);
  }
  return out;
}

/**
 * Equal gaps between nodes across their combined span, keeping the first and last in place
 * (PowerPoint's Distribute Horizontally/Vertically). Needs three or more.
 */
export function distribute(d: Diagram, ids: Id[], axis: "horizontal" | "vertical"): Diagram {
  const nodes = topLevel(d, ids);
  if (nodes.length < 3) return d;
  const h = axis === "horizontal";
  const pos = (r: Rect) => (h ? r.x : r.y);
  const size = (r: Rect) => (h ? r.w : r.h);
  const sorted = nodes.map((id) => ({ id, r: d.nodes[id].rect })).sort((a, b) => pos(a.r) - pos(b.r) || size(a.r) - size(b.r));
  const first = sorted[0].r, last = sorted[sorted.length - 1].r;
  const span = pos(last) + size(last) - pos(first);
  const gap = (span - sorted.reduce((sum, s) => sum + size(s.r), 0)) / (sorted.length - 1);
  let out = d;
  let used = 0;
  sorted.forEach((s, i) => {
    const p = Math.round(pos(first) + used + gap * i);
    used += size(s.r);
    out = h ? moveTo(out, s.id, p, s.r.y) : moveTo(out, s.id, s.r.x, p);
  });
  return out;
}

/** Swap a connector's ends (and its arrowheads with them, so it points the other way). */
export function reverseEdge(d: Diagram, id: Id): Diagram {
  const e = d.edges[id];
  if (!e) return d;
  const reversed = { ...e, from: e.to, to: e.from, arrows: { start: e.arrows.end, end: e.arrows.start } };
  if (e.via) reversed.via = [...e.via].reverse();
  return { ...d, edges: { ...d.edges, [id]: reversed } };
}
