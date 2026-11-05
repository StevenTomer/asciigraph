import type { Head } from "../model/types";
import { logicalLines, unquote } from "./mermaid";

/**
 * Message sequences from text: Mermaid `sequenceDiagram`, and a looser shorthand.
 *
 * Mermaid: participant / actor (with "as" aliases); messages ->> (arrow), -->> (dashed arrow),
 * -> and --> (lines without arrowheads), -x / --x (a cross: lost or failed) and -) / --) (an open arrow: asynchronous); + / - after the
 * arrow to activate the target / deactivate the sender; activate / deactivate; Note left of /
 * right of / over A[,B]: text; loop / alt / else / opt / par / and / critical / break … end
 * frames; autonumber.
 * Shorthand (no `sequenceDiagram` header): `A -> B: msg` and `A --> B: reply` are arrows (solid,
 * dashed). Participants used without being declared are added in order of appearance.
 * PlantUML (`@startuml`): the same arrows, plus ->x (lost), <- and <-- (the other way), <-> (both),
 * ->> -\ -/ (drawn as arrows); `++` / `--` after the target (activate / deactivate);
 * participant / actor / boundary / control / entity / database / collections / queue, with
 * `"Long name" as L`; notes on one line or over several up to `end note`; group … end;
 * skinparam, == sections ==, ..., |||, ' comments and the like are skipped.
 */

export interface Participant {
  key: string;
  label: string;
}

export type SeqEvent =
  | { type: "message"; from: string; to: string; label: string; dashed: boolean; arrow: boolean; head?: Head; both?: boolean; activate: boolean; deactivate: boolean }
  | { type: "note"; side: "left" | "right" | "over"; who: string[]; text: string }
  | { type: "activate" | "deactivate"; who: string }
  | { type: "frame"; kind: string; label: string }
  | { type: "else"; label: string }
  | { type: "end" };

export interface ParsedSequence {
  participants: Participant[];
  events: SeqEvent[];
  autonumber: boolean;
  warnings: string[];
}

