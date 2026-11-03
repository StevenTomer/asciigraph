import {
  type Point, type Rect, type Side, SIDES, STEP, add, bottom, right,
} from "../geometry/geom";
import type { Diagram, Edge, Endpoint, Node } from "../model/types";
import { shapeOf } from "../shapes/registry";
import { route } from "./orthogonal";

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
  // Overlapping: go by centres.
  const dx = other.x + other.w / 2 - (r.x + r.w / 2);
  const dy = other.y + other.h / 2 - (r.y + r.h / 2);
  if (Math.abs(dy) * 2 >= Math.abs(dx)) return dy >= 0 ? "bottom" : "top";
  return dx >= 0 ? "right" : "left";
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
    // Line up with the other end when their ranges overlap (a straight connector), else centre.
    const [olo, ohi] = other
      ? horizontal ? [other.x, right(other)] : [other.y, bottom(other)]
      : [lo, hi];
    const a = Math.max(lo, olo), b = Math.min(hi, ohi);
    along = a <= b ? Math.floor((a + b) / 2) : Math.floor((lo + hi) / 2);
  }
  const edgeCell: Point = horizontal
    ? { x: along, y: side === "top" ? r.y : bottom(r) }
    : { x: side === "left" ? r.x : right(r), y: along };
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
  const side = ep.side === "auto"
    ? facingSide(node.rect, refRect(d, other) ?? node.rect)
    : ep.side;
  return anchorFor(node, side, ep.offset, alignRect(d, other));
}

/**
 * Anchor both ends and route between them. Auto-side ends start on the side facing the other end;
 * only if that route has to detour (something in the way) are the other sides tried, which keeps
 * the common case to a single route.
 */
export function resolveEdge(d: Diagram, edge: Edge): ResolvedEdge {
  const obstacles = d.order.map((id) => d.nodes[id].rect);
  // A line may turn right outside a node (┌─┴─┐), but an arrowhead must be approached head-on.
  const routeEnds = (f: Anchor, t: Anchor) =>
    route(
      { cell: f.cell, dir: f.dir, strict: edge.arrows.start },
      { cell: t.cell, dir: t.dir, strict: edge.arrows.end },
      obstacles
    );
  let from = resolveEndpoint(d, edge.from, edge.to);
  let to = resolveEndpoint(d, edge.to, edge.from);
  let best = routeEnds(from, to);
  const direct = Math.abs(from.cell.x - to.cell.x) + Math.abs(from.cell.y - to.cell.y) + DETOUR_ALLOWANCE;
  if (!best.clean || best.cost > direct) {
    const fromOptions = sideOptions(d, edge.from, edge.to) ?? [from];
    const toOptions = sideOptions(d, edge.to, edge.from) ?? [to];
    for (const f of fromOptions) {
      for (const t of toOptions) {
        const r = routeEnds(f, t);
        if (r.cost < best.cost) {
          best = r;
          from = f;
          to = t;
        }
      }
    }
  }
  return { edge, from, to, cells: best.cells };
}

/** Route cost beyond the straight-line distance that still counts as direct (two bends' worth). */
const DETOUR_ALLOWANCE = 10;

/** Every side an auto end could use, or null if the end is fixed. */
function sideOptions(d: Diagram, ep: Endpoint, other: Endpoint): Anchor[] | null {
  if (ep.kind !== "attached" || ep.side !== "auto") return null;
  const node = d.nodes[ep.node];
  if (!node) return null;
  const otherRect = alignRect(d, other);
  return SIDES.map((side) => anchorFor(node, side, ep.offset, otherRect));
}
