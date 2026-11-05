import { chars } from "../render/textLayout";
import { endLabels, graphBuilder, readDirection } from "./builder";
import type { ParsedGraph } from "./graph";
import { logicalLines, unquote } from "./mermaid";

/**
 * Mermaid entity–relationship diagrams (`erDiagram`): entities as boxes with their attributes in
 * columns, relationships as connectors labelled with how many are at each end (end labels):
 *
 *   CUSTOMER ||--o{ ORDER : places     drawn as  1 ── places ── 0..*
 *   CUSTOMER { string name PK "the name" }   attributes: type, name, keys, comment
 *   p["Person"]                              labels
 *
 * Ends: || exactly one, |o / o| zero or one, }o / o{ zero or more, }| / |{ one or more;
 * -- identifying (solid), .. non-identifying (dashed).
 */

const ID = String.raw`[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*`;
const LEFT: Record<string, string> = { "||": "1", "|o": "0..1", "}o": "0..*", "}|": "1..*" };
const RIGHT: Record<string, string> = { "||": "1", "o|": "0..1", "o{": "0..*", "|{": "1..*" };
const RELATION = new RegExp(
  String.raw`^(${ID})(?:\["?([^"\]]*)"?\])?\s*(\|\||\|o|\}o|\}\|)(--|\.\.)(\|\||o\||o\{|\|\{)\s*(${ID})(?:\["?([^"\]]*)"?\])?\s*(?::\s*(.*))?$`,
  "u"
);

export function parseEr(text: string): ParsedGraph {
  const b = graphBuilder();
  const { g } = b;
  const attrs = new Map<string, string[][]>();
  const labels = new Map<string, string>();
  let open: string | null = null;

  const entity = (id: string, label?: string) => {
    b.node(id, { kind: "class" });
    if (!attrs.has(id)) attrs.set(id, []);
    if (label) labels.set(id, label);
  };

  logicalLines(text).forEach(({ line: raw, lineNo }) => {
    const line = raw.replace(/%%.*$/gm, "").trim();
    if (!line || /^erDiagram\b/.test(line)) return;
    if (open) {
      if (line === "}") {
        open = null;
        return;
      }
      // type name [PK, FK] ["comment"]
      const a = /^(\S+)\s+(\S+)((?:\s+(?:PK|FK|UK)\s*,?)*)\s*(?:"([^"]*)")?$/.exec(line);
      if (a) attrs.get(open)!.push([a[1].replace(/~([^~]+)~/g, "<$1>"), a[2], a[3].replace(/[\s,]+/g, " ").trim().split(" ").filter(Boolean).join(", "), a[4] ?? ""]);
      else g.warnings.push(`line ${lineNo}: couldn't read the attribute "${line}"`);
      return;
    }
    if (/^(classDef|class|style|accTitle|accDescr)\b/.test(line)) return;
    const dir = readDirection(line);
    if (dir) {
      g.direction = dir;
      return;
    }
    const block = new RegExp(String.raw`^(${ID})(?:\["?([^"\]]*)"?\])?\s*\{\s*(\})?$`, "u").exec(line);
    if (block) {
      entity(block[1], block[2]);
      if (!block[3]) open = block[1];
      return;
    }
    const r = RELATION.exec(line);
    if (r) {
      const [, a, la, left, link, right, z, lz, label] = r;
      entity(a, la);
      entity(z, lz);
      b.edge({
        from: a, to: z,
        label: label ? unquote(label) : "",
        endLabels: endLabels(LEFT[left], RIGHT[right]),
        line: link === ".." ? "dashed" : "single",
        arrows: { start: false, end: false },
      });
      return;
    }
    const bare = new RegExp(String.raw`^(${ID})(?:\["?([^"\]]*)"?\])?$`, "u").exec(line);
    if (bare) {
      entity(bare[1], bare[2]);
      return;
    }
    g.warnings.push(`line ${lineNo}: couldn't read "${line}"`);
  });
  if (open) g.warnings.push(`entity "${open}" has no closing "}"`);
  for (const [id, rows] of attrs) {
    const n = b.byId.get(id)!;
    const name = labels.get(id) ?? id;
    if (!rows.length) {
      n.text = name;
      continue;
    }
    // Columns: type, name, keys, comment, each as wide as its widest entry.
    const widths = [0, 1, 2, 3].map((c) => Math.max(...rows.map((r) => chars(r[c]).length)));
    const lines = rows.map((r) => r.map((cell, c) => (widths[c] ? cell.padEnd(widths[c] + cell.length - chars(cell).length) : "")).filter((_, c) => widths[c]).join("  ").trimEnd());
    n.text = `${name}\n---\n${lines.join("\n")}`;
  }
  return b.finish();
}
