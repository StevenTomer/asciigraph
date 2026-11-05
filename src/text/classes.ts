import type { Head } from "../model/types";
import { graphBuilder, readDirection, withEnds } from "./builder";
import type { ParsedGraph } from "./graph";
import { logicalLines, unquote } from "./mermaid";

/**
 * Mermaid class diagrams (`classDiagram`), drawn as boxes in compartments (name, attributes,
 * methods):
 *
 *   class Animal { +name: String  +eat() }   members in a block, one per line
 *   Animal : +age int                        or one at a time
 *   class Shape~T~ / class A["Label"]        generics (Shape<T>) and labels
 *   <<interface>> Shape                      annotations (also inside the block)
 *   Animal <|-- Dog                          relations: <|-- inheritance, *-- composition,
 *                                            o-- aggregation, --> association, ..> dependency,
 *                                            ..|> realization, -- and .. links
 *   A "1" --> "*" B : has                    labels and how many at each end
 *   namespace Zoo { class … }                drawn as a frame
 *   note for A "text"                        notes
 *   direction LR                             the layout direction
 */

const ID = String.raw`[\p{L}\p{N}_]+(?:~[^~]+~)?`;
const HEAD_LEFT: Record<string, Head> = { "<|": "triangle", "*": "diamond", o: "hollow-diamond", "<": "arrow" };
const HEAD_RIGHT: Record<string, Head> = { "|>": "triangle", "*": "diamond", o: "hollow-diamond", ">": "arrow" };
const RELATION = new RegExp(
  String.raw`^(${ID})\s*(?:"([^"]*)"\s*)?(<\||\*|o|<)?(--|\.\.)(\|>|\*|o|>)?\s*(?:"([^"]*)"\s*)?(${ID})\s*(?::\s*(.*))?$`,
  "u"
);

/** Shape~T~ → Shape<T>, as Mermaid shows generics. */
const generics = (s: string) => s.replace(/~([^~]+)~/g, "<$1>");

interface ClassInfo {
  label?: string;
  annotation?: string;
  members: string[];
}

export function parseClass(text: string): ParsedGraph {
  const b = graphBuilder();
  const { g } = b;
  const info = new Map<string, ClassInfo>();
  /** What each open "{" belongs to: a class body (by id) or a namespace. */
  const blocks: ({ kind: "class"; id: string } | { kind: "namespace" })[] = [];
  let notes = 0;

  const cls = (raw: string): ClassInfo => {
    const id = raw.replace(/~[^~]+~$/, "");
    b.node(id, { kind: "class" });
    if (!info.has(id)) info.set(id, { members: [] });
    const c = info.get(id)!;
    if (raw !== id && !c.label) c.label = generics(raw);
    return c;
  };
  const idOf = (raw: string) => raw.replace(/~[^~]+~$/, "");

  logicalLines(text).forEach(({ line: raw, lineNo }) => {
    const line = raw.replace(/%%.*$/gm, "").trim();
    if (!line || /^classDiagram(-v2)?\b/.test(line)) return;
    const body = blocks[blocks.length - 1];
    if (line === "}") {
      const closed = blocks.pop();
      if (!closed) g.warnings.push(`line ${lineNo}: "}" without a block to close`);
      else if (closed.kind === "namespace") b.close();
      return;
    }
    if (body?.kind === "class") {
      const ann = /^<<\s*(.+?)\s*>>$/.exec(line);
      if (ann) info.get(body.id)!.annotation = ann[1];
      else info.get(body.id)!.members.push(generics(line));
      return;
    }
    if (/^(classDef|cssClass|style|click|callback|link|accTitle|accDescr)\b/.test(line)) return;
    const dir = readDirection(line);
    if (dir) {
      if (!b.depth) g.direction = dir;
      return;
    }
    const ns = /^namespace\s+([\p{L}\p{N}_.]+)\s*\{$/u.exec(line);
    if (ns) {
      b.open(ns[1], ns[1]);
      blocks.push({ kind: "namespace" });
      return;
    }
    // class Name~T~ ["Label"] [:::style] [{]
    const c = new RegExp(String.raw`^class\s+(${ID})\s*(?:\["([^"]*)"\])?\s*(?::::\w+)?\s*(\{)?\s*(\})?$`, "u").exec(line);
    if (c) {
      const ci = cls(c[1]);
      if (c[2] !== undefined) ci.label = c[2];
      if (c[3] && !c[4]) blocks.push({ kind: "class", id: idOf(c[1]) });
      return;
    }
    const ann = new RegExp(String.raw`^<<\s*(.+?)\s*>>\s*(${ID})$`, "u").exec(line);
    if (ann) {
      cls(ann[2]).annotation = ann[1];
      return;
    }
    const nt = new RegExp(String.raw`^note\s+(?:for\s+(${ID})\s+)?"(.*)"$`, "u").exec(line);
    if (nt) {
      const id = `__note${notes++}`;
      b.node(id, { kind: "note", text: unquote(nt[2].replace(/\\n/g, "<br>")) });
      if (nt[1]) {
        cls(nt[1]);
        b.edge({ from: id, to: idOf(nt[1]), label: "", line: "dotted", arrows: { start: false, end: false } });
      }
      return;
    }
    const r = RELATION.exec(line);
    if (r) {
      const [, a, cardA, left, link, right, cardB, z, label] = r;
      cls(a);
      cls(z);
      const heads = { ...(left && { start: HEAD_LEFT[left] }), ...(right && { end: HEAD_RIGHT[right] }) };
      b.edge({
        from: idOf(a), to: idOf(z),
        label: withEnds(label ? unquote(label) : "", cardA, cardB),
        line: link === ".." ? "dashed" : "single",
        arrows: { start: !!left, end: !!right },
        ...((left || right) && { heads }),
      });
      return;
    }
    // Name : +member
    const member = new RegExp(String.raw`^(${ID})\s*:\s*(.+)$`, "u").exec(line);
    if (member) {
      cls(member[1]).members.push(generics(member[2].trim()));
      return;
    }
    if (/\(\)\s*--|--\s*\(\)/.test(line)) {
      g.warnings.push(`line ${lineNo}: lollipop interfaces aren't drawn`);
      return;
    }
    g.warnings.push(`line ${lineNo}: couldn't read "${line}"`);
  });
  if (blocks.length) g.warnings.push(`a "{" has no closing "}"`);
  for (const [id, c] of info) {
    const n = b.byId.get(id)!;
    const name = c.label ?? id;
    const header = c.annotation ? `«${c.annotation}»\n${name}` : name;
    const attrs = c.members.filter((m) => !m.includes("("));
    const methods = c.members.filter((m) => m.includes("("));
    n.text = [header, ...(attrs.length || methods.length ? [attrs.join("\n")] : []), ...(methods.length ? [methods.join("\n")] : [])]
      .join("\n---\n");
  }
  return b.finish();
}
