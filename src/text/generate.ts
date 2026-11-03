import type { Point, Rect, Side } from "../geometry/geom";
import { autoLayout } from "../model/layout";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode } from "../model/ops";
import type { Diagram, LineStyle, Node, SourceKind, TextSource } from "../model/types";
import { chars, textLines } from "../render/textLayout";
import { lifelineColumn } from "../shapes/lifeline";
import { detectKind } from "./detect";
import { type ParsedGraph, parseGraph } from "./graph";
import { type ParsedSequence, parseSequence } from "./sequence";
import { type TreeEntry, parseTree, treeText } from "./tree";

/**
 * Turn a text source into the nodes and connectors it should draw, each with a stable key (so a
 * redraw can match them to what's already there; see sync.ts) and a position relative to the
 * source's origin.
 */

export type NodeSpec = Omit<Node, "id" | "gen">;

export interface DesiredNode {
  key: string;
  node: NodeSpec;
}

export type EndSpec = { key: string; side: Side | "auto"; offset?: number } | { at: Point };

export interface DesiredEdge {
  key: string;
  from: EndSpec;
  to: EndSpec;
  label?: string;
  line: LineStyle;
  arrows: { start: boolean; end: boolean };
}

export interface Desired {
  kind: SourceKind;
  nodes: DesiredNode[];
  edges: DesiredEdge[];
  warnings: string[];
}

const spec = (rect: Rect, patch: Partial<NodeSpec> = {}): NodeSpec => ({
  kind: "box", rect, border: "single", text: "", align: { h: "center", v: "middle" }, ...patch,
});

const width = (text: string) => Math.max(0, ...text.split("\n").map((l) => chars(l).length));
const height = (text: string) => text.split("\n").length;

export function generate(source: Pick<TextSource, "kind" | "text" | "options">): Desired {
  const kind = source.kind;
  const out =
    kind === "sequence" ? sequence(parseSequence(source.text))
    : kind === "graph" ? graph(parseGraph(source.text), source.options.direction)
    : tree(parseTree(source.text).roots, source.options.treeStyle ?? "text", source.options.direction ?? "down");
  return normalize({ kind, ...out });
}

export { detectKind };

