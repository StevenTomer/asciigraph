/**
 * Message sequences from text: Mermaid `sequenceDiagram`, and a looser shorthand.
 *
 * Mermaid: participant / actor (with "as" aliases); messages ->> (arrow), -->> (dashed arrow),
 * -> and --> (lines without arrowheads), -x / --x / -) / --) (drawn as arrows); + / - after the
 * arrow to activate the target / deactivate the sender; activate / deactivate; Note left of /
 * right of / over A[,B]: text; loop / alt / else / opt / par / and / critical / break … end
 * frames; autonumber.
 * Shorthand (no `sequenceDiagram` header): `A -> B: msg` and `A --> B: reply` are arrows (solid,
 * dashed). Participants used without being declared are added in order of appearance.
 */

export interface Participant {
  key: string;
  label: string;
}

export type SeqEvent =
  | { type: "message"; from: string; to: string; label: string; dashed: boolean; arrow: boolean; activate: boolean; deactivate: boolean }
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

const FRAMES = /^(loop|alt|opt|par|critical|break|rect)\b\s*(.*)$/i;
const MESSAGE = /^(.+?)\s*(-->>|->>|--x|-x|--\)|-\)|-->|->|=>)\s*([+-]?)\s*(.+?)\s*(?::\s*(.*))?$/;

export function parseSequence(text: string): ParsedSequence {
  const seq: ParsedSequence = { participants: [], events: [], autonumber: false, warnings: [] };
  const mermaid = /^\s*sequenceDiagram\b/m.test(text);
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

  text.split("\n").forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.replace(/%%.*$/, "").trim();
    if (!line || /^sequenceDiagram\b/.test(line) || /^title\b/i.test(line)) return;
    if (/^autonumber\b/i.test(line)) {
      seq.autonumber = true;
      return;
    }
    const decl = /^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i.exec(line);
    if (decl) {
      participant(decl[2].trim(), decl[3]?.trim());
      return;
    }
    const act = /^(activate|deactivate)\s+(.+)$/i.exec(line);
    if (act) {
      seq.events.push({ type: act[1].toLowerCase() as "activate" | "deactivate", who: participant(act[2].trim()) });
      return;
    }
    const note = /^note\s+(left of|right of|over)\s+([^:]+):\s*(.*)$/i.exec(line);
    if (note) {
      const side = note[1].toLowerCase().startsWith("left") ? "left" : note[1].toLowerCase().startsWith("right") ? "right" : "over";
      const who = note[2].split(",").map((s) => participant(s.trim()));
      seq.events.push({ type: "note", side, who, text: note[3].replace(/<br\s*\/?>/gi, "\n") });
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
    const m = MESSAGE.exec(line);
    if (m) {
      const [, a, op, mod, b, label] = m;
      const dashed = op.startsWith("--");
      // In Mermaid, -> and --> are lines without arrowheads; in the shorthand they're arrows.
      const arrow = mermaid ? !/^--?>$/.test(op) : true;
      seq.events.push({
        type: "message", from: participant(a.trim()), to: participant(b.trim()), label: (label ?? "").trim(),
        dashed, arrow, activate: mod === "+", deactivate: mod === "-",
      });
      return;
    }
    seq.warnings.push(`line ${lineNo}: couldn't read "${line}"`);
  });
  for (let k = 0; k < depth; k++) seq.events.push({ type: "end" });
  if (depth) seq.warnings.push(`${depth} frame(s) without "end"`);
  return seq;
}
