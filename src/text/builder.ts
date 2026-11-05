import type { GraphEdge, GraphNode, ParsedGraph, Subgraph } from "./graph";

/**
 * Shared bookkeeping for the graph-like parsers (state, class and ER diagrams): nodes by id,
 * nesting in blocks (composite states, namespaces), and the cleanup flowcharts do too.
 */
export function graphBuilder() {
  const g: ParsedGraph = { direction: "down", nodes: [], edges: [], subgraphs: [], warnings: [] };
  const byId = new Map<string, GraphNode>();
  const stack: Subgraph[] = [];

  return {
    g,
    byId,
    /** The innermost open block, if any. */
    get current(): Subgraph | undefined {
      return stack[stack.length - 1];
    },
    /** A node, made on first mention. Mentioned inside a block, it belongs to that block. */
    node(id: string, patch: Partial<GraphNode> = {}): GraphNode {
      let n = byId.get(id);
      if (!n) {
        n = { id, text: id, kind: "box", rounded: false };
        byId.set(id, n);
        g.nodes.push(n);
      }
      const sg = stack[stack.length - 1];
      if (sg && sg.id !== id && !g.subgraphs.some((s) => s.id === id)) {
        for (const s of g.subgraphs) s.members = s.members.filter((m) => m !== id);
        sg.members.push(id);
      }
      Object.assign(n, patch);
      return n;
    },
    edge(e: GraphEdge) {
      g.edges.push(e);
    },
    /** Open a block (a group drawn as a frame around its members). */
    open(id: string, title: string) {
      const existing = g.subgraphs.find((s) => s.id === id);
      if (existing) {
        stack.push(existing);
        return existing;
      }
      const sg: Subgraph = { id, title, members: [], parent: stack[stack.length - 1]?.id ?? null };
      stack[stack.length - 1]?.members.push(id);
      stack.push(sg);
      g.subgraphs.push(sg);
      return sg;
    },
    close(): boolean {
      return !!stack.pop();
    },
    get depth() {
      return stack.length;
    },
    /** Blocks used as nodes are the block; members listed once. */
    finish(): ParsedGraph {
      const groupIds = new Set(g.subgraphs.map((s) => s.id));
      for (const s of g.subgraphs) {
        const asNode = byId.get(s.id);
        if (asNode && s.title === s.id) s.title = asNode.text;
      }
      g.nodes = g.nodes.filter((n) => !groupIds.has(n.id));
      for (const s of g.subgraphs) s.members = s.members.filter((m, i, all) => all.indexOf(m) === i);
      return g;
    },
  };
}

/** `direction LR` (inside the diagram, as state, class and ER diagrams write it). */
export function readDirection(line: string): "down" | "right" | null {
  const m = /^direction\s+(TB|TD|BT|LR|RL)\s*$/i.exec(line);
  return m ? (/LR|RL/i.test(m[1]) ? "right" : "down") : null;
}

/** A label with how many are at each end (class diagrams' "1" / "*", ER cardinalities). */
export function withEnds(label: string, from?: string, to?: string): string {
  const ends = from && to ? `${from} to ${to}` : from ? `from ${from}` : to ? `to ${to}` : "";
  if (!ends) return label;
  return label ? `${label} (${ends})` : ends;
}