/** Shift everything so the top-left is (0, 0). */
function normalize(d: Desired): Desired {
  if (!d.nodes.length) return d;
  const dx = -Math.min(...d.nodes.map((n) => n.node.rect.x));
  const dy = -Math.min(...d.nodes.map((n) => n.node.rect.y));
  const shift = (r: Rect) => ({ ...r, x: r.x + dx, y: r.y + dy });
  return {
    ...d,
    nodes: d.nodes.map((n) => ({ ...n, node: { ...n.node, rect: shift(n.node.rect) } })),
    edges: d.edges.map((e) => ({
      ...e,
      from: "at" in e.from ? { at: { x: e.from.at.x + dx, y: e.from.at.y + dy } } : e.from,
      to: "at" in e.to ? { at: { x: e.to.at.x + dx, y: e.to.at.y + dy } } : e.to,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Sequence diagrams
// ---------------------------------------------------------------------------------------------

/** Lifeline headers take rows 0–2; the first message goes two rows below. */
const FIRST_ROW = 5;

function sequence(s: ParsedSequence): Omit<Desired, "kind"> {
  const P = s.participants;
  const index = new Map(P.map((p, i) => [p.key, i]));
  const pw = P.map((p) => Math.max(width(p.label) + 4, 10));

  // 1. Rows: walk the events, giving each a row (and collecting what needs columns).
  type Msg = { from: number; to: number; row: number; label: string; dashed: boolean; arrow: boolean; n: number };
  type Note = { side: "left" | "right" | "over"; who: number[]; text: string; row: number; w: number; h: number };
  type Frame = { label: string; top: number; bottom: number; parts: Set<number>; elses: { label: string; row: number }[] };
  const msgs: Msg[] = [], notes: Note[] = [], frames: Frame[] = [];
  const open: Frame[] = [];
  const active = P.map(() => [] as number[]); // stack of start rows per participant
  const bars: { who: number; top: number; bottom: number }[] = [];
  let row = FIRST_ROW, count = 0, lastRow = FIRST_ROW;
  const touch = (...who: number[]) => open.forEach((f) => who.forEach((w) => f.parts.add(w)));
  const start = (who: number, at: number) => active[who].push(at);
  const stop = (who: number, at: number) => {
    const top = active[who].pop();
    if (top !== undefined) bars.push({ who, top, bottom: Math.max(at, top + 1) });
  };
  let prevMsgRow = row;

  for (const e of s.events) {
    if (e.type === "message") {
      const from = index.get(e.from)!, to = index.get(e.to)!;
      count++;
      const label = s.autonumber ? `${count}. ${e.label}`.trim() : e.label;
      // A label of several lines is centred on the arrow: leave room above and below it.
      const extra = label.split("\n").length - 1;
      row += Math.floor(extra / 2);
      msgs.push({ from, to, row, label, dashed: e.dashed, arrow: e.arrow, n: count });
      touch(from, to);
      if (e.activate) start(to, row);
      if (e.deactivate) stop(from, row);
      prevMsgRow = row;
      lastRow = row + (from === to ? 2 : 0) + Math.ceil(extra / 2);
      row += (from === to ? 4 : 2) + Math.ceil(extra / 2);
    } else if (e.type === "note") {
      const who = e.who.map((k) => index.get(k)!);
      const w = Math.min(Math.max(width(e.text) + 5, 10), 36);
      const h = textLines(e.text, w - 5).length + 2;
      notes.push({ side: e.side, who, text: e.text, row, w, h });
      touch(...who);
      lastRow = row + h - 1;
      row += h + 1;
    } else if (e.type === "activate") {
      start(index.get(e.who)!, prevMsgRow);
    } else if (e.type === "deactivate") {
      stop(index.get(e.who)!, prevMsgRow);
    } else if (e.type === "frame") {
      // The frame's top border gets a row of its own, clear of anything just above.
      const f: Frame = { label: [e.kind, e.label].filter(Boolean).join(" "), top: row, bottom: row, parts: new Set(), elses: [] };
      open.push(f);
      frames.push(f);
      row += 2;
    } else if (e.type === "else") {
      const f = open[open.length - 1];
      if (f) {
        f.elses.push({ label: e.label, row });
        row += 2;
      }
    } else {
      const f = open.pop();
      if (f) {
        f.bottom = row - 1;
        lastRow = f.bottom;
        row += 2;
      }
    }
  }
  active.forEach((stack, who) => {
    while (stack.length) bars.push({ who, top: stack.pop()!, bottom: Math.max(lastRow, row - 2) });
  });
  const bottom = Math.max(lastRow, row - 2) + 2;

  // 2. Columns: lifelines spaced so labels, self-messages and notes fit between them.
  const half = (i: number) => Math.floor((pw[i] - 1) / 2);
  const centres = P.map(() => 0);
  const need: [number, number, number][] = []; // [left, right, minimum distance]
  for (let i = 0; i + 1 < P.length; i++) need.push([i, i + 1, half(i) + (pw[i + 1] - half(i + 1)) + 3]);
  for (const m of msgs) {
    if (m.from !== m.to) need.push([Math.min(m.from, m.to), Math.max(m.from, m.to), width(m.label) + 8]);
    else if (m.from + 1 < P.length) need.push([m.from, m.from + 1, width(m.label) + 7]);
  }
  for (const n of notes) {
    const i = n.who[0];
    if (n.side === "right" && i + 1 < P.length) need.push([i, i + 1, n.w + 4]);
    if (n.side === "left" && i > 0) need.push([i - 1, i, n.w + 4]);
    if (n.side === "over" && n.who.length === 1) {
      if (i + 1 < P.length) need.push([i, i + 1, Math.ceil(n.w / 2) + half(i + 1) + 2]);
      if (i > 0) need.push([i - 1, i, Math.ceil(n.w / 2) + half(i - 1) + 2]);
    }
  }
  centres[0] = half(0);
  for (let i = 1; i < P.length; i++) centres[i] = centres[i - 1];
  for (let pass = 0; pass < 3; pass++) {
    for (const [a, b, dist] of need.sort((p, q) => p[1] - q[1] || p[0] - q[0])) {
      const gap = centres[b] - centres[a];
      if (gap < dist) for (let k = b; k < P.length; k++) centres[k] += dist - gap;
    }
  }

  // 3. Nodes.
  const nodes: DesiredNode[] = [];
  const lifelineRect = (i: number): Rect => ({ x: centres[i] - half(i), y: 0, w: pw[i], h: bottom + 1 });
  P.forEach((p, i) => nodes.push({ key: `p:${p.key}`, node: spec(lifelineRect(i), { kind: "lifeline", text: p.label }) }));
  const barCount = P.map(() => 0);
  const barKeys = bars.map((b) => `a:${P[b.who].key}#${++barCount[b.who]}`);
  bars.forEach((b, k) => {
    const x = lifelineColumn(lifelineRect(b.who)) - 1;
    nodes.push({ key: barKeys[k], node: spec({ x, y: b.top - 1, w: 3, h: b.bottom - b.top + 3 }, { kind: "activation" }) });
  });
  notes.forEach((n, k) => {
    const c = n.who.map((w) => centres[w]);
    const x =
      n.side === "right" ? c[0] + 2
      : n.side === "left" ? c[0] - 2 - n.w + 1
      : n.who.length > 1 ? Math.min(...c) - 3
      : c[0] - Math.floor(n.w / 2);
    const w = n.side === "over" && n.who.length > 1 ? Math.max(...c) - Math.min(...c) + 7 : n.w;
    nodes.push({ key: `n:${k}`, node: spec({ x, y: n.row, w, h: n.h }, { kind: "note", text: n.text, align: { h: "left", v: "top" } }) });
  });
  frames.forEach((f, k) => {
    const parts = f.parts.size ? [...f.parts] : P.map((_, i) => i);
    const lo = Math.min(...parts), hi = Math.max(...parts);
    const x0 = centres[lo] - Math.max(half(lo) + 1, 4);
    const x1 = centres[hi] + Math.max(pw[hi] - half(hi), 5) + (msgs.some((m) => m.from === hi && m.to === hi) ? 4 : 0);
    nodes.push({ key: `f:${k}`, node: spec({ x: x0, y: f.top, w: x1 - x0 + 1, h: f.bottom - f.top + 1 }, { kind: "frame", name: f.label }) });
    // An else / and: a dashed divider across the frame, with its label.
    const inner = x1 - x0 - 1;
    f.elses.forEach((e, j) => {
      const head = `┄ [${e.label}] `;
      const text = head + "┄".repeat(Math.max(0, inner - chars(head).length));
      nodes.push({
        key: `f:${k}:else${j}`,
        node: spec({ x: x0 + 1, y: e.row, w: inner, h: 1 }, { border: "none", text, align: { h: "left", v: "top" } }),
      });
    });
  });

  // 4. Messages: attached by row to the activation bar covering it, else the lifeline.
  const holder = (who: number, r: number): { key: string; y: number } => {
    let best = -1;
    bars.forEach((b, k) => {
      if (b.who === who && r >= b.top && r <= b.bottom) best = k;
    });
    return best >= 0 ? { key: barKeys[best], y: bars[best].top - 1 } : { key: `p:${P[who].key}`, y: 0 };
  };
  const pairCount = new Map<string, number>();
  const edges: DesiredEdge[] = msgs.map((m) => {
    const pair = `${P[m.from].key}>${P[m.to].key}`;
    const n = (pairCount.get(pair) ?? 0) + 1;
    pairCount.set(pair, n);
    const a = holder(m.from, m.row);
    const self = m.from === m.to;
    const b = holder(m.to, self ? m.row + 2 : m.row);
    return {
      key: `m:${pair}#${n}`,
      from: { key: a.key, side: self ? "right" : "auto", offset: m.row - a.y },
      to: { key: b.key, side: self ? "right" : "auto", offset: (self ? m.row + 2 : m.row) - b.y },
      label: m.label || undefined,
      line: m.dashed ? "dashed" : "single",
      arrows: { start: false, end: m.arrow },
    };
  });
  return { nodes, edges, warnings: s.warnings };
}

// ---------------------------------------------------------------------------------------------
// Graphs
// ---------------------------------------------------------------------------------------------

function nodeSize(kind: Node["kind"], text: string, plain?: boolean): { w: number; h: number } {
  // Measured as drawn (Markdown lists render with their bullets and numbers).
  const shown = textLines(text, 1000);
  const tw = Math.max(1, ...shown.map((l) => chars(l).length)), lines = shown.length;
  if (plain) return { w: tw, h: lines };
  switch (kind) {
    case "decision": {
      const h = lines + 2 + ((lines + 2) % 2 === 0 ? 1 : 0);
      return { w: tw + 2 * Math.floor(h / 2) + 4, h };
    }
    case "io": return { w: tw + 2 * (lines + 2) + 2, h: lines + 2 };
    case "database": return { w: tw + 4, h: lines + 3 };
    case "document": return { w: tw + 4, h: lines + 3 };
    case "note": return { w: tw + 5, h: lines + 2 };
    case "subroutine": return { w: tw + 8, h: lines + 2 };
    default: return { w: tw + 4, h: lines + 2 };
  }
}

const PAD = 2;

function graph(g: ParsedGraph, direction?: "down" | "right"): Omit<Desired, "kind"> {
  const dir = direction ?? g.direction;
  const sizes = new Map(g.nodes.map((n) => [n.id, nodeSize(n.kind, n.text, n.plain)]));
  const subs = new Map(g.subgraphs.map((s) => [s.id, s]));
  const parentOf = new Map<string, string>();
  for (const s of g.subgraphs) for (const m of s.members) parentOf.set(m, s.id);
  /** The member of `group` (a node or nested subgraph) that contains `id`, if any. */
  const memberFor = (id: string, members: Set<string>): string | null => {
    for (let cur: string | undefined = id; cur !== undefined; cur = parentOf.get(cur)) if (members.has(cur)) return cur;
    return null;
  };

  // Lay out a group of members (nodes and subgraphs), inside out: each subgraph is first laid out
  // on its own, then placed in its parent as one block.
  const rects = new Map<string, Rect>();
  const place = (members: string[]): { w: number; h: number } => {
    const memberSet = new Set(members);
    let scratch: Diagram = emptyDiagram();
    members.forEach((id, i) => {
      let size = sizes.get(id);
      if (subs.has(id)) {
        const inner = place(subs.get(id)!.members);
        size = { w: Math.max(inner.w + 2 * PAD + 2, chars(subs.get(id)!.title).length + 8), h: inner.h + 2 * PAD + 1 };
        sizes.set(id, size);
      }
      // Start in a row, so nothing is inside anything else before layout.
      scratch = addNode(scratch, makeNode({ x: i * 1000, y: 0, ...size! }, { id }));
    });
    const seen = new Set<string>();
    for (const e of g.edges) {
      const a = memberFor(e.from, memberSet), b = memberFor(e.to, memberSet);
      if (!a || !b || a === b || seen.has(`${a}>${b}`)) continue;
      seen.add(`${a}>${b}`);
      scratch = addEdge(scratch, makeEdge({ kind: "attached", node: a, side: "auto" }, { kind: "attached", node: b, side: "auto" }));
    }
    scratch = autoLayout(scratch, [], dir);
    const bounds = members.map((id) => scratch.nodes[id].rect);
    const x0 = Math.min(...bounds.map((r) => r.x)), y0 = Math.min(...bounds.map((r) => r.y));
    for (const id of members) {
      const r = scratch.nodes[id].rect;
      rects.set(id, { ...r, x: r.x - x0, y: r.y - y0 });
    }
    return {
      w: Math.max(...bounds.map((r) => r.x + r.w)) - x0,
      h: Math.max(...bounds.map((r) => r.y + r.h)) - y0,
    };
  };
  const top = [...g.nodes.map((n) => n.id), ...g.subgraphs.map((s) => s.id)].filter((id) => !parentOf.has(id));
  if (top.length) place(top);
  // Member rects are relative to their subgraph's inside: make them absolute, outermost first.
  const absolute = new Map<string, Rect>();
  const resolve = (id: string, ox: number, oy: number) => {
    const r = rects.get(id)!;
    const abs = { ...r, x: r.x + ox, y: r.y + oy };
    absolute.set(id, abs);
    const s = subs.get(id);
    if (s) for (const m of s.members) resolve(m, abs.x + PAD + 1, abs.y + PAD + 1);
  };
  for (const id of top) resolve(id, 0, 0);

  const nodes: DesiredNode[] = [
    ...g.subgraphs.map((s) => ({ key: `g:${s.id}`, node: spec(absolute.get(s.id)!, { kind: "frame", name: s.title }) })),
    ...g.nodes.map((n) => ({
      key: `n:${n.id}`,
      node: n.plain
        ? spec(absolute.get(n.id)!, { text: n.text, border: "none", align: { h: "left", v: "top" } })
        : spec(absolute.get(n.id)!, { kind: n.kind, text: n.text, border: n.rounded ? "rounded" : "single" }),
    })),
  ];
  const keyOf = (id: string) => (subs.has(id) ? `g:${id}` : `n:${id}`);
  const pairCount = new Map<string, number>();
  const edges: DesiredEdge[] = g.edges.map((e) => {
    const pair = `${e.from}>${e.to}`;
    const n = (pairCount.get(pair) ?? 0) + 1;
    pairCount.set(pair, n);
    return {
      key: `e:${pair}#${n}`,
      from: { key: keyOf(e.from), side: "auto" },
      to: { key: keyOf(e.to), side: "auto" },
      label: e.label || undefined,
      line: e.line,
      arrows: e.arrows,
    };
  });
  return { nodes, edges, warnings: g.warnings };
}

// ---------------------------------------------------------------------------------------------
// Folder trees
// ---------------------------------------------------------------------------------------------

function tree(roots: TreeEntry[], style: "text" | "boxes", direction: "down" | "right"): Omit<Desired, "kind"> {
  if (!roots.length) return { nodes: [], edges: [], warnings: ["nothing to draw"] };
  if (style === "text") {
    const text = treeText(roots);
    return {
      nodes: [{
        key: "tree",
        node: spec({ x: 0, y: 0, w: width(text), h: height(text) }, { border: "none", autosize: true, text, align: { h: "left", v: "top" } }),
      }],
      edges: [],
      warnings: [],
    };
  }
  const all: TreeEntry[] = [];
  const walk = (e: TreeEntry) => {
    all.push(e);
    e.children.forEach(walk);
  };
  roots.forEach(walk);
  let scratch: Diagram = emptyDiagram();
  const label = (e: TreeEntry) => e.name + (e.dir && e.name !== "." ? "/" : "");
  all.forEach((e, i) => {
    scratch = addNode(scratch, makeNode({ x: i * 1000, y: 0, w: width(label(e)) + 4, h: 3 }, { id: e.path }));
  });
  const edges: DesiredEdge[] = [];
  for (const e of all) {
    for (const c of e.children) {
      scratch = addEdge(scratch, makeEdge({ kind: "attached", node: e.path, side: "auto" }, { kind: "attached", node: c.path, side: "auto" }));
      // From the middle of the parent's bottom (or right side), so children branch off one trunk.
      const down = direction === "down";
      edges.push({
        key: `t:${e.path}>${c.path}`,
        from: { key: `t:${e.path}`, side: down ? "bottom" : "right", offset: down ? Math.floor((width(label(e)) + 4 - 1) / 2) : 1 },
        to: { key: `t:${c.path}`, side: down ? "top" : "left" },
        line: "single", arrows: { start: false, end: false },
      });
    }
  }
  scratch = autoLayout(scratch, [], direction);
  return {
    nodes: all.map((e) => ({ key: `t:${e.path}`, node: spec(scratch.nodes[e.path].rect, { text: label(e) }) })),
    edges,
    warnings: [],
  };
}
