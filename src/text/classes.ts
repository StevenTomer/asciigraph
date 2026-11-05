import type { Head } from "../model/types";
import { endLabels, graphBuilder, readDirection } from "./builder";
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
 *   A "1" --> "*" B : has                    labels, and how many at each end (end labels)
 *   namespace Zoo { class … }                drawn as a frame
 *   note for A "text"                        notes
 *   direction LR                             the layout direction
 */

const ID = String.raw`[\p{L}\p{N}_]+(?:~[^~]+~)?`;
const HEAD_LEFT: Record<string, Head> = { "<|": "triangle", "*": "diamond", o: "hollow-diamond", "<": "arrow" };
const HEAD_RIGHT: Record<string, Head> = { "|>": "triangle", "*": "diamond", o: "hollow-diamond", ">": "arrow" };
const RELATION = new RegExp(
  String.raw`^(${ID})\s*(?:"([^"]*)"\s*)?(<\||\*|o|<)?(-{1,2}|\.{1,2})(\|>|\*|o|>)?\s*(?:"([^"]*)"\s*)?(${ID})\s*(?::\s*(.*))?$`,
  "u"
);

/** PlantUML lines that don't draw anything here. */
const PLANT_SKIP = /^(@startuml|@enduml|skinparam\b|hide\b|show\b|!|'|title\b|header\b|footer\b|caption\b|set\b|allowmixing\b)/i;
/** PlantUML's kinds of class, and how each is marked above the name. */
const PLANT_KINDS: Record<string, string | undefined> = {
  class: undefined, "abstract class": "abstract", abstract: "abstract", interface: "interface", enum: "enumeration",
  annotation: "annotation", entity: "entity", protocol: "protocol", struct: "struct", exception: "exception",
};

/** Whether text is a PlantUML class diagram: @startuml, then classes or class relations. */
export const isPlantClass = (text: string) =>
  /^\s*@startuml\b/m.test(text) && (/^\s*(abstract\s+class|abstract|class|interface|enum)\s+[\p{L}_"]/mu.test(text) || /(<\|--|--\|>|\*--|--\*|o--|--o|\.\.\|>)/.test(text));

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

  const plant = /^\s*@startuml\b/m.test(text);
  logicalLines(text).forEach(({ line: raw, lineNo }) => {
    let line = raw.replace(/%%.*$/gm, "").trim();
    if (!line || /^classDiagram(-v2)?\b/.test(line)) return;
    if (plant) {
      if (PLANT_SKIP.test(line)) return;
      if (/^left to right direction$/i.test(line)) {
        g.direction = "right";
        return;
      }
      if (/^top to bottom direction$/i.test(line)) return;
      // Arrows' layout hints (-up->, .left.>) don't matter here.
      line = line.replace(/([-.])(?:up|down|left|right|u|d|l|r)(?=[-.])/i, "$1");
    }
    const body = blocks[blocks.length - 1];
    if (line === "}") {
      const closed = blocks.pop();
      if (!closed) g.warnings.push(`line ${lineNo}: "}" without a block to close`);
      else if (closed.kind === "namespace") b.close();
      return;
    }
    if (body?.kind === "class") {
      // (PlantUML's separators inside a class: -- .. == __)
      if (/^(--|\.\.|==|__)+(.*?)(--|\.\.|==|__)*$/.test(line) && !/[\p{L}\p{N}(]/u.test(line)) return;
      const ann = /^<<\s*(.+?)\s*>>$/.exec(line);
      if (ann) info.get(body.id)!.annotation = ann[1];
      else info.get(body.id)!.members.push(generics(line));
      return;
    }
    if (/^(classDef|cssClass|style|click|callback|link|accTitle|accDescr)\b/.test(line)) return;
    if (plant && /^end\s+note$|^note\b/i.test(line) && !/^note\s+(for\s+\S+\s+)?"/.test(line)) return;
    const dir = readDirection(line);
    if (dir) {
      if (!b.depth) g.direction = dir;
      return;
    }
    const ns = /^(?:namespace|package)\s+"?([\p{L}\p{N}_. ]+?)"?\s*(?:<<[^>]*>>\s*)?\{$/u.exec(line);
    if (ns) {
      b.open(ns[1], ns[1]);
      blocks.push({ kind: "namespace" });
      return;
    }
    // class Name~T~ ["Label"] [:::style] [{]   (PlantUML: interface Name <<stereo>> {, enum …)
    const kinds = plant ? Object.keys(PLANT_KINDS).sort((p, q) => q.length - p.length).map((k) => k.replace(" ", "\\s+")).join("|") : "class";
    const c = new RegExp(String.raw`^(${kinds})\s+(${ID})\s*(?:\["([^"]*)"\])?\s*(?:<<\s*(.+?)\s*>>)?\s*(?::::\w+)?\s*(\{)?\s*(\})?$`, "iu").exec(line);
    if (c) {
      const ci = cls(c[2]);
      if (c[3] !== undefined) ci.label = c[3];
      const marked = c[4] ?? PLANT_KINDS[c[1].toLowerCase().replace(/\s+/g, " ")];
      if (marked) ci.annotation = marked;
      if (c[5] && !c[6]) blocks.push({ kind: "class", id: idOf(c[2]) });
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
        label: label ? unquote(label) : "",
        endLabels: endLabels(cardA, cardB),
        line: link.startsWith(".") ? "dashed" : "single",
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
