import { type Point, type Rect, add, contains, right } from "../geometry/geom";
import { within } from "./containment";
import { resolveEndpoint } from "../routing/endpoints";
import { lifelineColumn } from "../shapes/lifeline";
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
  if (shape.normalize) {
    const n = shape.normalize(rect);
    if (n.w !== rect.w || n.h !== rect.h || n.x !== rect.x || n.y !== rect.y) rect = n;
  }
  return rect === node.rect ? node : { ...node, rect };
}

export function addNode(d: Diagram, node: Node): Diagram {
  const n = normalizeNode(node);
  return seatActivations({ ...d, nodes: { ...d.nodes, [n.id]: n }, order: [...d.order, n.id] }, [n.id]);
}

/**
 * Activation bars belong on a lifeline's line: one whose middle column is within a column of a
 * lifeline's line (and which overlaps that lifeline vertically) is moved to sit centered on it.
 */
export function seatActivations(d: Diagram, ids: Iterable<Id>): Diagram {
  let out = d;
  for (const id of ids) {
    const a = out.nodes[id];
    if (a?.kind !== "activation") continue;
    const mid = a.rect.x + 1;
    const line = Object.values(out.nodes).find(
      (n) => n.kind === "lifeline" && Math.abs(lifelineColumn(n.rect) - mid) <= 1 &&
        a.rect.y <= n.rect.y + n.rect.h - 1 && a.rect.y + a.rect.h - 1 >= n.rect.y
    );
    if (line && lifelineColumn(line.rect) !== mid) {
      out = { ...out, nodes: { ...out.nodes, [id]: { ...a, rect: { ...a.rect, x: lifelineColumn(line.rect) - 1 } } } };
    }
  }
  return out;
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
  return seatActivations(updateNode(d, id, { rect, autosize: false }), [id]);
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
  const list = [...ids];
  const moving = new Set(list);
  const nodes = { ...d.nodes };
  const edges = { ...d.edges };
  const moveFree = (ep: Endpoint): Endpoint => (ep.kind === "free" ? { ...ep, at: add(ep.at, delta) } : ep);
  // Sequence diagrams keep their rows: moving a lifeline up or down moves its header, not the
  // messages on it or the activation bars it carries.
  const lifelines = list.filter((id) => nodes[id]?.kind === "lifeline");
  const barOwner = (id: Id) => {
    const b = d.nodes[id];
    return lifelines.find((l) => b.rect.x + 1 === lifelineColumn(d.nodes[l].rect) && within(b.rect, d.nodes[l].rect));
  };
  for (const id of list) {
    if (nodes[id]) {
      const r = nodes[id].rect;
      const keepRow = nodes[id].kind === "activation" && barOwner(id) !== undefined;
      nodes[id] = { ...nodes[id], rect: { ...r, x: r.x + delta.x, y: r.y + (keepRow ? 0 : delta.y) } };
    } else if (edges[id]) {
      const e = edges[id];
      edges[id] = { ...e, from: moveFree(e.from), to: moveFree(e.to), ...(e.via && { via: e.via.map((p) => add(p, delta)) }) };
    }
  }
  if (lifelines.length && delta.y) {
    const moved = new Set(lifelines);
    const keep = (ep: Endpoint): Endpoint =>
      ep.kind === "attached" && moved.has(ep.node) && ep.offset !== undefined && ep.side !== "top" && ep.side !== "bottom"
        ? { ...ep, offset: ep.offset - delta.y }
        : ep;
    for (const [id, e] of Object.entries(edges)) {
      const from = keep(e.from), to = keep(e.to);
      if (from !== e.from || to !== e.to) edges[id] = { ...e, from, to };
    }
  }
  // Frames (loop / alt blocks) spanning lifelines stretch with the outermost ones they span.
  if (lifelines.length && delta.x) {
    for (const f of Object.values(d.nodes)) {
      if (f.kind !== "frame" || moving.has(f.id)) continue;
      const spanned = Object.values(d.nodes)
        .filter((l) => l.kind === "lifeline" && contains(f.rect, { x: lifelineColumn(l.rect), y: Math.max(f.rect.y, l.rect.y) })
          && l.rect.y + l.rect.h - 1 >= f.rect.y)
        .sort((a, b) => lifelineColumn(a.rect) - lifelineColumn(b.rect));
      if (!spanned.length) continue;
      let x0 = f.rect.x, x1 = right(f.rect);
      if (moving.has(spanned[0].id)) x0 += delta.x;
      if (moving.has(spanned[spanned.length - 1].id)) x1 += delta.x;
      if (x0 === f.rect.x && x1 === right(f.rect)) continue;
      if (x1 - x0 + 1 < 4) x1 = x0 + 3;
      nodes[f.id] = { ...nodes[f.id], rect: { ...f.rect, x: x0, w: x1 - x0 + 1 } };
    }
  }
  return seatActivations({ ...d, nodes, edges }, list);
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
  const kept = dropUnusedSources({ ...d, nodes, edges, order: d.order.filter((id) => !gone.has(id)) });
  if (!kept.locks) return kept;
  const locks = Object.fromEntries(
    Object.values(kept.locks)
      .map((l) => ({ ...l, members: l.members.filter((m) => !gone.has(m)) }))
      .filter((l) => l.members.length >= 2)
      .map((l) => [l.id, l])
  );
  return { ...kept, locks: Object.keys(locks).length ? locks : undefined };
}

/** Text sources with nothing left drawn from them. */
function dropUnusedSources(d: Diagram): Diagram {
  if (!d.sources) return d;
  const used = new Set([...Object.values(d.nodes), ...Object.values(d.edges)].map((o) => o.gen?.source));
  const kept = Object.fromEntries(Object.entries(d.sources).filter(([id]) => used.has(id)));
  if (Object.keys(kept).length === Object.keys(d.sources).length) return d;
  return { ...d, sources: Object.keys(kept).length ? kept : undefined };
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
