import { type Point, bottom, contains, right } from "../geometry/geom";
import { within } from "../model/containment";
import type { Diagram, Edge, Id, Node, SourceKind, TextSource } from "../model/types";
import { resolveEdge } from "../routing/endpoints";
import { lifelineColumn } from "../shapes/lifeline";
import { inline, quote } from "./mermaid";

/**
 * Write Mermaid for part of a diagram drawn by hand, so it can be edited as text: a
 * `sequenceDiagram` if the selection has lifelines, else a `flowchart`. Each object written gets
 * the key the generator would give it (generate.ts), so redrawing from the text updates them in
 * place. Things Mermaid can't express (connectors with loose ends, connectors to unselected
 * boxes) are left out, and stay ordinary objects.
 */
export interface Described {
  kind: SourceKind;
  text: string;
  options: TextSource["options"];
  /** Object id → its key in the text. */
  keys: Map<Id, string>;
  /** Connectors written the other way round (Mermaid arrows point forward). */
  swapped: Set<Id>;
  origin: Point;
}

const RESERVED = new Set(["end", "graph", "flowchart", "subgraph", "style", "class", "classDef", "click", "linkStyle", "direction", "participant", "actor", "note", "loop", "alt", "else", "opt", "par", "and", "activate", "deactivate"]);

/** Mermaid ids made from the objects' text: letters, digits and _, unique. */
function idMaker() {
  const used = new Set<string>();
  return (text: string, fallback: string) => {
    let base = text.split("\n")[0].replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 24) || fallback;
    if (RESERVED.has(base.toLowerCase())) base = `${base}_`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    used.add(id);
    return id;
  };
}

export function describe(d: Diagram, ids: Id[]): Described | null {
  const nodes = ids.map((id) => d.nodes[id]).filter(Boolean) as Node[];
  if (!nodes.length) return null;
  return nodes.some((n) => n.kind === "lifeline") ? sequence(d, ids) : graph(d, ids);
}

// ---------------------------------------------------------------------------------------------
// Flowcharts
// ---------------------------------------------------------------------------------------------

/** A label inside @{ … }: quoted, with Mermaid's <br> and #quot;. */
const attr = (text: string) => `"${text.replace(/"/g, "#quot;").replace(/\n/g, "<br>")}"`;

function shapeText(n: Node, id: string, indent: string): string {
  const q = quote(n.text || id, indent + "  ");
  if (n.kind === "box" && n.border === "none") return `${id}@{ shape: text, label: ${attr(n.text)} }`;
  switch (n.kind) {
    case "decision": return `${id}{${q}}`;
    case "io": return `${id}[/${q}/]`;
    case "terminal": return `${id}([${q}])`;
    case "database": return `${id}[(${q})]`;
    case "subroutine": return `${id}[[${q}]]`;
    case "document": return `${id}@{ shape: doc, label: ${attr(n.text)} }`;
    case "note": return `${id}@{ shape: comment, label: ${attr(n.text)} }`;
    // Not a Mermaid flowchart shape: asciigraph's own, so a class box stays one.
    case "class": return `${id}@{ shape: class, label: ${attr(n.text)} }`;
    default: return n.border === "rounded" ? `${id}(${q})` : `${id}[${q}]`;
  }
}

/** Mermaid's connector for a line style and arrowheads (both, forward, or none). */
const ARROWS: Record<"plain" | "heavy" | "dotted", { both: string; end: string; none: string }> = {
  plain: { both: "<-->", end: "-->", none: "---" },
  heavy: { both: "<==>", end: "==>", none: "===" },
  dotted: { both: "<-->", end: "-.->", none: "-.-" },
};

function arrow(e: Edge, swap: boolean): string {
  const start = swap ? e.arrows.end : e.arrows.start, end = swap ? e.arrows.start : e.arrows.end;
  const set = ARROWS[e.line === "heavy" ? "heavy" : e.line === "dotted" || e.line === "dashed" ? "dotted" : "plain"];
  if (start && end) return set.both;
  if (!end) return set.none;
  // Mermaid's other ends: --x (cross) and --o (circle), on plain lines. (Others stay as styling.)
  const head = e.heads?.[swap ? "start" : "end"];
  if (set === ARROWS.plain && (head === "cross" || head === "circle")) return head === "cross" ? "--x" : "--o";
  return set.end;
}

