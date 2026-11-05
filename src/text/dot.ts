import type { Head, LineStyle, NodeKind } from "../model/types";
import { graphBuilder } from "./builder";
import type { GraphNode, ParsedGraph } from "./graph";

/**
 * Graphviz DOT: `digraph G { a -> b [label="x"]; }`.
 *
 *  - graph / digraph / strict; node and edge statements, chains (a -> b -> c), groups
 *    ({a b} -> c); `node [...]` and `edge [...]` defaults; `rankdir=LR`.
 *  - Subgraphs named cluster… are drawn as frames (their `label` the frame's name); other
 *    subgraphs just group.
 *  - Node shapes: box / rect / square → box; ellipse, oval, circle (the default) → rounded box;
 *    diamond → decision; cylinder → database; note → note; parallelogram → input/output;
 *    doublecircle → start/end; record / Mrecord → class boxes (fields as compartments);
 *    plaintext / plain / none → text.
 *  - Edges: label, taillabel / headlabel (end labels); style dashed / dotted / bold; dir
 *    (forward, back, both, none); arrowhead / arrowtail (normal, vee, empty, diamond, odiamond,
 *    dot, odot, tee, none).
 * Other attributes (colors, fonts, sizes, ports) are ignored.
 */

type Token = { t: "id" | "op"; v: string; line: number };

function tokenize(src: string, warnings: string[]): Token[] {
  const out: Token[] = [];
  let i = 0, line = 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
    } else if (/\s/.test(c)) i++;
    else if (src.startsWith("//", i) || (c === "#" && (i === 0 || src[i - 1] === "\n"))) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      line += (src.slice(i, stop).match(/\n/g) ?? []).length;
      i = stop;
    } else if (c === '"') {
      let j = i + 1, v = "";
      while (j < src.length && src[j] !== '"') {
        if (src[j] === "\\" && j + 1 < src.length) {
          const n = src[j + 1];
          v += n === "n" || n === "l" || n === "r" ? "\n" : n === '"' ? '"' : n === "\\" ? "\\" : "\\" + n;
          j += 2;
        } else {
          if (src[j] === "\n") line++;
          v += src[j++];
        }
      }
      out.push({ t: "id", v: v.replace(/\n$/, ""), line });
      i = j + 1;
    } else if (c === "<") {
      // An HTML label: its text, with <br/> as line breaks.
      let depth = 0, j = i;
      for (; j < src.length; j++) {
        if (src[j] === "<") depth++;
        else if (src[j] === ">" && --depth === 0) break;
      }
      const html = src.slice(i + 1, j);
      out.push({ t: "id", v: html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim(), line });
      i = j + 1;
    } else if (src.startsWith("->", i) || src.startsWith("--", i)) {
      out.push({ t: "op", v: src.slice(i, i + 2), line });
      i += 2;
    } else if ("{}[]=;,:".includes(c)) {
      out.push({ t: "op", v: c, line });
      i++;
    } else {
      const m = /^(-?(\.\d+|\d+(\.\d*)?)|[\p{L}_][\p{L}\p{N}_]*)/u.exec(src.slice(i));
      if (!m) {
        warnings.push(`line ${line}: couldn't read "${c}"`);
        i++;
        continue;
      }
      out.push({ t: "id", v: m[0], line });
      i += m[0].length;
    }
  }
  return out;
}

const SHAPES: Record<string, [NodeKind, Partial<GraphNode>?]> = {
  box: ["box"], rect: ["box"], rectangle: ["box"], square: ["box"], component: ["box"], folder: ["box"], tab: ["box"], box3d: ["box"],
  ellipse: ["box", { rounded: true }], oval: ["box", { rounded: true }], circle: ["box", { rounded: true }], point: ["box", { rounded: true }],
  egg: ["box", { rounded: true }], doublecircle: ["terminal"], Mcircle: ["terminal"],
  diamond: ["decision"], Mdiamond: ["decision"], hexagon: ["decision"],
  cylinder: ["database"], note: ["note"], parallelogram: ["io"], trapezium: ["io"],
  record: ["class"], Mrecord: ["class"],
  plaintext: ["box", { plain: true }], plain: ["box", { plain: true }], none: ["box", { plain: true }], underline: ["box", { plain: true }],
};

