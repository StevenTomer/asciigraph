import { type Point, type Rect } from "../geometry/geom";
import { addEdge, addNode, deleteObjects, emptyDiagram, makeEdge, makeNode, newId, updateEdge, updateNode } from "../model/ops";
import type { Diagram, Edge, Endpoint, Id, Node, TextSource } from "../model/types";
import { shapeOf } from "../shapes/registry";
import { describe } from "./fromDiagram";
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
export function updateSource(
  d: Diagram, id: Id, patch: Partial<Pick<TextSource, "kind" | "text" | "options">>, opts: { relayout?: boolean } = {}
): SyncResult {
  const src = d.sources?.[id];
  if (!src) return { diagram: d, warnings: ["that drawing's text is gone"] };
  return sync(d, { ...src, ...patch, options: { ...src.options, ...patch.options } }, !!opts.relayout);
}

/**
 * Lay a drawn graph (or boxes-style folder tree) out the other way: top to bottom (TB) or left to
 * right (LR). Everything is laid out afresh, positions set by hand included (keeping them would
 * leave it half one way and half the other); the text's `flowchart TD/LR` header follows.
 */
export function setDirection(d: Diagram, id: Id, direction: "down" | "right"): SyncResult {
  const src = d.sources?.[id];
  if (!src) return { diagram: d, warnings: [] };
  const code = direction === "right" ? "LR" : "TD";
  const text = src.kind === "graph" ? withDirection(src.text, code) : src.text;
  return updateSource(d, id, { text, options: { direction } }, { relayout: true });
}

/**
 * The text with its direction set: in a flowchart's header (`flowchart LR`), or for state, class
 * and ER diagrams on a `direction LR` line (replaced if there is one at the top level, else added
 * after the header).
 */
function withDirection(text: string, code: "LR" | "TD"): string {
  if (/^\s*(flowchart|graph)\b/m.test(text)) return text.replace(/^(\s*)(flowchart|graph)\b[ \t]*(TD|TB|BT|LR|RL)?/m, `$1$2 ${code}`);
  const header = /^(\s*)(stateDiagram(-v2)?|classDiagram(-v2)?|erDiagram)\b.*$/m.exec(text);
  if (!header) return text;
  const lines = text.split("\n");
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/%%.*$/, "").trim();
    if (depth === 0 && /^direction\s+(TB|TD|BT|LR|RL)\s*$/i.test(t)) {
      lines[i] = lines[i].replace(/direction\s+\w+/i, `direction ${code === "TD" ? "TB" : "LR"}`);
      return lines.join("\n");
    }
    depth += (t.match(/\{/g) ?? []).length - (t.match(/\}/g) ?? []).length;
  }
  const at = text.slice(0, header.index).split("\n").length;
  const indent = (lines[at] ?? "").match(/^\s*/)![0] || header[1] + "  ";
  lines.splice(at, 0, `${indent}direction ${code === "TD" ? "TB" : "LR"}`);
  return lines.join("\n");
}

/** Keep what was drawn, but forget the text: everything becomes ordinary objects. */
export function unlinkSource(d: Diagram, id: Id): Diagram {
  const strip = <T extends Node | Edge>(o: T): T => (o.gen?.source === id ? { ...o, gen: undefined } : o);
  const sources = { ...d.sources };
  delete sources[id];
  // Its locks stay (they're still useful), as ordinary ones.
  const locks = d.locks && Object.fromEntries(Object.entries(d.locks).map(([k, l]) => [k, l.source === id ? { ...l, source: undefined } : l]));
  return {
    ...d,
    locks,
    nodes: Object.fromEntries(Object.entries(d.nodes).map(([k, n]) => [k, strip(n)])),
    edges: Object.fromEntries(Object.entries(d.edges).map(([k, e]) => [k, strip(e)])),
    sources: Object.keys(sources).length ? sources : undefined,
  };
}

/**
 * Link part of a hand-drawn diagram to text written for it (fromDiagram.ts), so it can be
 * edited as text. Everything keeps its place and style: they count as placed by hand.
 */
export function adopt(d: Diagram, ids: Id[]): (SyncResult & { id: Id; source: TextSource }) | null {
  const desc = describe(d, ids);
  if (!desc) return null;
  const id = newId("n").replace(/^n/, "s");
  const source: TextSource = { id, kind: desc.kind, text: desc.text, options: desc.options, origin: desc.origin };
  const desired = generate(source);
  const nodeSpecs = new Map(desired.nodes.map((n) => [n.key, n.node]));
  const edgeSpecs = new Map(desired.edges.map((e) => [e.key, e]));
  const nodes = { ...d.nodes }, edges = { ...d.edges };
  for (const [objId, key] of desc.keys) {
    if (nodes[objId]) {
      const spec = nodeSpecs.get(key);
      nodes[objId] = { ...nodes[objId], gen: { source: id, key, placed: true, ...(spec && { style: nodeStyle(spec) }) } };
    } else if (edges[objId]) {
      // Written the other way round (Mermaid arrows point forward): compare styles that way too.
      const spec = edgeSpecs.get(key);
      const style = spec && (desc.swapped.has(objId) ? edgeStyle(flipEnds(spec)) : edgeStyle(spec));
      edges[objId] = { ...edges[objId], gen: { source: id, key, placed: true, ...(style && { style }) } };
    }
  }
  return { diagram: { ...d, nodes, edges, sources: { ...d.sources, [id]: source } }, warnings: desired.warnings, id, source };
}

