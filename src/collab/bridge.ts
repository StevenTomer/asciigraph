import * as Y from "yjs";
import type { Diagram, Id } from "../model/types";
import { cmp, rekey } from "./order";

/**
 * A diagram as a shared Yjs document, for live editing. Each kind of object is a map from id to
 * the whole object (as plain JSON), so changes merge object by object: two people moving
 * different boxes both stick; the same box, the last change wins. Paint order is a map from
 * node id to a sort key (collab/order.ts), and `meta` holds the diagram's name.
 *
 * `applyDiff` writes what changed between two versions of the diagram (the editor's state
 * before and after an edit); `toDiagram` reads the document back.
 */
const RECORDS = ["nodes", "edges", "sources", "locks"] as const;
type RecordName = (typeof RECORDS)[number];

export function maps(doc: Y.Doc) {
  return {
    nodes: doc.getMap<unknown>("nodes"),
    edges: doc.getMap<unknown>("edges"),
    sources: doc.getMap<unknown>("sources"),
    locks: doc.getMap<unknown>("locks"),
    order: doc.getMap<string>("order"),
    meta: doc.getMap<unknown>("meta"),
  };
}

/** The shared types an undo manager tracks (everything but the name). */
export function tracked(doc: Y.Doc): Y.AbstractType<any>[] {
  const m = maps(doc);
  return [m.nodes, m.edges, m.sources, m.locks, m.order];
}

export function toDiagram(doc: Y.Doc): Diagram {
  const m = maps(doc);
  const record = (name: RecordName) => Object.fromEntries(m[name].entries()) as Record<Id, never>;
  const nodes = record("nodes");
  // Every node, by key; one without a key (shouldn't happen) goes in front.
  const order = Object.keys(nodes).sort((a, b) => {
    const ka = m.order.get(a), kb = m.order.get(b);
    if (ka === undefined || kb === undefined) return ka === undefined ? (kb === undefined ? (a < b ? -1 : 1) : 1) : -1;
    return cmp(ka, a, kb, b);
  });
  const d: Diagram = { version: 1, nodes, edges: record("edges"), order };
  if (m.sources.size) d.sources = record("sources");
  if (m.locks.size) d.locks = record("locks");
  // Connectors and locks that refer to nodes someone else deleted at the same time: dropped
  // (as deleting the node would have done).
  for (const [id, e] of Object.entries(d.edges)) {
    const gone = (ep: { kind: string; node?: Id }) => ep.kind === "attached" && !nodes[ep.node!];
    if (gone(e.from) || gone(e.to)) {
      d.edges = { ...d.edges };
      delete d.edges[id];
    }
  }
  return d;
}

export function diagramName(doc: Y.Doc): string {
  const n = maps(doc).meta.get("name");
  return typeof n === "string" ? n : "Shared diagram";
}

/** Write the changes from `before` to `after` into the document, as one transaction. */
export function applyDiff(doc: Y.Doc, before: Diagram, after: Diagram, origin: unknown = null) {
  const m = maps(doc);
  doc.transact(() => {
    for (const name of RECORDS) {
      const a = (before[name] ?? {}) as Record<Id, unknown>;
      const b = (after[name] ?? {}) as Record<Id, unknown>;
      for (const id of Object.keys(a)) if (!(id in b)) m[name].delete(id);
      for (const [id, v] of Object.entries(b)) {
        // Unchanged objects keep their identity through an edit (the model is immutable); a
        // changed one is compared by content, so a no-op edit doesn't send anything.
        if (a[id] === v) continue;
        if (a[id] !== undefined && JSON.stringify(a[id]) === JSON.stringify(v)) continue;
        m[name].set(id, v);
      }
    }
    // Paint order: keys for nodes that moved (or are new); none for deleted ones.
    for (const id of before.order) if (!(id in after.nodes)) m.order.delete(id);
    if (!sameOrder(before.order, after.order) || after.order.some((id) => !m.order.has(id))) {
      const keys = new Map<string, string>();
      for (const id of after.order) {
        const k = m.order.get(id);
        if (k !== undefined) keys.set(id, k);
      }
      for (const [id, k] of rekey(after.order, keys)) m.order.set(id, k);
    }
  }, origin);
}

/** A new document holding `diagram`, named `name`, as an update (to store or send). */
export function seedUpdate(diagram: Diagram, name: string): Uint8Array {
  const doc = new Y.Doc();
  applyDiff(doc, { version: 1, nodes: {}, edges: {}, order: [] }, diagram);
  maps(doc).meta.set("name", name);
  return Y.encodeStateAsUpdate(doc);
}

const sameOrder = (a: Id[], b: Id[]) => a.length === b.length && a.every((id, i) => id === b[i]);
