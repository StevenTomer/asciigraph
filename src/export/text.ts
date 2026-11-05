import { deleteObjects } from "../model/ops";
import type { Diagram, Id } from "../model/types";
import { rasterize } from "../render/rasterize";
import { markdownTable } from "../shapes/table";

/**
 * How exported text is wrapped: as is, in a Markdown code block, or as a comment block for
 * pasting into source code.
 */
export type Wrap =
  | { kind: "plain" }
  | { kind: "markdown" }
  | { kind: "c-line" } // // each line
  | { kind: "c-block" } // /* … * each line … */
  | { kind: "python" } // # each line
  | { kind: "bash" } // # each line
  | { kind: "custom"; first: string; prefix: string; last: string };

export const WRAPS: { kind: Wrap["kind"]; label: string; ext: string }[] = [
  { kind: "plain", label: "plain", ext: "txt" },
  { kind: "markdown", label: "Markdown", ext: "md" },
  { kind: "c-line", label: "C/C++ //", ext: "txt" },
  { kind: "c-block", label: "C/C++ /* */", ext: "txt" },
  { kind: "python", label: "Python #", ext: "py" },
  { kind: "bash", label: "Bash #", ext: "sh" },
  { kind: "custom", label: "custom", ext: "txt" },
];

export interface TextOptions {
  ascii?: boolean;
  wrap?: Wrap;
  /** Same as wrap: { kind: "markdown" } (kept for older callers). */
  markdown?: boolean;
}

/** Prefix each line, without leaving trailing spaces on lines that are empty. */
const prefixed = (lines: string[], prefix: string) => lines.map((l) => (prefix + l).replace(/\s+$/, ""));

export function wrapText(text: string, wrap: Wrap): string {
  const lines = text.split("\n");
  switch (wrap.kind) {
    case "plain": return text;
    case "markdown": return "```\n" + text + "\n```";
    case "c-line": return prefixed(lines, "// ").join("\n");
    case "c-block": return ["/*", ...prefixed(lines, " * "), " */"].join("\n");
    case "python":
    case "bash": return prefixed(lines, "# ").join("\n");
    case "custom": {
      const out = prefixed(lines, wrap.prefix);
      if (wrap.first) out.unshift(wrap.first);
      if (wrap.last) out.push(wrap.last);
      return out.join("\n");
    }
  }
}

/** The diagram as text (trimmed to what's drawn), optionally ASCII-only, wrapped as asked. */
export function exportText(d: Diagram, opts: TextOptions = {}): string {
  const text = rasterize(d).grid.toText(null, !!opts.ascii);
  return wrapText(text, opts.wrap ?? (opts.markdown ? { kind: "markdown" } : { kind: "plain" }));
}

/** Just some objects: everything else is removed (their edges' ends left free where they were). */
export function subset(d: Diagram, ids: Id[]): Diagram {
  const keep = new Set(ids);
  const drop = [...d.order, ...Object.keys(d.edges)].filter((id) => !keep.has(id));
  return deleteObjects(d, drop);
}

/** The diagram's tables as Markdown tables for a document (top to bottom, then left to right),
 * line breaks in cells as `<br>`; "" when it has none. */
export function tablesMarkdown(d: Diagram): string {
  return Object.values(d.nodes)
    .filter((n) => n.kind === "table")
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x)
    .map((n) => markdownTable(n.text))
    .filter(Boolean)
    .join("\n\n");
}