/** Ids of everything drawn from a source. */
export function membersOf(d: Diagram, id: Id): Id[] {
  return [...Object.values(d.nodes), ...Object.values(d.edges)].filter((o) => o.gen?.source === id).map((o) => o.id);
}

const nodeStyle = (n: Pick<Node, "border" | "align">) => JSON.stringify({ border: n.border, align: n.align });
const edgeStyle = (e: Pick<Edge, "line" | "arrows" | "heads">) =>
  // (Heads only when there are some, so styles recorded before heads existed still match.)
  JSON.stringify({ line: e.line, arrows: e.arrows, ...(e.heads && Object.keys(e.heads).length && { heads: e.heads }) });
/** The same connector pointing the other way (its ends' arrows and heads swapped). */
const flipEnds = <T extends Pick<Edge, "arrows" | "heads">>(e: T): T => ({
  ...e,
  arrows: { start: e.arrows.end, end: e.arrows.start },
  heads: e.heads && { ...(e.heads.end && { start: e.heads.end }), ...(e.heads.start && { end: e.heads.start }) },
});
const sameXY = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y;
const sameSize = (a: Rect, b: Rect) => a.w === b.w && a.h === b.h;

/** The rect a spec ends up with once its shape's size rules apply. */
function normalized(spec: DesiredNode["node"], rect: Rect): Rect {
  const tmp = addNode(emptyDiagram(), makeNode(rect, { ...spec, rect, id: "tmp" }));
  return tmp.nodes.tmp.rect;
}