const ARROWS: Record<string, Head | null> = {
  normal: "arrow", vee: "arrow", open: "arrow", inv: "arrow", empty: "triangle", onormal: "triangle", invempty: "triangle",
  diamond: "diamond", ediamond: "hollow-diamond", odiamond: "hollow-diamond", dot: "dot", odot: "circle", invdot: "dot", invodot: "circle",
  tee: "bar", crow: "arrow", box: "diamond", obox: "hollow-diamond", none: null,
};

/** A record label's fields ({a|b|c}, ports like <p1> dropped) as class compartments. */
function recordText(label: string): string {
  return label.replace(/^\s*\{|\}\s*$/g, "").split(/(?<!\\)\|/).map((f) => f.replace(/<[^>]*>/g, "").replace(/[{}]/g, "").trim()).join("\n---\n");
}

export function parseDot(text: string): ParsedGraph {
  const b = graphBuilder();
  const { g } = b;
  const toks = tokenize(text, g.warnings);
  let i = 0;
  const peek = (o = 0) => toks[i + o];
  const isOp = (v: string, o = 0) => peek(o)?.t === "op" && peek(o)?.v === v;
  const isWord = (v: string, o = 0) => peek(o)?.t === "id" && peek(o)?.v.toLowerCase() === v;
  const take = () => toks[i++];

  // Header: [strict] (graph|digraph) [ID] {
  if (isWord("strict")) i++;
  const directed = isWord("digraph");
  if (!isWord("graph") && !directed) {
    g.warnings.push("expected graph or digraph");
    return b.finish();
  }
  i++;
  if (peek()?.t === "id") i++;
  if (!isOp("{")) {
    g.warnings.push(`line ${peek()?.line ?? 1}: expected {`);
    return b.finish();
  }
  i++;

  type Attrs = Record<string, string>;
  const attrList = (): Attrs => {
    const a: Attrs = {};
    while (isOp("[")) {
      i++;
      while (peek() && !isOp("]")) {
        const k = take();
        if (k.t !== "id") continue;
        if (isOp("=")) {
          i++;
          a[k.v] = take()?.v ?? "";
        } else a[k.v] = "true";
        if (isOp(",") || isOp(";")) i++;
      }
      i++;
    }
    return a;
  };

  const styled = (n: GraphNode, a: Attrs) => {
    const shape = a.shape;
    if (shape !== undefined) {
      const [kind, extra] = SHAPES[shape] ?? ["box"];
      Object.assign(n, { kind, rounded: false, plain: undefined }, extra);
      if (shape === "Mrecord") n.border = "rounded";
    }
    if (a.label !== undefined) n.text = a.label === "\\N" ? n.id : a.label;
    if (n.kind === "class") n.text = recordText(n.text);
  };

  /** Defaults in scope: node and edge attributes, cluster stack. */
  const scopes: { node: Attrs; edge: Attrs }[] = [{ node: {}, edge: {} }];
  const scope = () => scopes[scopes.length - 1];
  const known = new Set<string>();
  const nodeId = (): string => {
    const id = take().v;
    // A port (a:p or a:p:n) belongs to the node.
    while (isOp(":")) {
      i++;
      take();
    }
    return id;
  };
  const declare = (id: string, a: Attrs = {}) => {
    const fresh = !known.has(id);
    known.add(id);
    const n = b.node(id, fresh ? { kind: "box", rounded: true } : {});
    styled(n, fresh ? { ...scope().node, ...a } : a);
    return id;
  };

  const edgeStyle = (a: Attrs) => {
    const style = (a.style ?? "").toLowerCase();
    const line: LineStyle = /dashed/.test(style) ? "dashed" : /dotted/.test(style) ? "dotted" : /bold/.test(style) || Number(a.penwidth) >= 2 ? "heavy" : "single";
    const dir = (a.dir ?? (directed ? "forward" : "none")).toLowerCase();
    const head = (which: "arrowhead" | "arrowtail"): Head | null | undefined => (a[which] === undefined ? undefined : ARROWS[a[which].replace(/^[lr]/, "")] ?? "arrow");
    const endHead = dir === "forward" || dir === "both" ? head("arrowhead") ?? "arrow" : null;
    const startHead = dir === "back" || dir === "both" ? head("arrowtail") ?? "arrow" : null;
    return {
      line,
      arrows: { start: !!startHead, end: !!endHead },
      heads: { ...(startHead && startHead !== "arrow" && { start: startHead }), ...(endHead && endHead !== "arrow" && { end: endHead }) },
    };
  };

  /** A statement list, to its closing }; returns the node ids it mentioned. */
  const statements = (): string[] => {
    const mentioned: string[] = [];
    while (peek() && !isOp("}")) {
      if (isOp(";") || isOp(",")) {
        i++;
        continue;
      }
      const ids = operand();
      if (ids === null) continue;
      if (isOp("->") || isOp("--")) {
        // An edge chain: each step joins every node on the left to every one on the right.
        const groups: string[][] = [ids];
        while (isOp("->") || isOp("--")) {
          i++;
          const next = operand();
          if (!next) {
            g.warnings.push(`line ${peek()?.line ?? toks[toks.length - 1]?.line}: an edge with nothing after it`);
            break;
          }
          groups.push(next);
        }
        const a = { ...scope().edge, ...attrList() };
        const st = edgeStyle(a);
        const endLabels = { ...(a.taillabel && { start: a.taillabel }), ...(a.headlabel && { end: a.headlabel }) };
        for (let k = 0; k + 1 < groups.length; k++) {
          for (const from of groups[k]) for (const to of groups[k + 1]) {
            b.edge({
              from, to, label: a.label ?? a.xlabel ?? "", line: st.line, arrows: st.arrows,
              ...(Object.keys(st.heads).length && { heads: st.heads }),
              ...(Object.keys(endLabels).length && { endLabels }),
            });
          }
        }
        mentioned.push(...groups.flat());
      } else {
        // A node statement: its [attributes] are the node's.
        const a = attrList();
        if (Object.keys(a).length) for (const id of ids) declare(id, a);
        mentioned.push(...ids);
      }
    }
    if (isOp("}")) i++;
    return mentioned;
  };

  /**
   * One thing an edge can join, or a statement on its own: a node (with any [attributes]), a
   * subgraph, or an attribute statement (null).
   */
  const operand = (): string[] | null => {
    const tok = peek();
    if (!tok) return null;
    if (tok.t === "op" && tok.v === "[") {
      attrList();
      return null;
    }
    if (tok.t === "op" && tok.v !== "{") {
      g.warnings.push(`line ${tok.line}: unexpected "${tok.v}"`);
      i++;
      return null;
    }
    const word = tok.t === "id" ? tok.v.toLowerCase() : "";
    if ((word === "graph" || word === "node" || word === "edge") && isOp("[", 1)) {
      i++;
      const a = attrList();
      if (word === "node") scope().node = { ...scope().node, ...a };
      else if (word === "edge") scope().edge = { ...scope().edge, ...a };
      else graphAttrs(a);
      return null;
    }
    if (word === "subgraph" || (tok.t === "op" && tok.v === "{")) {
      let name = "";
      if (word === "subgraph") {
        i++;
        if (peek()?.t === "id") name = take().v;
      }
      if (!isOp("{")) return name ? [declare(name)] : null;
      i++;
      const cluster = /^cluster/i.test(name);
      if (cluster) b.open(name, name.replace(/^cluster_?/i, "") || name);
      scopes.push({ node: { ...scope().node }, edge: { ...scope().edge } });
      const ids = statements();
      scopes.pop();
      if (cluster) b.close();
      return [...new Set(ids)];
    }
    if (tok.t === "id" && isOp("=", 1)) {
      // A graph attribute: rankdir=LR, label="…".
      i += 2;
      graphAttrs({ [tok.v]: take()?.v ?? "" });
      return null;
    }
    // (Any [attributes] after it are the statement's: the node's, or an edge's.)
    return [declare(nodeId())];
  };

  const graphAttrs = (a: Attrs) => {
    if (a.rankdir) {
      const right = /^(LR|RL)$/i.test(a.rankdir);
      if (!b.depth) g.direction = right ? "right" : "down";
    }
    if (a.label !== undefined && b.current) b.current.title = a.label;
  };

  statements();
  if (peek()) g.warnings.push(`line ${peek()!.line}: more after the graph's closing }`);
  return b.finish();
}

/** Whether text is DOT: (strict) graph or digraph, then a {. */
export const isDot = (text: string) => /^\s*(?:(?:\/\/|#)[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*(strict\s+)?(di)?graph\b[^{\n]*\{/i.test(text);
