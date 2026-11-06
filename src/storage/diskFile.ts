import { exportText } from "../export/text";
import { emptyDiagram, isDiagram } from "../model/ops";
import type { Diagram } from "../model/types";
import { importAscii, looksLikeDrawing } from "../text/ascii";
import { decodeShare, encodeShare } from "./share";

/**
 * A diagram kept in a file on disk, and read back from it:
 *
 * - `.md`: the drawing in a ```text block, followed by the diagram itself in a comment Markdown
 *   doesn't show (`<!-- asciigraph:v1 … -->`), so it opens again exactly as it was. The rest of
 *   the file is left as it is: the drawing can live in a README. Opening a Markdown file without
 *   one takes its first drawing in a code block (or none: saving adds one at the end).
 * - `.txt`: just the drawing, read back from its characters.
 * - `.json`: the diagram, as "download .json" writes it.
 *
 * If the drawing in a .md file was changed by hand, the changed drawing wins over the hidden copy.
 */

export type FileFormat = "markdown" | "text" | "json";

export const FORMATS: { format: FileFormat; ext: string; label: string; mime: string }[] = [
  { format: "markdown", ext: ".md", label: "Markdown", mime: "text/markdown" },
  { format: "text", ext: ".txt", label: "text", mime: "text/plain" },
  { format: "json", ext: ".json", label: "diagram (JSON)", mime: "application/json" },
];

export const formatOf = (filename: string): FileFormat =>
  /\.json$/i.test(filename) ? "json" : /\.(md|markdown|mdx)$/i.test(filename) ? "markdown" : "text";

/** A file's name without its extension(s), as a diagram name. */
export const baseName = (filename: string) => filename.replace(/(\.asciigraph)?\.[^.]*$/, "") || filename;

const MARK = /^\s*<!--\s*asciigraph:v1\s+([A-Za-z0-9_=-]+)\s*-->\s*$/;
const FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w-]*)/;
/** Code blocks a drawing can be in. */
const DRAWING_INFO = new Set(["", "text", "txt", "plain", "ascii", "asciiart", "ascii-art", "diagram"]);

interface Block {
  /** Lines [start, end) of the file: the fenced block, and the hidden diagram after it if any. */
  start: number;
  end: number;
  body: string;
  /** The hidden diagram, if it has one. */
  data?: string;
}

/** Every fenced code block a drawing could be in. */
function blocks(lines: string[]): Block[] {
  const out: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const f = FENCE.exec(lines[i]);
    if (!f) continue;
    const marks = f[2];
    let j = i + 1;
    while (j < lines.length && !(lines[j].trim().startsWith(marks[0].repeat(marks.length)) && lines[j].trim().replace(/[`~]/g, "") === "")) j++;
    if (j >= lines.length) break; // not closed
    const body = lines.slice(i + 1, j).join("\n");
    const mark = MARK.exec(lines[j + 1] ?? "");
    if (DRAWING_INFO.has(f[3].toLowerCase())) out.push({ start: i, end: mark ? j + 2 : j + 1, body, ...(mark && { data: mark[1] }) });
    i = j;
  }
  return out;
}

/** The block holding our drawing: the one with the hidden diagram, or the first drawing. */
function ourBlock(lines: string[]): { block: Block | null; drawings: number } {
  const all = blocks(lines);
  const marked = all.find((b) => b.data);
  const drawings = all.filter((b) => b.data || looksLikeDrawing(b.body));
  return { block: marked ?? drawings[0] ?? null, drawings: drawings.length };
}

const sameDrawing = (a: string, b: string) => {
  const norm = (s: string) => s.replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).join("\n").replace(/^\n+|\n+$/g, "");
  return norm(a) === norm(b);
};

export interface ReadResult {
  diagram: Diagram;
  name: string;
  /** Something to tell the person (e.g. the drawing had been changed by hand). */
  note?: string;
}

/** A diagram from a file's contents. Throws if a .json file isn't a diagram. */
export function readFile(filename: string, content: string): ReadResult {
  const name = baseName(filename);
  const format = formatOf(filename);
  if (format === "json") {
    const obj = JSON.parse(content);
    if (isDiagram(obj?.diagram)) return { name: String(obj.name ?? name), diagram: obj.diagram };
    if (isDiagram(obj)) return { name, diagram: obj };
    throw new Error(`${filename} isn't an asciigraph diagram.`);
  }
  const drawing = (text: string) => (text.trim() ? importAscii(text).diagram : emptyDiagram());
  if (format === "text") return { name, diagram: drawing(content) };
  const { block, drawings } = ourBlock(content.replace(/\r/g, "").split("\n"));
  if (!block) return { name, diagram: emptyDiagram(), note: "It has no drawing yet: saving adds one at the end." };
  const more = drawings > 1 ? `It has ${drawings} drawings; this is the first.` : "";
  const kept = block.data ? decodeShare(block.data) : null;
  if (kept && sameDrawing(exportText(kept.diagram), block.body)) {
    return { name: kept.name || name, diagram: kept.diagram, ...(more && { note: more }) };
  }
  return {
    name: kept?.name || name,
    diagram: drawing(block.body),
    note: [kept && "The drawing had been changed outside asciigraph, so it was read back from its characters.", more].filter(Boolean).join(" ") || undefined,
  };
}

/** The lines asciigraph writes into a Markdown file for a diagram. */
function markdownBlock(d: Diagram, name: string): string[] {
  return ["```text", ...exportText(d).split("\n"), "```", `<!-- asciigraph:v1 ${encodeShare(d, name)} -->`];
}

/**
 * A file's new contents with the diagram saved in it. `existing`: what's in the file now (for
 * Markdown, the rest of it is kept; null or "": a new file).
 */
export function writeFile(filename: string, existing: string | null, d: Diagram, name: string): string {
  const format = formatOf(filename);
  if (format === "json") return JSON.stringify({ name, diagram: d }, null, 1) + "\n";
  if (format === "text") return exportText(d) + "\n";
  const block = markdownBlock(d, name);
  if (!existing?.trim()) return block.join("\n") + "\n";
  const lines = existing.replace(/\r/g, "").split("\n");
  const { block: at } = ourBlock(lines);
  if (!at) return existing.replace(/\s*$/, "") + "\n\n" + block.join("\n") + "\n";
  return [...lines.slice(0, at.start), ...block, ...lines.slice(at.end)].join("\n");
}

/** The part of a file that's the drawing (all of it, but for Markdown), to tell whether someone
 * else changed it since it was last read or written. */
export function drawingPart(filename: string, content: string): string {
  if (formatOf(filename) !== "markdown") return content;
  const lines = content.replace(/\r/g, "").split("\n");
  const { block } = ourBlock(lines);
  return block ? lines.slice(block.start, block.end).join("\n") : "";
}
