import { type Point, type Rect, bottom, contains, right } from "../geometry/geom";
import { covers } from "../shapes/registry";
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
 * Paint order, back to front: the stacking order (`order`, which "to front" / "to back" change),
 * except that a node always comes after any container that would otherwise cover it
 * (ShapeDef.covers: a box around it, a lifeline's header or line under it), however deep, so it
 * stays visible. Containers that wouldn't cover it (a frame, whose inside is see-through) don't
 * constrain it: a box in a frame, or an activation bar and a frame it overlaps, stack either way.
 */
export function paintOrder(d: Diagram): Id[] {
  let out = orderCache.get(d);
  if (!out) {
    // A topological sort (containers before what they cover) that otherwise keeps `order`:
    // of the nodes free to go next, the one earliest in the stacking order goes.
    const index = new Map(d.order.map((id, i) => [id, i]));
    const after = new Map<Id, Id[]>(d.order.map((id) => [id, []]));
    const waiting = new Map<Id, number>();
    for (const id of d.order) {
      const r = d.nodes[id].rect;
      const cs = d.order.filter((o) => o !== id && within(r, d.nodes[o].rect) && covers(d.nodes[o], r));
      waiting.set(id, cs.length);
      for (const c of cs) after.get(c)!.push(id);
    }
    const ready = d.order.filter((id) => waiting.get(id) === 0);
    const order: Id[] = [];
    while (ready.length) {
      ready.sort((a, b) => index.get(a)! - index.get(b)!);
      const id = ready.shift()!;
      order.push(id);
      for (const n of after.get(id)!) {
        waiting.set(n, waiting.get(n)! - 1);
        if (waiting.get(n) === 0) ready.push(n);
      }
    }
    // (Containment can't loop, but just in case: anything left keeps its place at the end.)
    for (const id of d.order) if (!order.includes(id)) order.push(id);
    out = order;
    orderCache.set(d, out);
  }
  return out;
}

/**
 * What moving `ids` should take along: everything inside each selected box that carries its
 * contents (the default; `carry: false` turns it off), and connectors whose free ends and bend
 * points are all inside those boxes. (Attached ends follow their boxes on their own.)
 */
export function withContents(d: Diagram, ids: Id[]): Id[] {
  const out = new Set(ids);
  const carriers = ids.map((id) => d.nodes[id]).filter((n) => n && n.carry !== false);
  for (const n of carriers) for (const c of contents(d, n.id)) out.add(c);
  const inCarrier = (p: Point) => carriers.some((n) => contains(n.rect, p));
  for (const e of Object.values(d.edges)) {
    if (out.has(e.id)) continue;
    const points = [
      ...[e.from, e.to].filter((ep): ep is Extract<Endpoint, { kind: "free" }> => ep.kind === "free").map((ep) => ep.at),
      ...(e.via ?? []),
    ];
    if (points.length && points.every(inCarrier)) out.add(e.id);
  }
  return [...out];
}
