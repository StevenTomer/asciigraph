import type { LineStyle, NodeKind } from "../model/types";

/**
 * Graphs from text: Mermaid flowcharts (`flowchart TD`, `graph LR`) and a looser shorthand
 * (`A -> B -> C`, `A -> B: label`).
 *
 * Mermaid node shapes: A[box] A(rounded) A([start/end]) A((circle)) A{decision} A[/in-out/]
 * A[(database)] A[[subroutine]] A>flag]. Edges: --> --- -.-> -.- ==> === <--> --x --o, labels as
 * -->|label| or -- label -->, chains A --> B --> C, groups A & B --> C. `subgraph id [title] … end`
 * groups nodes. classDef / style / class / click / linkStyle lines and %% comments are ignored.
 */

export interface GraphNode {
  id: string;
  text: string;
  kind: NodeKind;
  rounded: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
  line: LineStyle;
  arrows: { start: boolean; end: boolean };
}

export interface Subgraph {
  id: string;
  title: string;
  members: string[];
  parent: string | null;
}

export interface ParsedGraph {
  direction: "down" | "right";
  nodes: GraphNode[];
  edges: GraphEdge[];
  subgraphs: Subgraph[];
  warnings: string[];
}

/** Node ids: letters, digits and underscores (a "-" would be ambiguous next to arrows). */
const ID = /^[\p{L}\p{N}_]+/u;

// Shapes, most specific first: [opening, closing, kind, rounded].
const SHAPES: [string, string, NodeKind, boolean][] = [
  ["([", "])", "terminal", false],
  ["[(", ")]", "database", false],
  ["[[", "]]", "subroutine", false],
  ["((", "))", "terminal", false],
  ["[/", "/]", "io", false],
  ["[\\", "\\]", "io", false],
  ["[/", "\\]", "io", false],
  ["[", "]", "box", false],
  ["(", ")", "box", true],
  ["{{", "}}", "decision", false],
  ["{", "}", "decision", false],
  [">", "]", "box", false],
];

// Edge operators, with their style. Labelled forms are handled separately.
const EDGES: [RegExp, LineStyle, boolean, boolean][] = [
  [/^<-->/, "single", true, true],
  [/^<==>/, "heavy", true, true],
  [/^-{2,}>/, "single", false, true],
  [/^-{2,}[xo]/, "single", false, true],
  [/^-{3,}/, "single", false, false],
  [/^-\.+->/, "dotted", false, true],
  [/^-\.+-/, "dotted", false, false],
  [/^={2,}>/, "heavy", false, true],
  [/^={3,}/, "heavy", false, false],
  // Shorthand.
  [/^->/, "single", false, true],
  [/^=>/, "heavy", false, true],
  [/^--(?=\s)/, "single", false, false],
];

