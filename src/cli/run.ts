import { addNode, emptyDiagram, isDiagram, makeNode } from "../model/ops";
import type { Diagram, SourceKind } from "../model/types";
import { decodeShare } from "../storage/share";
import { exportText, type Wrap, WRAPS } from "../export/text";
import { importAscii, looksLikeDrawing } from "../text/ascii";
import { isTableText, tableNode } from "../shapes/table";
import { detectKind } from "../text/detect";
import { describe } from "../text/fromDiagram";
import { drawSource } from "../text/sync";

/**
 * What the command line does, without touching the process (main.ts does that), so tests can
 * run it: arguments and a way to read files in, text and an exit code out.
 */

export interface CliIO {
  /** Read a file; null (or "-") is standard input. */
  read(file: string | null): string;
  write(file: string, text: string): void;
}

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

export const USAGE = `asciigraph: draw diagrams as text.

Usage:
  asciigraph [render] [FILE] [options]   draw FILE (or standard input) as text
  asciigraph mermaid [FILE]              write Mermaid for a saved diagram or a drawing
  asciigraph import [FILE]               read a drawing into a diagram (.json) for the app
  asciigraph markdown FILE [--write]     draw every \`\`\`mermaid block in a Markdown file

FILE can be Mermaid (sequenceDiagram, flowchart, stateDiagram, classDiagram, erDiagram), DOT, the
shorthand (A -> B: message, A -> B -> C), a drawing (box-drawing or +--+ ASCII text), a
Markdown table,
a folder tree, a diagram saved from the app (.json), or a share link. Without FILE, or with "-",
it reads standard input.

Options:
  --kind auto|sequence|graph|tree|drawing|table
                                    what the text is (default: detected)
  --lr, --td                        lay graphs out left to right, or top to bottom
  --boxes                           draw folder trees as boxes and connectors
  --ascii                           ASCII characters only (+ - | instead of box drawing)
  --wrap STYLE                      ${WRAPS.filter((w) => w.kind !== "custom").map((w) => w.kind).join(", ")}
  -o, --output FILE                 write to FILE instead of standard output
  --write                           (markdown) update FILE in place
  -h, --help                        this help

Examples:
  asciigraph flow.mmd
  echo 'Client -> API: GET /users' | asciigraph
  asciigraph import old-diagram.txt -o diagram.json
  asciigraph markdown README.md --write`;

interface Options {
  command: "render" | "mermaid" | "markdown" | "import";
  file: string | null;
  kind: SourceKind | "auto" | "drawing" | "table";
  direction?: "down" | "right";
  boxes: boolean;
  ascii: boolean;
  wrap: Wrap;
  output: string | null;
  write: boolean;
}

class UsageError extends Error {}

