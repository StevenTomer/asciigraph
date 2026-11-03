import { type Rect, union } from "../geometry/geom";
import { topLevel } from "./arrange";
import { within, withContents } from "./containment";
import { moveObjects } from "./ops";
import type { Diagram, Id } from "./types";

/**
 * Automatic layout for graphs: a layered ("Sugiyama-style") layout, following the connectors.
 *  1. break cycles (a depth-first search reverses edges that point back up),
 *  2. rank nodes into layers by longest path from the sources,
 *  3. order each layer to reduce crossings (barycentre sweeps, down and up),
 *  4. place layers one after another, each centred on the widest.
 * Boxes move with what's inside them; connectors re-route themselves. Bend points on the
 * connectors between laid-out boxes are dropped (they'd be in the wrong place).
 */
export type LayoutDirection = "down" | "right";

const GAP = { down: { main: 4, cross: 4 }, right: { main: 10, cross: 2 } };
const SWEEPS = 4;

export function autoLayout(d: Diagram, ids: Id[], direction: LayoutDirection): Diagram {
  // The selected boxes, or every box that isn't inside another.
  const pool = ids.length ? ids : d.order;
  const nodes = topLevel(d, pool);
  if (nodes.length < 2) return d;
  const rect = (id: Id) => d.nodes[id].rect;
  const inSet = new Set(nodes);
  // A connector attached to something inside a laid-out box counts for that box.
  const owner = (id: Id): Id | null =>
    inSet.has(id) ? id : nodes.find((n) => d.nodes[id] && within(rect(id), rect(n))) ?? null;

  const down = direction === "down";
  const cross = (r: Rect) => (down ? r.x + r.w / 2 : r.y + r.h / 2);

  // Edges between laid-out boxes.
  const pairs: [Id, Id][] = [];
  const touched: Id[] = [];
  for (const e of Object.values(d.edges)) {
    if (e.from.kind !== "attached" || e.to.kind !== "attached") continue;
    const a = owner(e.from.node), b = owner(e.to.node);
    if (a && b && a !== b) {
      pairs.push([a, b]);
      touched.push(e.id);
    }
  }

  // 1. Break cycles: DFS in reading order; an edge to a node still on the stack is reversed.
  const reading = [...nodes].sort((p, q) => rect(p).y - rect(q).y || rect(p).x - rect(q).x);
  const out = new Map<Id, Id[]>(nodes.map((n) => [n, []]));
  for (const [a, b] of pairs) out.get(a)!.push(b);
  const state = new Map<Id, 0 | 1 | 2>();
  const dag: [Id, Id][] = [];
  const visit = (u: Id) => {
    state.set(u, 1);
    for (const v of out.get(u)!) {
      if (state.get(v) === 1) dag.push([v, u]); // back edge: reverse it
      else {
        dag.push([u, v]);
        if (!state.get(v)) visit(v);
      }
    }
    state.set(u, 2);
  };
  for (const n of reading) if (!state.get(n)) visit(n);

  // 2. Ranks: longest path from the sources.
  const preds = new Map<Id, Id[]>(nodes.map((n) => [n, []]));
  const succs = new Map<Id, Id[]>(nodes.map((n) => [n, []]));
  for (const [a, b] of dag) {
    succs.get(a)!.push(b);
    preds.get(b)!.push(a);
  }
  const rank = new Map<Id, number>();
  const rankOf = (u: Id): number => {
    if (rank.has(u)) return rank.get(u)!;
    rank.set(u, 0); // guards against any leftover cycle
    const r = Math.max(0, ...preds.get(u)!.map((p) => rankOf(p) + 1));
    rank.set(u, r);
    return r;
  };
  nodes.forEach(rankOf);
  const layers: Id[][] = [];
  for (const n of reading) (layers[rank.get(n)!] ??= []).push(n);
  for (const layer of layers) layer.sort((p, q) => cross(rect(p)) - cross(rect(q)));

  // 3. Order within layers: sort by the average position of neighbours in the adjacent layer.
  const position = new Map<Id, number>();
  const index = () => layers.forEach((layer) => layer.forEach((n, i) => position.set(n, i)));
  index();
  const bary = (n: Id, neighbours: Id[]) =>
    neighbours.length ? neighbours.reduce((s, m) => s + position.get(m)!, 0) / neighbours.length : position.get(n)!;
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    const downward = sweep % 2 === 0;
    const order = downward ? layers.slice(1) : layers.slice(0, -1).reverse();
    for (const layer of order) {
      const key = new Map(layer.map((n) => [n, bary(n, downward ? preds.get(n)! : succs.get(n)!)]));
      layer.sort((p, q) => key.get(p)! - key.get(q)!);
      layer.forEach((n, i) => position.set(n, i));
    }
  }

  // 4. Place: layers along the main axis, each centred on the widest across.
  const origin = union(nodes.map(rect))!;
  const gap = GAP[direction];
  const mainSize = (r: Rect) => (down ? r.h : r.w);
  const crossSize = (r: Rect) => (down ? r.w : r.h);
  const span = (layer: Id[]) => layer.reduce((s, n) => s + crossSize(rect(n)), 0) + gap.cross * (layer.length - 1);
  const widest = Math.max(...layers.map(span));
  let result = d;
  let main = down ? origin.y : origin.x;
  for (const layer of layers) {
    let c = (down ? origin.x : origin.y) + Math.floor((widest - span(layer)) / 2);
    const depth = Math.max(...layer.map((n) => mainSize(rect(n))));
    for (const n of layer) {
      const r = rect(n);
      // Centre each node in its layer's band.
      const m = main + Math.floor((depth - mainSize(r)) / 2);
      const [x, y] = down ? [c, m] : [m, c];
      const now = result.nodes[n].rect;
      result = moveObjects(result, withContents(result, [n]), { x: x - now.x, y: y - now.y });
      c += crossSize(r) + gap.cross;
    }
    main += depth + gap.main;
  }

  // The rearranged connectors route themselves; old bend points would be in the wrong place.
  const edges = { ...result.edges };
  for (const id of touched) if (edges[id].via) edges[id] = { ...edges[id], via: undefined };
  return { ...result, edges };
}
