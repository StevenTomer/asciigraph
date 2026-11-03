import { type Point, type Rect, add } from "../geometry/geom";
import { resolveEndpoint } from "../routing/endpoints";
import { shapeOf } from "../shapes/registry";
import type { Diagram, Edge, Endpoint, Id, Node } from "./types";

/**
 * Pure document edits: each takes a diagram and returns a new one, sharing whatever didn't change.
 * The editor records the diagram before a change for undo, so nothing here deals with history.
 */

export function emptyDiagram(): Diagram {
  return { version: 1, nodes: {}, edges: {}, order: [] };
}

export function newId(prefix: "n" | "e"): Id {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function makeNode(rect: Rect, patch: Partial<Node> = {}): Node {
  return {
    id: newId("n"),
    kind: "box",
    rect,
    border: "single",
    text: "",
    align: { h: "center", v: "middle" },
    ...patch,
  };
}

export function makeEdge(from: Endpoint, to: Endpoint, patch: Partial<Edge> = {}): Edge {
  return { id: newId("e"), from, to, line: "single", arrows: { start: false, end: true }, ...patch };
}

/** Clamp to the shape's minimum size, and apply autosize. */
function normalizeNode(node: Node): Node {
  const shape = shapeOf(node);
  let rect = node.rect;
  if (node.autosize) rect = { ...rect, ...shape.fitSize(node, node.text) };
  const min = shape.minSize(node);
  if (rect.w < min.w || rect.h < min.h) {
    rect = { ...rect, w: Math.max(rect.w, min.w), h: Math.max(rect.h, min.h) };
  }
  return rect === node.rect ? node : { ...node, rect };
}

export function addNode(d: Diagram, node: Node): Diagram {
  const n = normalizeNode(node);
  return { ...d, nodes: { ...d.nodes, [n.id]: n }, order: [...d.order, n.id] };
}

export function updateNode(d: Diagram, id: Id, patch: Partial<Node>): Diagram {
  const old = d.nodes[id];
  if (!old) return d;
  const n = normalizeNode({ ...old, ...patch });
  return { ...d, nodes: { ...d.nodes, [id]: n } };
}

/** Set a node's text; bordered boxes grow taller to fit it, labels resize to it. */
export function setNodeText(d: Diagram, id: Id, text: string): Diagram {
  const old = d.nodes[id];
  if (!old) return d;
  const fitted = old.autosize ? old.rect : { ...old.rect, ...shapeOf(old).fitSize(old, text) };
  return updateNode(d, id, { text, rect: fitted });
}

/** A resize by hand: turns autosize off. */
export function resizeNode(d: Diagram, id: Id, rect: Rect): Diagram {
  return updateNode(d, id, { rect, autosize: false });
}

export function addEdge(d: Diagram, edge: Edge): Diagram {
  return { ...d, edges: { ...d.edges, [edge.id]: edge } };
}

export function updateEdge(d: Diagram, id: Id, patch: Partial<Edge>): Diagram {
  const old = d.edges[id];
  if (!old) return d;
  return { ...d, edges: { ...d.edges, [id]: { ...old, ...patch } } };
}

export function setEndpoint(d: Diagram, id: Id, which: "from" | "to", ep: Endpoint): Diagram {
  return updateEdge(d, id, { [which]: ep });
}

/**
 * Move nodes and edges by `delta`. Attached edge ends follow their nodes by themselves; free ends
 * and bend points move only if their edge is among `ids`.
 */
export function moveObjects(d: Diagram, ids: Iterable<Id>, delta: Point): Diagram {
  if (delta.x === 0 && delta.y === 0) return d;
  const nodes = { ...d.nodes };
  const edges = { ...d.edges };
  const moveFree = (ep: Endpoint): Endpoint => (ep.kind === "free" ? { ...ep, at: add(ep.at, delta) } : ep);
  for (const id of ids) {
    if (nodes[id]) {
      const r = nodes[id].rect;
      nodes[id] = { ...nodes[id], rect: { ...r, x: r.x + delta.x, y: r.y + delta.y } };
    } else if (edges[id]) {
      const e = edges[id];
      edges[id] = { ...e, from: moveFree(e.from), to: moveFree(e.to), ...(e.via && { via: e.via.map((p) => add(p, delta)) }) };
    }
  }
  return { ...d, nodes, edges };
}

/** Free an end where it currently is (used when its node is deleted, or on detach). */
export function freeEndpoint(d: Diagram, edge: Edge, which: "from" | "to"): Endpoint {
  const other = which === "from" ? edge.to : edge.from;
  return { kind: "free", at: resolveEndpoint(d, edge[which], other).cell };
}

/** Delete objects. Edges attached to a deleted node stay, with that end left free where it was. */
export function deleteObjects(d: Diagram, ids: Iterable<Id>): Diagram {
  const gone = new Set(ids);
  const edges: Record<Id, Edge> = {};
  for (const e of Object.values(d.edges)) {
    if (gone.has(e.id)) continue;
    let next = e;
    for (const which of ["from", "to"] as const) {
      const ep = e[which];
      if (ep.kind === "attached" && gone.has(ep.node)) {
        next = { ...next, [which]: freeEndpoint(d, e, which) };
      }
    }
    edges[e.id] = next;
  }
  const nodes = Object.fromEntries(Object.entries(d.nodes).filter(([id]) => !gone.has(id)));
  return { ...d, nodes, edges, order: d.order.filter((id) => !gone.has(id)) };
}

export function bringToFront(d: Diagram, ids: Iterable<Id>): Diagram {
  const front = new Set(ids);
  return { ...d, order: [...d.order.filter((id) => !front.has(id)), ...d.order.filter((id) => front.has(id))] };
}

/** Check a parsed object looks like a diagram (for imports and storage). */
export function isDiagram(x: unknown): x is Diagram {
  const d = x as Diagram;
  return !!d && d.version === 1 && typeof d.nodes === "object" && typeof d.edges === "object" && Array.isArray(d.order);
}