function parseArgs(args: string[]): Options | "help" {
  const o: Options = { command: "render", file: null, kind: "auto", boxes: false, ascii: false, wrap: { kind: "plain" }, output: null, write: false };
  const rest = [...args];
  const value = (flag: string) => {
    const v = rest.shift();
    if (v === undefined) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  let positional = 0;
  while (rest.length) {
    const a = rest.shift()!;
    if (a === "-h" || a === "--help" || a === "help") return "help";
    else if (a === "--kind") {
      const k = value(a);
      if (!["auto", "sequence", "graph", "tree", "drawing", "table"].includes(k)) throw new UsageError(`unknown kind "${k}"`);
      o.kind = k as Options["kind"];
    } else if (a === "--lr") o.direction = "right";
    else if (a === "--td" || a === "--tb") o.direction = "down";
    else if (a === "--boxes") o.boxes = true;
    else if (a === "--ascii") o.ascii = true;
    else if (a === "--wrap") {
      const w = value(a);
      if (!WRAPS.some((x) => x.kind === w && w !== "custom")) throw new UsageError(`unknown wrap style "${w}"`);
      o.wrap = { kind: w } as Wrap;
    } else if (a === "-o" || a === "--output") o.output = value(a);
    else if (a === "--write") o.write = true;
    else if (a.startsWith("-") && a !== "-") throw new UsageError(`unknown option ${a}`);
    else if (positional === 0 && (a === "render" || a === "mermaid" || a === "markdown" || a === "import")) {
      o.command = a;
      positional++;
    } else if (o.file === null) {
      o.file = a;
      positional++;
    } else throw new UsageError(`unexpected "${a}"`);
  }
  if (o.command === "markdown" && (o.file === null || o.file === "-") && o.write) throw new UsageError("--write needs a file");
  return o;
}

/** A saved diagram (the app's .json download, or a bare diagram), or a share link; else null. */
function savedDiagram(input: string): Diagram | null {
  const s = input.trim();
  const link = s.match(/#\/share\/([A-Za-z0-9_-]+)/);
  if (link) return decodeShare(link[1])?.diagram ?? null;
  if (!s.startsWith("{")) return null;
  try {
    const obj = JSON.parse(s);
    if (isDiagram(obj?.diagram)) return obj.diagram;
    if (isDiagram(obj)) return obj;
  } catch {
    // not JSON: treat it as text
  }
  return null;
}

/** Draw text (or load a saved diagram): the diagram, and any warnings. */
export function toDiagram(input: string, o: Pick<Options, "kind" | "direction" | "boxes">): { diagram: Diagram; warnings: string[] } {
  const saved = savedDiagram(input);
  if (saved) return { diagram: saved, warnings: [] };
  if (o.kind === "table" || (o.kind === "auto" && isTableText(input))) {
    const t = tableNode(input, { x: 0, y: 0 });
    return { diagram: addNode(emptyDiagram(), makeNode(t.rect, t)), warnings: [] };
  }
  if (o.kind === "drawing" || (o.kind === "auto" && looksLikeDrawing(input))) {
    const r = importAscii(input);
    return { diagram: r.diagram, warnings: r.warnings };
  }
  const kind = o.kind === "auto" ? detectKind(input) : o.kind;
  const options = { direction: o.direction, treeStyle: o.boxes ? "boxes" as const : "text" as const };
  const r = drawSource(emptyDiagram(), { kind, text: input, options }, { x: 0, y: 0 });
  return { diagram: r.diagram, warnings: r.warnings };
}

const isEmpty = (d: Diagram) => !Object.keys(d.nodes).length && !Object.keys(d.edges).length;

function render(input: string, o: Options): { text: string; warnings: string[] } {
  const { diagram, warnings } = toDiagram(input, o);
  if (isEmpty(diagram)) throw new Error("nothing to draw");
  return { text: exportText(diagram, { ascii: o.ascii, wrap: o.wrap }), warnings };
}

function mermaid(input: string): string {
  const d = savedDiagram(input) ?? (looksLikeDrawing(input) ? importAscii(input).diagram : null);
  if (!d) throw new Error("mermaid needs a diagram saved from the app (.json), a share link, or a drawing");
  const sources = Object.values(d.sources ?? {});
  const ids = [...d.order, ...Object.keys(d.edges)];
  // Drawn from one text and nothing else: that text is the answer.
  if (sources.length === 1 && ids.every((id) => (d.nodes[id] ?? d.edges[id]).gen?.source === sources[0].id)) return sources[0].text;
  const desc = describe(d, ids);
  if (!desc) throw new Error("couldn't write Mermaid for that diagram (it needs boxes joined by connectors, or a sequence diagram)");
  return desc.text;
}

/**
 * Markdown: after every ```mermaid block, a ```text block with its drawing, between marker
 * comments so running it again updates the drawing rather than adding another.
 */
const OPEN = "<!-- asciigraph: drawn from the mermaid block above; edit that, then run asciigraph markdown -->";
const CLOSE = "<!-- /asciigraph -->";

export function renderMarkdown(doc: string, o: Pick<Options, "ascii">): { text: string; warnings: string[]; count: number } {
  const lines = doc.split("\n");
  const out: string[] = [];
  const warnings: string[] = [];
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].match(/^(\s*)(`{3,}|~{3,})\s*mermaid\b/);
    out.push(lines[i]);
    if (!fence) continue;
    const [, indent, marks] = fence;
    const start = i + 1;
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !lines[j].trim().startsWith(marks)) body.push(lines[j++]);
    out.push(...lines.slice(i + 1, j + 1));
    i = j;
    // An earlier drawing right after it (blank lines allowed) is replaced.
    let k = i + 1;
    while (k < lines.length && !lines[k].trim()) k++;
    if (lines[k]?.trim() === OPEN || lines[k]?.trim().startsWith("<!-- asciigraph")) {
      const end = lines.findIndex((l, n) => n > k && l.trim() === CLOSE);
      if (end > 0) i = end;
    }
    const source = body.map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l)).join("\n");
    try {
      const r = render(source, { ...defaults, ascii: o.ascii });
      warnings.push(...r.warnings.map((w) => `block at line ${start}: ${w}`));
      out.push("", indent + OPEN, indent + "```text", ...r.text.split("\n").map((l) => (l ? indent + l : l)), indent + "```", indent + CLOSE);
      count++;
    } catch (e) {
      warnings.push(`block at line ${start}: ${(e as Error).message}`);
    }
  }
  return { text: out.join("\n"), warnings, count };
}

const defaults: Options = { command: "render", file: null, kind: "auto", boxes: false, ascii: false, wrap: { kind: "plain" }, output: null, write: false };

/** Write a file, saying which one when it can't be written. */
function save(io: CliIO, file: string, text: string) {
  try {
    io.write(file, text);
  } catch (e) {
    throw new Error(`can't write ${file}: ${(e as Error).message}`);
  }
}

export function cliRun(args: string[], io: CliIO): CliResult {
  let o: Options | "help";
  try {
    o = parseArgs(args);
  } catch (e) {
    return { stdout: "", stderr: `asciigraph: ${(e as Error).message}\nRun asciigraph --help for how to use it.`, code: 2 };
  }
  if (o === "help") return { stdout: USAGE, stderr: "", code: 0 };
  let input: string;
  try {
    input = io.read(o.file);
  } catch (e) {
    return { stdout: "", stderr: `asciigraph: can't read ${o.file ?? "standard input"}: ${(e as Error).message}`, code: 1 };
  }
  try {
    let text: string;
    let warnings: string[] = [];
    if (o.command === "mermaid") text = mermaid(input);
    else if (o.command === "import") {
      const r = toDiagram(input, { ...o, kind: o.kind === "auto" ? "drawing" : o.kind });
      if (isEmpty(r.diagram)) throw new Error("nothing to draw");
      text = JSON.stringify({ name: o.file && o.file !== "-" ? o.file.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "") : "Imported", diagram: r.diagram }, null, 1);
      warnings = r.warnings;
    }
    else if (o.command === "markdown") {
      const r = renderMarkdown(input, o);
      text = r.text;
      warnings = r.warnings;
      if (o.write && o.file) {
        save(io, o.file, text);
        const note = `asciigraph: drew ${r.count} block${r.count === 1 ? "" : "s"} in ${o.file}`;
        return { stdout: "", stderr: [...warnings.map((w) => `warning: ${w}`), note].join("\n"), code: 0 };
      }
    } else ({ text, warnings } = render(input, o));
    const stderr = warnings.map((w) => `warning: ${w}`).join("\n");
    if (o.output) {
      save(io, o.output, text.endsWith("\n") ? text : text + "\n");
      return { stdout: "", stderr, code: 0 };
    }
    return { stdout: text, stderr, code: 0 };
  } catch (e) {
    return { stdout: "", stderr: `asciigraph: ${(e as Error).message}`, code: 1 };
  }
}
