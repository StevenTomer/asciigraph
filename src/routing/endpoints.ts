import {
  type Point, type Rect, type Side, SIDES, STEP, add, bottom, contains, key, right,
} from "../geometry/geom";
import type { Diagram, Edge, Endpoint, Node } from "../model/types";
import { within } from "../model/containment";
import { footprint, shapeOf } from "../shapes/registry";
import type { Occupancy } from "./occupancy";
import { type RouteEnd, route } from "./orthogonal";

/** Where an edge end actually is, after following its node. */
export interface Anchor {
  /** First (or last) cell of the path, just outside the node for attached ends. */
  cell: Point;
  /** The side's outward direction, for attached ends. */
  dir: Side | null;
  /** The node's border cell the end meets (where a junction like ┴ is drawn), if it has one. */
  border: Point | null;
  node: string | null;
}

export interface ResolvedEdge {
  edge: Edge;
  from: Anchor;
  to: Anchor;
  cells: Point[];
  /** Where the label is drawn (set by the rasterizer), or would go if it had one. */
  label?: Rect;
}

/** The rect an end "looks at" when choosing sides: its node, or its cell. */
function refRect(d: Diagram, ep: Endpoint): Rect | null {
  if (ep.kind === "free") return { x: ep.at.x, y: ep.at.y, w: 1, h: 1 };
  return d.nodes[ep.node]?.rect ?? null;
}

/** The cells an end could line up with: inside the border for a node (where it can attach), so
 * two auto ends facing each other pick the same column/row and the connector runs straight. */
function alignRect(d: Diagram, ep: Endpoint): Rect | null {
  if (ep.kind === "free") return { x: ep.at.x, y: ep.at.y, w: 1, h: 1 };
  const n = d.nodes[ep.node];
  if (!n) return null;
  const r = n.rect;
  if (!shapeOf(n).hasBorder(n)) return r;
  return { x: r.x + (r.w > 2 ? 1 : 0), y: r.y + (r.h > 2 ? 1 : 0), w: Math.max(1, r.w - 2), h: Math.max(1, r.h - 2) };
}

/**
 * Which side of `r` faces `other`: the axis with the clearer gap wins. Rows are about twice as
 * tall as columns are wide, so vertical gaps count double.
 */
export function facingSide(r: Rect, other: Rect): Side {
  const gapRight = other.x - right(r) - 1, gapLeft = r.x - right(other) - 1;
  const gapDown = other.y - bottom(r) - 1, gapUp = r.y - bottom(other) - 1;
  const gx = Math.max(gapRight, gapLeft), gy = Math.max(gapDown, gapUp);
  if (gy >= 0 && gy * 2 >= gx) return gapDown >= gapUp ? "bottom" : "top";
  if (gx >= 0) return gapRight >= gapLeft ? "right" : "left";
  // Overlapping: go by centers.
  const dx = other.x + other.w / 2 - (r.x + r.w / 2);
  const dy = other.y + other.h / 2 - (r.y + r.h / 2);
  if (Math.abs(dy) * 2 >= Math.abs(dx)) return dy >= 0 ? "bottom" : "top";
  return dx >= 0 ? "right" : "left";
}

/** Whether `other` lies beyond `r`'s `side` (so a connector can leave or arrive that way without
 * looping round). */
function ahead(r: Rect, other: Rect, side: Side): boolean {
  switch (side) {
    case "right": return other.x > right(r);
    case "left": return right(other) < r.x;
    case "bottom": return other.y > bottom(r);
    case "top": return bottom(other) < r.y;
  }
}

/** A shape that only takes connectors on some sides (a lifeline: left/right) gets the allowed
 * side nearest to facing the other end. */
function allowedSide(node: Node, side: Side, other: Rect | null): Side {
  const sides = shapeOf(node).sides;
  if (!sides || sides.includes(side)) return side;
  if (sides.includes("left") && sides.includes("right")) {
    const mid = node.rect.x + node.rect.w / 2;
    return other && other.x + other.w / 2 < mid ? "left" : "right";
  }
  return sides[0];
}

