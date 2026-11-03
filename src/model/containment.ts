import { type Point, type Rect, bottom, contains, right } from "../geometry/geom";
import type { Diagram, Endpoint, Id } from "./types";

/**
 * Nesting, worked out from positions rather than stored: a node is inside another when its rect
 * lies entirely within the other's. Nothing to keep in sync on resize, undo or paste, and it's
 * always what you see.
 */

/** `inner` lies within `outer` (and isn't the very same rect). */
export function within(inner: Rect, outer: Rect): boolean {
  const same = inner.x === outer.x && inner.y === outer.y && inner.w === outer.w && inner.h === outer.h;
  return !same && inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer);
}

/** Every node inside node `id`, at any depth. */
export function contents(d: Diagram, id: Id): Id[] {
  const outer = d.nodes[id]?.rect;
  if (!outer) return [];
  return d.order.filter((other) => other !== id && within(d.nodes[other].rect, outer));
}

const orderCache = new WeakMap<Diagram, Id[]>();

/**
 * Paint order, back to front: a node is always drawn after (in front of) the nodes it's inside,
 * however deep, whichever was created first. Among nodes at the same depth, `order` decides
 * (what "to front" changes).
 */
export function paintOrder(d: Diagram): Id[] {
  let out = orderCache.get(d);
  if (!out) {
    const depth = new Map<Id, number>();
    for (const id of d.order) {
      const r = d.nodes[id].rect;
      depth.set(id, d.order.filter((o) => o !== id && within(r, d.nodes[o].rect)).length);
    }
    const index = new Map(d.order.map((id, i) => [id, i]));
    out = [...d.order].sort((a, b) => depth.get(a)! - depth.get(b)! || index.get(a)! - index.get(b)!);
    orderCache.set(d, out);
  }
  return out;
}

/**
 * What moving `ids` should take along: everything inside each selected box that carries its
 * contents (the default; `carry: false` turns it off), and connectors whose free ends are all
 * inside those boxes. (Connectors attached to the boxes follow them on their own.)
 */
export function withContents(d: Diagram, ids: Id[]): Id[] {
  const out = new Set(ids);
  const carriers = ids.map((id) => d.nodes[id]).filter((n) => n && n.carry !== false);
  for (const n of carriers) for (const c of contents(d, n.id)) out.add(c);
  const inCarrier = (p: Point) => carriers.some((n) => contains(n.rect, p));
  for (const e of Object.values(d.edges)) {
    if (out.has(e.id)) continue;
    const free = [e.from, e.to].filter((ep): ep is Extract<Endpoint, { kind: "free" }> => ep.kind === "free");
    if (free.length && free.every((ep) => inCarrier(ep.at))) out.add(e.id);
  }
  return [...out];
}