function graph(d: Diagram, ids: Id[]): Described {
  const selected = new Set(ids);
  const nodes = ids.map((id) => d.nodes[id]).filter((n): n is Node => !!n && n.kind !== "lifeline" && n.kind !== "activation");
  const frames = nodes.filter((n) => n.kind === "frame");
  const boxes = nodes.filter((n) => n.kind !== "frame").sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const makeId = idMaker();
  const mid = new Map<Id, string>();
  for (const n of boxes) mid.set(n.id, makeId(n.text, "n"));
  for (const f of frames) mid.set(f.id, makeId(f.name ?? "group", "group"));
  const keys = new Map<Id, string>();
  for (const n of boxes) keys.set(n.id, `n:${mid.get(n.id)}`);
  for (const f of frames) keys.set(f.id, `g:${mid.get(f.id)}`);

  // Which frame each box (or frame) is directly inside.
  const parent = new Map<Id, Id>();
  for (const n of [...boxes, ...frames]) {
    const around = frames.filter((f) => f.id !== n.id && within(n.rect, f.rect)).sort((a, b) => a.rect.w * a.rect.h - b.rect.w * b.rect.h)[0];
    if (around) parent.set(n.id, around.id);
  }

  // Direction: mostly side to side, or up and down?
  let dx = 0, dy = 0;
  const edges: Edge[] = [];
  for (const e of Object.values(d.edges)) {
    if (!selected.has(e.id) || e.from.kind !== "attached" || e.to.kind !== "attached") continue;
    if (!mid.has(e.from.node) || !mid.has(e.to.node)) continue;
    edges.push(e);
    const a = d.nodes[e.from.node].rect, b = d.nodes[e.to.node].rect;
    dx += Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
    dy += Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) * 2;
  }
  const direction = dx > dy ? "right" : "down";

  const lines = [`flowchart ${direction === "right" ? "LR" : "TD"}`];
  const write = (owner: Id | undefined, indent: string) => {
    for (const n of boxes) if (parent.get(n.id) === owner) lines.push(indent + shapeText(n, mid.get(n.id)!, indent));
    for (const f of frames) {
      if (parent.get(f.id) !== owner) continue;
      lines.push(`${indent}subgraph ${mid.get(f.id)} [${quote(f.name ?? mid.get(f.id)!)}]`);
      write(f.id, indent + "  ");
      lines.push(`${indent}end`);
    }
  };
  write(undefined, "  ");
  const pairCount = new Map<string, number>();
  const swapped = new Set<Id>();
  for (const e of edges) {
    // Mermaid writes arrows pointing forward: one pointing back is written the other way round.
    const swap = e.arrows.start && !e.arrows.end;
    if (swap) swapped.add(e.id);
    const [a, b] = swap ? [mid.get((e.to as { node: Id }).node)!, mid.get((e.from as { node: Id }).node)!] : [mid.get((e.from as { node: Id }).node)!, mid.get((e.to as { node: Id }).node)!];
    const pair = `${a}>${b}`;
    const n = (pairCount.get(pair) ?? 0) + 1;
    pairCount.set(pair, n);
    keys.set(e.id, `e:${pair}#${n}`);
    const text = e.label && inline(e.label);
    const label = text ? `|${/[|"]/.test(text) ? `"${text.replace(/"/g, "#quot;")}"` : text}|` : "";
    lines.push(`  ${a} ${arrow(e, swap)}${label} ${b}`);
  }
  const all = [...boxes, ...frames];
  return {
    kind: "graph", text: lines.join("\n"), options: { direction }, keys, swapped,
    origin: { x: Math.min(...all.map((n) => n.rect.x)), y: Math.min(...all.map((n) => n.rect.y)) },
  };
}

// ---------------------------------------------------------------------------------------------
// Sequence diagrams
// ---------------------------------------------------------------------------------------------