export function anchorFor(node: Node, side: Side, offset: number | undefined, other: Rect | null): Anchor {
  const shape = shapeOf(node);
  const r = node.rect;
  const [lo, hi] = shape.sideRange(node, side);
  const horizontal = side === "top" || side === "bottom";
  let along: number;
  if (offset !== undefined) {
    along = Math.min(hi, Math.max(lo, (horizontal ? r.x : r.y) + offset));
  } else {
    // Line up with the other end when their ranges overlap (a straight connector), else center.
    const [olo, ohi] = other
      ? horizontal ? [other.x, right(other)] : [other.y, bottom(other)]
      : [lo, hi];
    const a = Math.max(lo, olo), b = Math.min(hi, ohi);
    along = a <= b ? Math.floor((a + b) / 2) : Math.floor((lo + hi) / 2);
  }
  const edgeCell: Point = shape.anchor?.(node, side, along) ?? (horizontal
    ? { x: along, y: side === "top" ? r.y : bottom(r) }
    : { x: side === "left" ? r.x : right(r), y: along });
  return {
    cell: add(edgeCell, STEP[side]),
    dir: side,
    border: shape.hasBorder(node) ? edgeCell : null,
    node: node.id,
  };
}

export function resolveEndpoint(d: Diagram, ep: Endpoint, other: Endpoint): Anchor {
  if (ep.kind === "free") return { cell: ep.at, dir: null, border: null, node: null };
  const node = d.nodes[ep.node];
  if (!node) return { cell: { x: 0, y: 0 }, dir: null, border: null, node: null };
  const otherRect = refRect(d, other) ?? node.rect;
  const side = ep.side !== "auto" ? ep.side
    : ep.prefer && ahead(node.rect, otherRect, ep.prefer) ? ep.prefer
    : allowedSide(node, facingSide(node.rect, otherRect), refRect(d, other));
  return anchorFor(node, side, ep.offset, alignRect(d, other));
}

/**
 * Anchor both ends and route between them, through any bend points. Auto-side ends start on the
 * side facing the other end (or the nearest bend point); only if that route has to detour
 * (something in the way) are the other sides tried, which keeps the common case to one route.
 * `occupancy` holds connectors routed before this one, to keep off them. `quick` skips trying
 * other sides (used while dragging, for speed; the full routing runs when the drag ends).
 */
