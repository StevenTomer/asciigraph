import { graphBuilder, readDirection } from "./builder";
import type { ParsedGraph } from "./graph";
import { logicalLines, unquote } from "./mermaid";

/**
 * Mermaid state diagrams (`stateDiagram-v2`):
 *
 *   [*] --> Still            start (●) and end (◉), one of each per composite state
 *   Still --> Moving : push  transitions, with labels
 *   state "Long name" as S   a state's text;  S : more text  adds a line
 *   state Busy { … }         composite states, drawn as a frame around their states
 *   state C <<choice>>       a decision;  <<fork>> / <<join>>: a heavy bar
 *   note right of S : text   notes (also over several lines, ending with "end note")
 *   direction LR             the layout direction
 *
 * Concurrency dividers (--), classDef, class and ::: styles are ignored.
 */

const ID = String.raw`(\[\*\]|[\p{L}\p{N}_]+)`;
const TRANSITION = new RegExp(String.raw`^${ID}(?::::\w+)?\s*-->\s*${ID}(?::::\w+)?\s*(?::\s*(.*))?$`, "u");

export function parseState(text: string): ParsedGraph {
  const b = graphBuilder();
  const { g } = b;
  let notes = 0;
  /** Lines of a note being read up to "end note". */
  let note: { side: string; target: string; lines: string[] } | null = null;

  const addNote = (target: string, body: string) => {
    const id = `__note${notes++}`;
    b.node(target);
    b.node(id, { text: body, kind: "note" });
    b.edge({ from: id, to: target, label: "", line: "dotted", arrows: { start: false, end: false } });
  };
  /** [*]: the start (as a source) or end (as a target) of the block it's in. */
  const endpoint = (id: string, asSource: boolean): string => {
    if (id !== "[*]") return id;
    const scope = b.current?.id ?? "";
    const key = `__${asSource ? "start" : "end"}${scope ? "_" + scope : ""}`;
    b.node(key, { text: asSource ? "●" : "◉", plain: true });
    return key;
  };

  logicalLines(text).forEach(({ line: raw, lineNo }) => {
    const line = raw.replace(/%%.*$/gm, "").trim();
    if (note) {
      if (/^end\s+note$/i.test(line)) {
        addNote(note.target, note.lines.join("\n"));
        note = null;
      } else note.lines.push(line);
      return;
    }
    if (!line || /^stateDiagram(-v2)?\b/.test(line)) return;
    if (/^(classDef|class|style|accTitle|accDescr|scale|hide|--)\b/.test(line) || line === "--") return;
    const dir = readDirection(line);
    if (dir) {
      if (!b.depth) g.direction = dir;
      return;
    }
    if (line === "}") {
      if (!b.close()) g.warnings.push(`line ${lineNo}: "}" without a state to close`);
      return;
    }
    const t = TRANSITION.exec(line);
    if (t) {
      const from = endpoint(t[1], true), to = endpoint(t[2], false);
      b.node(from);
      b.node(to);
      b.edge({ from, to, label: t[3] ? unquote(t[3]) : "", line: "single", arrows: { start: false, end: true } });
      return;
    }
    // state "Long name" as S {   |   state S {   |   state S <<choice>>   |   state S
    const st = /^state\s+(?:"([^"]*)"\s+as\s+([\p{L}\p{N}_]+)|([\p{L}\p{N}_]+)(?:\s+as\s+"([^"]*)")?)\s*(<<\s*(choice|fork|join)\s*>>)?\s*(\{)?\s*$/u.exec(line);
    if (st) {
      const id = st[2] ?? st[3];
      const label = st[1] ?? st[4];
      const n = b.node(id, { rounded: true, ...(label !== undefined && { text: label }) });
      if (st[6] === "choice") Object.assign(n, { kind: "decision", text: "", rounded: false });
      if (st[6] === "fork" || st[6] === "join") Object.assign(n, { kind: "box", text: "━".repeat(9), rounded: false, plain: true, bar: true });
      if (st[7]) b.open(id, n.text);
      return;
    }
    const nt = /^note\s+(left|right)\s+of\s+([\p{L}\p{N}_]+)\s*(?::\s*(.*))?$/iu.exec(line);
    if (nt) {
      if (nt[3] !== undefined) addNote(nt[2], unquote(nt[3]));
      else note = { side: nt[1], target: nt[2], lines: [] };
      return;
    }
    // S : description (each one a line of the state's text)
    const desc = /^([\p{L}\p{N}_]+)\s*:\s*(.*)$/u.exec(line);
    if (desc) {
      const n = b.node(desc[1], { rounded: true });
      const extra = unquote(desc[2]);
      n.text = n.text === n.id ? extra : `${n.text}\n${extra}`;
      return;
    }
    const bare = /^([\p{L}\p{N}_]+)(?::::\w+)?$/u.exec(line);
    if (bare) {
      b.node(bare[1], { rounded: true });
      return;
    }
    g.warnings.push(`line ${lineNo}: couldn't read "${line}"`);
  });
  if (note) g.warnings.push(`a note has no "end note"`);
  if (b.depth) g.warnings.push(`state "${b.current!.title}" has no closing "}"`);
  for (const n of g.nodes) {
    if (!n.plain && n.kind === "box") n.rounded = true;
    // A fork or join bar runs across the flow.
    if (n.bar && g.direction === "right") n.text = Array(5).fill("┃").join("\n");
    delete n.bar;
  }
  return b.finish();
}