export function parseGraph(text: string): ParsedGraph {
  const g: ParsedGraph = { direction: "down", nodes: [], edges: [], subgraphs: [], warnings: [] };
  const byId = new Map<string, GraphNode>();
  const stack: Subgraph[] = [];

  const node = (id: string, label?: string, kind?: NodeKind, rounded = false) => {
    let n = byId.get(id);
    if (!n) {
      n = { id, text: id, kind: "box", rounded: false };
      byId.set(id, n);
      g.nodes.push(n);
    }
    // Mentioned inside a subgraph block: it belongs to that subgraph (as in Mermaid).
    const sg = stack[stack.length - 1];
    if (sg && sg.id !== id && !g.subgraphs.some((s) => s.id === id)) {
      for (const s of g.subgraphs) s.members = s.members.filter((m) => m !== id);
      sg.members.push(id);
    }
    if (label !== undefined) {
      n.text = label;
      n.kind = kind ?? "box";
      n.rounded = rounded;
    }
    return n;
  };

  text.split("\n").forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.replace(/%%.*$/, "").trim().replace(/;$/, "");
    if (!line) return;
    const header = /^(flowchart|graph)\b\s*(TD|TB|BT|LR|RL)?/i.exec(line);
    if (header) {
      g.direction = /LR|RL/i.test(header[2] ?? "") ? "right" : "down";
      return;
    }
    if (/^(classDef|class|style|click|linkStyle|direction)\b/.test(line)) return;
    const sub = /^subgraph\s+(.*)$/i.exec(line);
    if (sub) {
      const m = /^([^\s[]+)\s*\[(.*)\]\s*$/.exec(sub[1].trim());
      const id = m ? m[1] : sub[1].trim().replace(/^"|"$/g, "");
      const title = m ? unquote(m[2]) : id;
      const sg: Subgraph = { id, title, members: [], parent: stack[stack.length - 1]?.id ?? null };
      stack[stack.length - 1]?.members.push(id);
      stack.push(sg);
      g.subgraphs.push(sg);
      return;
    }
    if (/^end$/i.test(line)) {
      if (!stack.pop()) g.warnings.push(`line ${lineNo}: "end" without a subgraph`);
      return;
    }

    // A statement: group (edge group)* [: label]
    let rest = line;
    let tailLabel: string | undefined;
    const colon = /^(.*?[^:]):\s+([^>|]*)$/.exec(rest);
    if (colon && !/\[|\(|\{/.test(colon[2])) {
      rest = colon[1];
      tailLabel = colon[2].trim();
    }
    const readGroup = (): string[] | null => {
      const ids: string[] = [];
      for (;;) {
        rest = rest.trimStart();
        const m = ID.exec(rest);
        if (!m) return ids.length ? ids : null;
        const id = m[0];
        rest = rest.slice(id.length);
        let shaped = false;
        for (const [open, close, kind, rounded] of SHAPES) {
          if (!rest.startsWith(open)) continue;
          const end = rest.indexOf(close, open.length);
          if (end < 0) continue;
          node(id, unquote(rest.slice(open.length, end)), kind, rounded);
          rest = rest.slice(end + close.length);
          shaped = true;
          break;
        }
        if (!shaped) node(id);
        ids.push(id);
        rest = rest.trimStart();
        if (!rest.startsWith("&")) return ids;
        rest = rest.slice(1);
      }
    };
    const readEdge = (): Omit<GraphEdge, "from" | "to"> | null => {
      rest = rest.trimStart();
      // -- label -->, == label ==>, -. label .->
      const labelled = /^(--|==|-\.)\s*([^-=.>|][^>]*?)\s*(-->|==>|\.->|---|===|\.-)\s*/.exec(rest);
      if (labelled) {
        rest = rest.slice(labelled[0].length);
        const op = labelled[3];
        const line: LineStyle = labelled[1] === "==" ? "heavy" : labelled[1] === "-." ? "dotted" : "single";
        return { label: labelled[2].trim(), line, arrows: { start: false, end: op.endsWith(">") } };
      }
      for (const [re, line, start, end] of EDGES) {
        const m = re.exec(rest);
        if (!m) continue;
        rest = rest.slice(m[0].length).trimStart();
        let label = "";
        const pipe = /^\|([^|]*)\|\s*/.exec(rest);
        if (pipe) {
          label = unquote(pipe[1].trim());
          rest = rest.slice(pipe[0].length);
        }
        return { label, line, arrows: { start, end } };
      }
      return null;
    };

    let from = readGroup();
    if (!from) {
      g.warnings.push(`line ${lineNo}: couldn't read "${raw.trim()}"`);
      return;
    }
    const before = g.edges.length;
    for (;;) {
      const e = readEdge();
      if (!e) break;
      const to = readGroup();
      if (!to) {
        g.warnings.push(`line ${lineNo}: an arrow with nothing after it`);
        break;
      }
      for (const a of from) for (const b of to) g.edges.push({ from: a, to: b, ...e });
      from = to;
    }
    if (tailLabel !== undefined && g.edges.length > before) g.edges[g.edges.length - 1].label = tailLabel;
    if (rest.trim()) g.warnings.push(`line ${lineNo}: ignored "${rest.trim()}"`);
  });
  if (stack.length) g.warnings.push(`subgraph "${stack[stack.length - 1].title}" has no "end"`);
  // Subgraph ids used as nodes in edges are the subgraph, not a separate node.
  const groupIds = new Set(g.subgraphs.map((s) => s.id));
  g.nodes = g.nodes.filter((n) => !groupIds.has(n.id));
  for (const s of g.subgraphs) s.members = s.members.filter((m, i, all) => all.indexOf(m) === i);
  return g;
}

function unquote(s: string): string {
  return s.trim().replace(/^"(.*)"$/s, "$1").replace(/<br\s*\/?>/gi, "\n");
}
