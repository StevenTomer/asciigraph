import { type Point, type Rect } from "../geometry/geom";
import { addEdge, addNode, deleteObjects, emptyDiagram, makeEdge, makeNode, newId, updateEdge, updateNode } from "../model/ops";
import type { Diagram, Edge, Endpoint, Id, Node, TextSource } from "../model/types";
import { type DesiredNode, type EndSpec, generate } from "./generate";

/**
 * Drawing from text, kept live: the diagram remembers the text, and redrawing after an edit
 * updates what's there rather than starting over. Things are matched by key (a participant's
 * name, a node's id, a path…):
 *  - content (text, shape, labels, what connects to what) always comes from the text;
 *  - a node the user moved or resized keeps its position or size; untouched ones follow the new
 *    layout. Dragging the whole drawing is noticed (most nodes moved by the same amount) and kept;
 *  - styling the user changed (borders, line styles, arrowheads) is kept; bend points and label
 *    positions are always kept;
 *  - things no longer in the text are removed; new ones are added.
 */

export interface SyncResult {
  diagram: Diagram;
  warnings: string[];
}

/** Draw a new text source with its top-left at `origin`. */
export function drawSource(d: Diagram, src: Pick<TextSource, "kind" | "text" | "options">, origin: Point): SyncResult & { id: Id } {
  const id = newId("n").replace(/^n/, "s");
  const r = sync(d, { ...src, id, origin });
  return { ...r, id };
}

/** Redraw a source after its text or options changed. */
export function updateSource(d: Diagram, id: Id, patch: Partial<Pick<TextSource, "kind" | "text" | "options">>): SyncResult {
  const src = d.sources?.[id];
  if (!src) return { diagram: d, warnings: ["that drawing's text is gone"] };
  return sync(d, { ...src, ...patch, options: { ...src.options, ...patch.options } });
}

/** Keep what was drawn, but forget the text: everything becomes ordinary objects. */
export function unlinkSource(d: Diagram, id: Id): Diagram {
  const strip = <T extends Node | Edge>(o: T): T => (o.gen?.source === id ? { ...o, gen: undefined } : o);
  const sources = { ...d.sources };
  delete sources[id];
  return {
    ...d,
    nodes: Object.fromEntries(Object.entries(d.nodes).map(([k, n]) => [k, strip(n)])),
    edges: Object.fromEntries(Object.entries(d.edges).map(([k, e]) => [k, strip(e)])),
    sources: Object.keys(sources).length ? sources : undefined,
  };
}

/** Ids of everything drawn from a source. */
export function membersOf(d: Diagram, id: Id): Id[] {
  return [...Object.values(d.nodes), ...Object.values(d.edges)].filter((o) => o.gen?.source === id).map((o) => o.id);
}

const nodeStyle = (n: Pick<Node, "border" | "align">) => JSON.stringify({ border: n.border, align: n.align });
const edgeStyle = (e: Pick<Edge, "line" | "arrows">) => JSON.stringify({ line: e.line, arrows: e.arrows });
const sameXY = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y;
const sameSize = (a: Rect, b: Rect) => a.w === b.w && a.h === b.h;

/** The rect a spec ends up with once its shape's size rules apply. */
function normalized(spec: DesiredNode["node"], rect: Rect): Rect {
  const tmp = addNode(emptyDiagram(), makeNode(rect, { ...spec, rect, id: "tmp" }));
  return tmp.nodes.tmp.rect;
}