function sync(d: Diagram, source: TextSource, relayout = false): SyncResult {
  const desired = generate(source);
  const nodes = new Map<string, Node>(), edges = new Map<string, Edge>();
  for (const n of Object.values(d.nodes)) if (n.gen?.source === source.id) nodes.set(n.gen.key, n);
  for (const e of Object.values(d.edges)) if (e.gen?.source === source.id) edges.set(e.gen.key, e);

  // Was the whole drawing dragged? Most nodes moved by the same amount since last generated.
  const deltas = new Map<string, number>();
  for (const n of nodes.values()) {
    if (!n.gen?.at || n.gen.placed) continue;
    const k = `${n.rect.x - n.gen.at.x},${n.rect.y - n.gen.at.y}`;
    deltas.set(k, (deltas.get(k) ?? 0) + 1);
  }
  const [common, votes] = [...deltas].sort((a, b) => b[1] - a[1])[0] ?? ["0,0", 0];
  const [sx, sy] = votes * 2 > nodes.size ? common.split(",").map(Number) : [0, 0];
  const origin = { x: source.origin.x + sx, y: source.origin.y + sy };

  let out = d;
  const idOf = new Map<string, Id>();
  /** Where each node was generated (before any position the user set). */
  const generatedAt = new Map<string, Rect>();
  for (const dn of desired.nodes) {
    const abs = { ...dn.node.rect, x: dn.node.rect.x + origin.x, y: dn.node.rect.y + origin.y };
    const fresh = normalized(dn.node, abs);
    generatedAt.set(dn.key, fresh);
    const style = nodeStyle(dn.node);
    const ex = nodes.get(dn.key);
    if (ex) {
      const last = ex.gen!.at ? { ...ex.gen!.at, x: ex.gen!.at.x + sx, y: ex.gen!.at.y + sy } : ex.rect;
      // A re-layout (new direction) takes every position and size from the layout.
      const placed = !relayout && !!ex.gen!.placed;
      const moved = !relayout && (placed || !sameXY(ex.rect, last));
      const resized = !relayout && !ex.autosize && (placed || !sameSize(ex.rect, last));
      const rect = {
        x: moved ? ex.rect.x : fresh.x, y: moved ? ex.rect.y : fresh.y,
        w: resized ? ex.rect.w : fresh.w, h: resized ? ex.rect.h : fresh.h,
      };
      // A size kept by hand still grows to fit longer text.
      if (resized) {
        const fit = shapeOf(ex).fitSize({ ...ex, kind: dn.node.kind, rect }, dn.node.text);
        rect.h = Math.max(rect.h, fit.h);
      }
      const restyled = ex.gen!.style !== undefined && ex.gen!.style !== nodeStyle(ex);
      out = updateNode(out, ex.id, {
        kind: dn.node.kind, text: dn.node.text, name: dn.node.name, autosize: dn.node.autosize, rect,
        ...(restyled ? {} : { border: dn.node.border, align: dn.node.align }),
        gen: { source: source.id, key: dn.key, at: fresh, style, ...(placed && { placed }) },
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
    // Messages keep their rows: on a lifeline (or bar) the user moved up or down, the offset is
    // from where it actually is, not where it was generated.
    const n = node ? out.nodes[node] : undefined;
    if (n && es.offset !== undefined && es.side !== "top" && es.side !== "bottom" && shapeOf(n).attachByRow) {
      es = { ...es, offset: es.offset + generatedAt.get(es.key)!.y - n.rect.y };
    }
    return node
      ? { kind: "attached", node, side: es.side, ...(es.offset !== undefined && { offset: es.offset }), ...(es.prefer && { prefer: es.prefer }) }
      : null;
  };
  const keptEdges = new Set<string>();
  for (const d0 of desired.edges) {
    // An existing connector between the same two nodes, the other way round (an arrow pointing
    // back, written forwards): update it as it is, rather than turning it round.
    const ex0 = edges.get(d0.key);
    const f0 = end(d0.from), t0 = end(d0.to);
    const flipped = !!ex0 && !!f0 && !!t0 && f0.kind === "attached" && t0.kind === "attached" &&
      ex0.from.kind === "attached" && ex0.to.kind === "attached" && ex0.from.node === t0.node && ex0.to.node === f0.node;
    const de = flipped ? { ...flipEnds(d0), from: d0.to, to: d0.from } : d0;
    const from = end(de.from), to = end(de.to);
    if (!from || !to) {
      warnings.push(`couldn't connect ${de.key}`);
      continue;
    }
    keptEdges.add(de.key);
    const style = edgeStyle(de);
    const ends = JSON.stringify({ from, to });
    const ex = edges.get(de.key);
    if (ex) {
      const restyled = ex.gen!.style !== undefined && ex.gen!.style !== edgeStyle(ex);
      // Ends the user placed (by hand, or dragged since) stay, while they join the same nodes.
      const sameNodes = (a: Endpoint, b: Endpoint) => a.kind === "attached" && b.kind === "attached" && a.node === b.node;
      const ownEnds = !relayout && (ex.gen!.placed || (ex.gen!.ends !== undefined && ex.gen!.ends !== JSON.stringify({ from: ex.from, to: ex.to })))
        && sameNodes(ex.from, from) && sameNodes(ex.to, to);
      out = updateEdge(out, ex.id, {
        ...(ownEnds ? {} : { from, to }), label: de.label,
        ...(restyled ? {} : { line: de.line, arrows: de.arrows, heads: de.heads }),
        gen: { source: source.id, key: de.key, style, ends, ...(!relayout && ex.gen!.placed && { placed: true }) },
      });
    } else {
      out = addEdge(out, makeEdge(from, to, { label: de.label, line: de.line, arrows: de.arrows, ...(de.heads && { heads: de.heads }), gen: { source: source.id, key: de.key, style, ends } }));
    }
  }

  // What the text no longer has.
  const wanted = new Set(desired.nodes.map((n) => n.key));
  const gone = [
    ...[...nodes.values()].filter((n) => !wanted.has(n.gen!.key)).map((n) => n.id),
    ...[...edges.values()].filter((e) => !keptEdges.has(e.gen!.key)).map((e) => e.id),
  ];
  if (gone.length) out = deleteObjects(out, gone);
  // Locks the text makes (a note to its lifeline) are redone; the user's own are left alone.
  const locks = Object.fromEntries(Object.entries(out.locks ?? {}).filter(([, l]) => l.source !== source.id));
  for (const l of desired.locks ?? []) {
    const members = l.keys.map((k) => idOf.get(k)).filter((id): id is Id => !!id && !!out.nodes[id]);
    if (members.length < 2) continue;
    const id = `l${source.id}_${members.join("_")}`.slice(0, 80);
    locks[id] = { id, members, x: l.x, y: l.y, source: source.id };
  }
  out = { ...out, locks: Object.keys(locks).length ? locks : undefined };
  out = { ...out, sources: { ...out.sources, [source.id]: { ...source, origin } } };
  return { diagram: out, warnings };
}

/** Which way a source is laid out, or null if it doesn't have a direction (sequences, tree text). */
export function directionOf(src: TextSource): "down" | "right" | null {
  if (src.kind === "graph") return src.options.direction ?? (/^\s*(flowchart|graph)\b[ \t]*(LR|RL)/im.test(src.text) ? "right" : "down");
  if (src.kind === "tree" && src.options.treeStyle === "boxes") return src.options.direction ?? "down";
  return null;
}
