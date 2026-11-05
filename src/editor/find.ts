import type { Diagram, Id } from "../model/types";

/**
 * Find: the objects whose text has `query` in it (any case): boxes' text and names, connectors'
 * labels and end labels. In reading order, top to bottom then left to right (a connector by
 * where it starts).
 */
export function findMatches(d: Diagram, query: string): Id[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const has = (...texts: (string | undefined)[]) => texts.some((t) => t?.toLowerCase().includes(q));
  const found: { id: Id; x: number; y: number }[] = [];
  for (const n of Object.values(d.nodes)) if (has(n.text, n.name)) found.push({ id: n.id, x: n.rect.x, y: n.rect.y });
  for (const e of Object.values(d.edges)) {
    if (!has(e.label, e.endLabels?.start, e.endLabels?.end)) continue;
    const at = e.from.kind === "free" ? e.from.at : d.nodes[e.from.node]?.rect ?? { x: 0, y: 0 };
    found.push({ id: e.id, x: at.x, y: at.y });
  }
  return found.sort((a, b) => a.y - b.y || a.x - b.x).map((f) => f.id);
}