function sync(d: Diagram, source: TextSource): SyncResult {
  const desired = generate(source);
  const nodes = new Map<string, Node>(), edges = new Map<string, Edge>();
  for (const n of Object.values(d.nodes)) if (n.gen?.source === source.id) nodes.set(n.gen.key, n);
  for (const e of Object.values(d.edges)) if (e.gen?.source === source.id) edges.set(e.gen.key, e);

  // Was the whole drawing dragged? Most nodes moved by the same amount since last generated.
  const deltas = new Map<string, number>();
  for (const n of nodes.values()) {
    if (!n.gen?.at) continue;
    const k = `${n.rect.x - n.gen.at.x},${n.rect.y - n.gen.at.y}`;
    deltas.set(k, (deltas.get(k) ?? 0) + 1);
  }
  const [common, votes] = [...deltas].sort((a, b) => b[1] - a[1])[0] ?? ["0,0", 0];
  const [sx, sy] = votes * 2 > nodes.size ? common.split(",").map(Number) : [0, 0];
  const origin = { x: source.origin.x + sx, y: source.origin.y + sy };

  let out = d;
  const idOf = new Map<string, Id>();
  for (const dn of desired.nodes) {
    const abs = { ...dn.node.rect, x: dn.node.rect.x + origin.x, y: dn.node.rect.y + origin.y };
    const fresh = normalized(dn.node, abs);
    const style = nodeStyle(dn.node);
    const ex = nodes.get(dn.key);
    if (ex) {
      const last = ex.gen!.at ? { ...ex.gen!.at, x: ex.gen!.at.x + sx, y: ex.gen!.at.y + sy } : ex.rect;
      const moved = !sameXY(ex.rect, last), resized = !ex.autosize && !sameSize(ex.rect, last);
      const rect = {
        x: moved ? ex.rect.x : fresh.x, y: moved ? ex.rect.y : fresh.y,
        w: resized ? ex.rect.w : fresh.w, h: resized ? ex.rect.h : fresh.h,
      };
      const restyled = ex.gen!.style !== undefined && ex.gen!.style !== nodeStyle(ex);
      out = updateNode(out, ex.id, {
        kind: dn.node.kind, text: dn.node.text, name: dn.node.name, autosize: dn.node.autosize, rect,
        ...(restyled ? {} : { border: dn.node.border, align: dn.node.align }),
        gen: { source: source.id, key: dn.key, at: fresh, style },
      });
      idOf.set(dn.key, ex.id);
    } else {
      const node = makeNode(abs, { ...dn.node, rect: abs, gen: { source: source.id, key: dn.key, at: fresh, style } });
      out = addNode(out, node);
      idOf.set(dn.key, node.id);
    }
  }

  const warnings = [...desired.warnings];
  const end = (es: EndSpec): Endpoint | null => {
    if ("at" in es) return { kind: "free", at: { x: es.at.x + origin.x, y: es.at.y + origin.y } };
    const node = idOf.get(es.key);
    return node ? { kind: "attached", node, side: es.side, ...(es.offset !== undefined && { offset: es.offset }) } : null;
  };
  const keptEdges = new Set<string>();
  for (const de of desired.edges) {
    const from = end(de.from), to = end(de.to);
    if (!from || !to) {
      warnings.push(`couldn't connect ${de.key}`);
      continue;
    }
    keptEdges.add(de.key);
    const style = edgeStyle(de);
    const ex = edges.get(de.key);
    if (ex) {
      const restyled = ex.gen!.style !== undefined && ex.gen!.style !== edgeStyle(ex);
      out = updateEdge(out, ex.id, {
        from, to, label: de.label,
        ...(restyled ? {} : { line: de.line, arrows: de.arrows }),
        gen: { source: source.id, key: de.key, style },
      });
    } else {
      out = addEdge(out, makeEdge(from, to, { label: de.label, line: de.line, arrows: de.arrows, gen: { source: source.id, key: de.key, style } }));
    }
  }

  // What the text no longer has.
  const wanted = new Set(desired.nodes.map((n) => n.key));
  const gone = [
    ...[...nodes.values()].filter((n) => !wanted.has(n.gen!.key)).map((n) => n.id),
    ...[...edges.values()].filter((e) => !keptEdges.has(e.gen!.key)).map((e) => e.id),
  ];
  if (gone.length) out = deleteObjects(out, gone);
  out = { ...out, sources: { ...out.sources, [source.id]: { ...source, origin } } };
  return { diagram: out, warnings };
}
