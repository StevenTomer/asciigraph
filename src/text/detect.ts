import type { SourceKind } from "../model/types";

/**
 * What kind of diagram some text describes. Mermaid headers decide outright; otherwise, tree
 * drawings or paths mean a folder tree, `A -> B: message` lines a sequence, and arrows without
 * messages a graph. Indented names are a tree.
 */
export function detectKind(text: string): SourceKind {
  const lines = text.split("\n").map((l) => l.replace(/%%.*$/, "")).filter((l) => l.trim());
  const first = lines[0]?.trim() ?? "";
  if (/^sequenceDiagram\b/.test(first)) return "sequence";
  if (/^(flowchart|graph)\b/i.test(first)) return "graph";
  if (lines.some((l) => /[├└]──/.test(l))) return "tree";
  const arrows = lines.filter((l) => /(-->>|->>|-{1,3}>|=>|-\.->|==>|---)/.test(l));
  if (arrows.length) {
    const messages = arrows.filter((l) => /(->>|-->>|-{1,2}>|=>)\s*[+-]?\s*[^:]+:\s*\S/.test(l));
    const sequenceWords = lines.some((l) => /^\s*(participant|actor|note\s+(left|right|over)|activate|loop|alt)\b/i.test(l));
    return sequenceWords || messages.length * 2 > arrows.length ? "sequence" : "graph";
  }
  return "tree";
}