function sequence(d: Diagram, ids: Id[]): Described {
  const selected = new Set(ids);
  const picked = ids.map((id) => d.nodes[id]).filter(Boolean) as Node[];
  const lifelines = picked.filter((n) => n.kind === "lifeline").sort((a, b) => a.rect.x - b.rect.x);
  const columnOf = new Map(lifelines.map((l) => [l.id, lifelineColumn(l.rect)]));
  const makeId = idMaker();
  const pid = new Map(lifelines.map((l) => [l.id, makeId(l.text, "P")]));
  const keys = new Map<Id, string>();
  for (const l of lifelines) keys.set(l.id, `p:${pid.get(l.id)}`);

  // Activation bars on the selected lifelines (selected or not: they belong to them).
  const owner = (n: Node): Node | undefined =>
    lifelines.find((l) => n.rect.x + 1 === columnOf.get(l.id) && n.rect.y >= l.rect.y && n.rect.y <= bottom(l.rect));
  const bars = Object.values(d.nodes).filter((n) => n.kind === "activation" && owner(n)).sort((a, b) => a.rect.y - b.rect.y);
  const barCount = new Map<Id, number>();
  for (const b of bars) {
    const l = owner(b)!;
    const n = (barCount.get(l.id) ?? 0) + 1;
    barCount.set(l.id, n);
    keys.set(b.id, `a:${pid.get(l.id)}#${n}`);
  }
  const participantOf = (nodeId: Id): string | undefined => {
    const n = d.nodes[nodeId];
    if (!n) return undefined;
    if (n.kind === "lifeline") return pid.get(n.id);
    if (n.kind === "activation") {
      const l = owner(n);
      return l && pid.get(l.id);
    }
    return undefined;
  };

  // Events, each at a row, written in row order.
  type Ev = { row: number; order: number; text: string; key?: [Id, string] };
  const events: Ev[] = [];
  for (const e of Object.values(d.edges)) {
    if (!selected.has(e.id) || e.from.kind !== "attached" || e.to.kind !== "attached") continue;
    const a = participantOf(e.from.node), b = participantOf(e.to.node);
    if (!a || !b) continue;
    const row = resolveEdge(d, e).from.cell.y;
    const head = e.arrows.end ? e.heads?.end ?? "arrow" : null;
    const tip = head === "cross" ? "x" : head === "triangle" ? ")" : head ? ">>" : ">";
    const op = (e.line === "dashed" || e.line === "dotted" ? "--" : "-") + tip;
    events.push({ row, order: 3, text: `${a}${op}${b}: ${inline(e.label ?? "")}`.trimEnd(), key: [e.id, `${a}>${b}`] });
  }
  for (const b of bars) {
    const who = pid.get(owner(b)!.id)!;
    events.push({ row: b.rect.y + 1, order: 2, text: `activate ${who}` });
    events.push({ row: bottom(b.rect) - 1, order: 5, text: `deactivate ${who}` });
  }
  const notes = picked.filter((n) => n.kind === "note");
  for (const n of notes) {
    const over = lifelines.filter((l) => columnOf.get(l.id)! >= n.rect.x && columnOf.get(l.id)! <= right(n.rect));
    let where: string;
    if (over.length) where = `over ${over.map((l) => pid.get(l.id)).join(",")}`;
    else {
      // Beside the nearest lifeline: right of one on its left, or left of one on its right.
      const left = [...lifelines].reverse().find((l) => columnOf.get(l.id)! < n.rect.x);
      const rightOf = lifelines.find((l) => columnOf.get(l.id)! > right(n.rect));
      where = left ? `right of ${pid.get(left.id)}` : rightOf ? `left of ${pid.get(rightOf.id)}` : `right of ${pid.get(lifelines[0].id)}`;
    }
    events.push({ row: n.rect.y, order: 4, text: `Note ${where}: ${inline(n.text)}`, key: [n.id, "note"] });
  }
  const frames = picked.filter((n) => n.kind === "frame");
  for (const f of frames) {
    const name = (f.name ?? "opt").trim();
    const head = /^(loop|alt|opt|par|critical|break)\b/i.test(name) ? name : `opt ${name}`;
    events.push({ row: f.rect.y, order: 0, text: head, key: [f.id, "frame"] });
    events.push({ row: bottom(f.rect), order: 6, text: "end" });
    // else / and dividers inside it.
    for (const n of Object.values(d.nodes)) {
      const m = n.border === "none" && contains(f.rect, { x: n.rect.x, y: n.rect.y }) && /^┄ \[(.*)\]/.exec(n.text);
      if (m) events.push({ row: n.rect.y, order: 1, text: m[1], key: [n.id, `else:${f.id}`] });
    }
  }
  events.sort((a, b) => a.row - b.row || a.order - b.order);

  // Keys in the order the generator assigns them.
  const pairCount = new Map<string, number>();
  let noteCount = 0, frameCount = 0;
  const frameIndex = new Map<Id, number>(), elseCount = new Map<Id, number>();
  for (const ev of events) {
    if (!ev.key) continue;
    const [id, kind] = ev.key;
    if (kind === "note") keys.set(id, `n:${noteCount++}`);
    else if (kind === "frame") {
      frameIndex.set(id, frameCount);
      keys.set(id, `f:${frameCount++}`);
    } else if (kind.startsWith("else:")) {
      const f = kind.slice(5);
      const j = elseCount.get(f) ?? 0;
      elseCount.set(f, j + 1);
      keys.set(id, `f:${frameIndex.get(f)}:else${j}`);
    } else {
      const n = (pairCount.get(kind) ?? 0) + 1;
      pairCount.set(kind, n);
      keys.set(id, `m:${kind}#${n}`);
    }
  }

  const lines = ["sequenceDiagram"];
  for (const l of lifelines) {
    const id = pid.get(l.id)!;
    lines.push(id === l.text ? `  participant ${id}` : `  participant ${id} as ${inline(l.text)}`);
  }
  let depth = 1;
  for (const ev of events) {
    if (ev.text === "end") depth--;
    const isElse = ev.key?.[1].startsWith("else:");
    lines.push("  ".repeat(Math.max(1, isElse ? depth - 1 : depth)) + ev.text);
    if (ev.key?.[1] === "frame") depth++;
  }
  const all = [...lifelines, ...bars, ...notes, ...frames];
  return {
    kind: "sequence", text: lines.join("\n"), options: {}, keys, swapped: new Set(),
    origin: { x: Math.min(...all.map((n) => n.rect.x)), y: Math.min(...all.map((n) => n.rect.y)) },
  };
}