export function resolveEdge(d: Diagram, edge: Edge, occupancy?: Occupancy, quick = false): ResolvedEdge {
  // Boxes around either end (containers, frames) aren't in the way: the connector has to cross
  // their border anyway.
  const holds = (n: Node, ep: Endpoint) =>
    ep.kind === "free" ? contains(n.rect, ep.at) : ep.node !== n.id && !!d.nodes[ep.node] && within(d.nodes[ep.node].rect, n.rect);
  const obstacles = d.order
    .filter((id) => !holds(d.nodes[id], edge.from) && !holds(d.nodes[id], edge.to))
    .flatMap((id) => footprint(d.nodes[id]));
  const via = edge.via ?? [];
  const towards = (p: Point): Endpoint => ({ kind: "free", at: p });
  const fromOther = via.length ? towards(via[0]) : edge.to;
  const toOther = via.length ? towards(via[via.length - 1]) : edge.from;

  // Two connectors may share an end cell only going the same way (several leaving one spot fan
  // out; several arriving merge). An automatic end that would land where another connector goes
  // the other way moves along the side to a free cell.
  // Returns null when the side has no free cell (so another side gets tried).
  const settle = (a: Anchor, ep: Endpoint, role: "out" | "in"): Anchor | null => {
    if (!occupancy || ep.kind !== "attached" || !a.node || !a.dir) return a;
    const taken = (p: Point) => {
      const r = occupancy.endRole(p);
      return r !== undefined && r !== role;
    };
    if (!taken(a.cell)) return a;
    if (ep.offset !== undefined) return a; // pinned by hand: leave it
    const node = d.nodes[a.node];
    const horizontal = a.dir === "top" || a.dir === "bottom";
    const [lo, hi] = shapeOf(node).sideRange(node, a.dir);
    const at = horizontal ? a.cell.x : a.cell.y;
    const base = horizontal ? node.rect.x : node.rect.y;
    for (let k = 2; k <= hi - lo + 2; k += 2) {
      for (const along of [at + k, at - k]) {
        if (along < lo || along > hi) continue;
        const moved = anchorFor(node, a.dir, along - base, null);
        if (!taken(moved.cell)) return moved;
      }
    }
    return null;
  };

  // A line may turn right outside a node (┌─┴─┐), but an arrowhead must be approached head-on.
  const routeEnds = (f0: Anchor, t0: Anchor) => {
    const fs = settle(f0, edge.from, "out"), ts = settle(t0, edge.to, "in");
    const f = fs ?? f0, t = ts ?? t0;
    const crowded = !fs || !ts;
    const stops: RouteEnd[] = [
      { cell: f.cell, dir: f.dir, strict: edge.arrows.start },
      ...via.map((p) => ({ cell: p, dir: null })),
      { cell: t.cell, dir: t.dir, strict: edge.arrows.end },
    ];
    const groups = [`${key(f.cell)}>`, `${key(t.cell)}<`];
    let cells: Point[] = [];
    let cost = 0, clean = true;
    for (let i = 0; i + 1 < stops.length; i++) {
      const r = route(stops[i], stops[i + 1], obstacles, occupancy, groups);
      cells = i === 0 ? r.cells : [...cells, ...r.cells.slice(1)];
      cost += r.cost;
      clean &&= r.clean;
    }
    // An end squeezed onto a cell another connector uses the other way: a last resort.
    return crowded ? { cells, cost: cost + CROWDED_END_COST, clean: false, f, t } : { cells, cost, clean, f, t };
  };

  let best = routeEnds(resolveEndpoint(d, edge.from, fromOther), resolveEndpoint(d, edge.to, toOther));
  let from = best.f, to = best.t;
  // Something in the way (a long detour, more bends than an S-shape needs, or no head-on
  // approach): try other sides, first changing one end, then both if that didn't help.
  const poor = (r: { cells: Point[]; clean: boolean }, f: Anchor, t: Anchor) =>
    !r.clean || bends(r.cells) > 2 ||
    r.cells.length - 1 > Math.abs(f.cell.x - t.cell.x) + Math.abs(f.cell.y - t.cell.y) + DETOUR_ALLOWANCE;
  if (!quick && !via.length && poor(best, from, to)) {
    const fromOptions = sideOptions(d, edge.from, fromOther) ?? [from];
    const toOptions = sideOptions(d, edge.to, toOther) ?? [to];
    const pairs = [
      ...fromOptions.map((f) => [f, to] as const),
      ...toOptions.map((t) => [from, t] as const),
    ];
    const tryPairs = (ps: readonly (readonly [Anchor, Anchor])[]) => {
      for (const [f, t] of ps) {
        const r = routeEnds(f, t);
        if (r.cost < best.cost) {
          best = r;
          from = r.f;
          to = r.t;
        }
      }
    };
    tryPairs(pairs);
    if (poor(best, from, to)) tryPairs(fromOptions.flatMap((f) => toOptions.map((t) => [f, t] as const)));
  }
  occupancy?.add(best.cells, [`${key(from.cell)}>`, `${key(to.cell)}<`]);
  occupancy?.markEnd(from.cell, "out");
  occupancy?.markEnd(to.cell, "in");
  return { edge, from, to, cells: best.cells };
}

function bends(cells: Point[]): number {
  let n = 0;
  for (let i = 2; i < cells.length; i++) {
    const turnX = cells[i].x - cells[i - 1].x !== cells[i - 1].x - cells[i - 2].x;
    const turnY = cells[i].y - cells[i - 1].y !== cells[i - 1].y - cells[i - 2].y;
    if (turnX || turnY) n++;
  }
  return n;
}

/** Cost of an end that couldn't avoid another connector's end going the other way. */
const CROWDED_END_COST = 40;

/** How much longer than the straight-line distance a route may be before it counts as a detour. */
const DETOUR_ALLOWANCE = 6;

/** Every side an auto end could use, or null if the end is fixed. */
function sideOptions(d: Diagram, ep: Endpoint, other: Endpoint): Anchor[] | null {
  if (ep.kind !== "attached" || ep.side !== "auto") return null;
  const node = d.nodes[ep.node];
  if (!node) return null;
  const otherRect = alignRect(d, other);
  return (shapeOf(node).sides ?? SIDES).map((side) => anchorFor(node, side, ep.offset, otherRect));
}
