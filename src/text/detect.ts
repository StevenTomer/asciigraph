import type { SourceKind } from "../model/types";
import { isDot } from "./dot";

/**
 * What kind of diagram some text describes. Mermaid headers decide outright; otherwise, tree
 * drawings or paths mean a folder tree, `A -> B: message` lines a sequence, and arrows without
 * messages a graph. Indented names are a tree.
 */
export function detectKind(text: string): SourceKind {
  if (isDot(text)) return "graph";
  const lines = text.split("\n").map((l) => l.replace(/%%.*$/, "")).filter((l) => l.trim());
  const first = lines[0]?.trim() ?? "";
  if (/^sequenceDiagram\b/.test(first)) return "sequence";
  if (/^(flowchart|graph)\b/i.test(first) || /^(stateDiagram(-v2)?|classDiagram(-v2)?|erDiagram)\b/.test(first)) return "graph";
  if (lines.some((l) => /[├└]──/.test(l))) return "tree";
  // Indentation is the strongest sign of a folder tree (names may well contain "->" or "---"):
  // a good share of lines indented under the first, and nothing sequence-like.
  const indent = (l: string) => l.replace(/\t/g, "  ").match(/^ */)![0].length;
  const deeper = lines.filter((l) => indent(l) > indent(lines[0])).length;
  const sequenceWords = lines.some((l) => /^\s*(participant|actor|note\s+(left|right|over)|activate|loop|alt)\b/i.test(l));
  if (lines.length > 1 && deeper * 3 >= lines.length && !sequenceWords) return "tree";
  const arrows = lines.filter((l) => /(-->>|->>|-{1,3}>|=>|-\.->|==>|---)/.test(l));
  if (arrows.length) {
    const messages = arrows.filter((l) => /(->>|-->>|-{1,2}>|=>)\s*[+-]?\s*[^:]+:\s*\S/.test(l));
    return sequenceWords || messages.length * 2 > arrows.length ? "sequence" : "graph";
  }
  return "tree";
}
