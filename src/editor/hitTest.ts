import { type Point, type Rect, type Side, bottom, key, right } from "../geometry/geom";
import { paintOrder } from "../model/containment";
import type { Diagram, Endpoint, Id } from "../model/types";
import { hits, shapeOf } from "../shapes/registry";
import { getState } from "./store";
import { borderToScreen, cellCenter, rendered, screenToCell } from "./view";

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export type Hit =
  | { kind: "handle"; node: Id; handle: Handle }
  | { kind: "endpoint"; edge: Id; which: "from" | "to" }
  | { kind: "via"; edge: Id; index: number }
  | { kind: "label"; edge: Id }
  | { kind: "node"; node: Id; nameRow: boolean }
  | { kind: "edge"; edge: Id }
  | { kind: "none" };

const HANDLE_RADIUS = 7;

/** Screen positions of a node's resize handles. */
export function handlePositions(r: Rect): Record<Handle, Point> {
  const s = borderToScreen(r);
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2, x1 = s.x + s.w, y1 = s.y + s.h;
  return {
    nw: { x: s.x, y: s.y }, n: { x: cx, y: s.y }, ne: { x: x1, y: s.y }, e: { x: x1, y: cy },
    se: { x: x1, y: y1 }, s: { x: cx, y: y1 }, sw: { x: s.x, y: y1 }, w: { x: s.x, y: cy },
  };
}

const near = (a: Point, b: Point) => Math.abs(a.x - b.x) <= HANDLE_RADIUS && Math.abs(a.y - b.y) <= HANDLE_RADIUS;

/** Topmost node covering a cell (in paint order: an inner box before the box around it). */
export function nodeAt(d: Diagram, cell: Point): Id | null {
  const order = paintOrder(d);
  for (let i = order.length - 1; i >= 0; i--) {
    if (hits(d.nodes[order[i]], cell)) return order[i];
  }
  return null;
}

export function hitTest(sx: number, sy: number): Hit {
  const { diagram: d, selection } = getState();
  const p = { x: sx, y: sy };
  const r = rendered(d);
  // Handles of selected things first: they sit on top.
  for (const id of selection) {
    const edge = r.edges.get(id);
    if (edge) {
      if (near(p, cellCenter(edge.cells[0]))) return { kind: "endpoint", edge: id, which: "from" };
      if (near(p, cellCenter(edge.cells[edge.cells.length - 1]))) return { kind: "endpoint", edge: id, which: "to" };
      const via = edge.edge.via ?? [];
      for (let i = 0; i < via.length; i++) if (near(p, cellCenter(via[i]))) return { kind: "via", edge: id, index: i };
    }
  }
  if (selection.length === 1 && d.nodes[selection[0]]) {
    const positions = handlePositions(d.nodes[selection[0]].rect);
    for (const h of HANDLES) if (near(p, positions[h])) return { kind: "handle", node: selection[0], handle: h };
  }
  const cell = screenToCell(sx, sy);
  // A connector wherever it's visible, even inside a box (one passing behind a box isn't); its
  // label is a handle of its own, for dragging along the connector.
  const edge = r.edgeCells.get(key(cell));
  if (edge) {
    const label = d.edges[edge]?.label && r.edges.get(edge)?.label;
    if (label && cell.y === label.y && cell.x >= label.x && cell.x < label.x + label.w) return { kind: "label", edge };
    return { kind: "edge", edge };
  }
  const node = nodeAt(d, cell);
  if (node) {
    const n = d.nodes[node];
    return { kind: "node", node, nameRow: n.kind === "box" && n.border !== "none" && cell.y === n.rect.y };
  }
  return { kind: "none" };
}

/**
 * The endpoint for a drop at `cell`: attached to the node there or right beside it, or free.
 * On a node's border (or the cell just outside it), the end is pinned to that side and position;
 * inside, it picks its side automatically. `exclude` stops an edge attaching to its other node.
 */
export function endpointAt(d: Diagram, cell: Point, free: boolean, exclude?: Id): Endpoint {
  if (free) return { kind: "free", at: cell };
  const id = nodeAt(d, cell);
  if (id && id !== exclude) {
    const n = d.nodes[id];
    // On a lifeline's line or an activation bar: a message at that row (the side is picked to
    // face the other end).
    if (shapeOf(n).attachByRow?.(n, cell)) return { kind: "attached", node: id, side: "auto", offset: cell.y - n.rect.y };
    const side = borderSide(n.rect, cell);
    if (side && shapeOf(n).hasBorder(n)) return pinned(id, n.rect, side, cell);
    return { kind: "attached", node: id, side: "auto" };
  }
  // Just outside a node: pin to the side it's next to.
  const order = paintOrder(d);
  for (let i = order.length - 1; i >= 0; i--) {
    const nid = order[i];
    if (nid === exclude) continue;
    const r = d.nodes[nid].rect;
    const side = outsideSide(r, cell);
    if (side) return pinned(nid, r, side, cell);
  }
  return { kind: "free", at: cell };
}

function pinned(node: Id, r: Rect, side: Side, cell: Point): Endpoint {
  const offset = side === "top" || side === "bottom" ? cell.x - r.x : cell.y - r.y;
  return { kind: "attached", node, side, offset };
}

/** Which side's border (not corner) a cell inside the rect is on. */
function borderSide(r: Rect, c: Point): Side | null {
  const corner = (c.x === r.x || c.x === right(r)) && (c.y === r.y || c.y === bottom(r));
  if (corner) return null;
  if (c.y === r.y) return "top";
  if (c.y === bottom(r)) return "bottom";
  if (c.x === r.x) return "left";
  if (c.x === right(r)) return "right";
  return null;
}

/** Which side a cell is directly outside of (not diagonally past a corner). */
function outsideSide(r: Rect, c: Point): Side | null {
  const inX = c.x > r.x && c.x < right(r), inY = c.y > r.y && c.y < bottom(r);
  if (inX && c.y === r.y - 1) return "top";
  if (inX && c.y === bottom(r) + 1) return "bottom";
  if (inY && c.x === r.x - 1) return "left";
  if (inY && c.x === right(r) + 1) return "right";
  return null;
}