const FRAMES = /^(loop|alt|opt|par|critical|break|rect|group)\b\s*(.*)$/i;
const MESSAGE = /^(.+?)\s*(<->|<-->|<--|<-|-->>|->>|-->x|->x|--x|-x|--\)|-\)|-->|->|-\\|-\/|=>)\s*([+-]?)\s*(.+?)\s*(\+\+|--|\*\*|!!)?\s*(?::\s*(.*))?$/;
/** PlantUML lines that don't draw anything here. */
const PLANT_SKIP = /^(@startuml|@enduml|skinparam\b|hide\b|show\b|!|'|header\b|footer\b|newpage\b|caption\b|legend\b|endlegend\b|==.*==$|\.\.\.|\|\|\||mainframe\b|box\b|end box\b)/i;
const KEYWORDS = "participant|actor|boundary|control|entity|database|collections|queue";

export function parseSequence(text: string): ParsedSequence {
  const seq: ParsedSequence = { participants: [], events: [], autonumber: false, warnings: [] };
  const mermaid = /^\s*sequenceDiagram\b/m.test(text);
  const plant = /^\s*@startuml\b/m.test(text);
  /** A PlantUML note over several lines, read up to "end note". */
  let note: { side: "left" | "right" | "over"; who: string[]; lines: string[] } | null = null;
  const known = new Map<string, Participant>();
  const participant = (key: string, label?: string) => {
    let p = known.get(key);
    if (!p) {
      p = { key, label: key };
      known.set(key, p);
      seq.participants.push(p);
    }
    if (label) p.label = label;
    return p.key;
  };
  let depth = 0;

  logicalLines(text).forEach(({ line: raw, lineNo }) => {
    const line = raw.replace(/%%.*$/gm, "").trim();
    if (note) {
      if (/^end\s*note$/i.test(line)) {
        seq.events.push({ type: "note", side: note.side, who: note.who, text: note.lines.join("\n") });
        note = null;
      } else note.lines.push(line);
      return;
    }
    if (!line || /^sequenceDiagram\b/.test(line) || /^title\b/i.test(line)) return;
    if (plant && PLANT_SKIP.test(line)) return;
    if (/^autonumber\b/i.test(line)) {
      seq.autonumber = true;
      return;
    }
    const decl = new RegExp(`^(${KEYWORDS})\\s+(.+?)(?:\\s+as\\s+(.+?))?(?:\\s+<<[^>]*>>)?(?:\\s+#\\S+)?(?:\\s+order\\s+\\d+)?$`, "is").exec(line);
    if (decl) {
      const [name, alias] = [decl[2].trim(), decl[3]?.trim()];
      // PlantUML writes participant "Long name" as L (the key last); Mermaid participant A as Alice.
      if (alias !== undefined && /^".*"$/.test(name) && !/^".*"$/.test(alias)) participant(alias, unquote(name));
      else participant(unquote(name), alias !== undefined ? unquote(alias).replace(/\n/g, " ") : undefined);
      return;
    }
    const act = /^(activate|deactivate)\s+(.+)$/i.exec(line);
    if (act) {
      seq.events.push({ type: act[1].toLowerCase() as "activate" | "deactivate", who: participant(act[2].trim()) });
      return;
    }
    const nt = /^[hr]?note\s+(left of|right of|over|left|right)\s+([^:]+?)\s*(?::\s*(.*))?$/is.exec(line);
    if (nt) {
      const side = nt[1].toLowerCase().startsWith("left") ? "left" : nt[1].toLowerCase().startsWith("right") ? "right" : "over";
      const who = nt[2].split(",").map((s) => participant(s.trim()));
      if (nt[3] !== undefined) seq.events.push({ type: "note", side, who, text: unquote(nt[3]) });
      else note = { side, who, lines: [] };
      return;
    }
    const frame = FRAMES.exec(line);
    if (frame) {
      depth++;
      seq.events.push({ type: "frame", kind: frame[1].toLowerCase(), label: frame[2].trim() });
      return;
    }
    const alt = /^(else|and)\b\s*(.*)$/i.exec(line);
    if (alt) {
      seq.events.push({ type: "else", label: `${alt[1].toLowerCase()}${alt[2] ? " " + alt[2].trim() : ""}` });
      return;
    }
    if (/^end$/i.test(line)) {
      if (depth === 0) {
        seq.warnings.push(`line ${lineNo}: "end" without a loop/alt/opt`);
        return;
      }
      depth--;
      seq.events.push({ type: "end" });
      return;
    }
    if (plant && /^return\b/i.test(line)) {
      seq.warnings.push(`line ${lineNo}: "return" isn't drawn; write the reply as a message`);
      return;
    }
    const m = MESSAGE.exec(line);
    if (m) {
      const [, a0, op, mod, b0, after, label] = m;
      // <- and <-- point the other way.
      const back = op.startsWith("<") && op !== "<->";
      const [a, b] = back ? [b0, a0] : [a0, b0];
      const dashed = op.includes("--");
      // In Mermaid, -> and --> are lines without arrowheads; in the shorthand they're arrows.
      const arrow = mermaid ? !/^--?>$/.test(op) : true;
      const head: Head | undefined = op.endsWith("x") ? "cross" : op.endsWith(")") ? "triangle" : undefined;
      seq.events.push({
        type: "message", from: participant(a.trim()), to: participant(b.trim()), label: unquote(label ?? ""),
        dashed, arrow, ...(head && { head }), ...(op === "<->" && { both: true }),
        activate: mod === "+" || after === "++", deactivate: mod === "-" || after === "--",
      });
      return;
    }
    seq.warnings.push(`line ${lineNo}: couldn't read "${line}"`);
  });
  if (note) seq.warnings.push(`a note has no "end note"`);
  for (let k = 0; k < depth; k++) seq.events.push({ type: "end" });
  if (depth) seq.warnings.push(`${depth} frame(s) without "end"`);
  return seq;
}
