/**
 * Mermaid text helpers shared by the parsers and the writers (fromDiagram.ts).
 *
 * Multi-line text: Mermaid's `<br>`, or its "markdown strings", which may span lines:
 *     A["`Todo:
 *       - design
 *       - build`"]
 * Continuation lines are dedented together, so list nesting by indent survives. Quotes inside
 * labels are written #quot; as in Mermaid.
 */

/** Source lines, with any markdown string spanning several lines joined into one (keeping its
 * newlines), each with the line number it started on. */
export function logicalLines(text: string): { line: string; lineNo: number }[] {
  const raw = text.split("\n");
  const out: { line: string; lineNo: number }[] = [];
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i];
    const start = i;
    // Inside a markdown string while there are more "` openers than `" closers.
    const open = (s: string) => (s.match(/"`/g) ?? []).length - (s.match(/`"/g) ?? []).length;
    while (open(line) > 0 && i + 1 < raw.length) line += "\n" + raw[++i];
    out.push({ line, lineNo: start + 1 });
  }
  return out;
}

/** The text of a label as written in Mermaid: quotes, markdown strings, <br>, #quot;. */
export function unquote(s: string): string {
  const t = s.trim();
  const md = /^"`([\s\S]*)`"$/.exec(t);
  if (md) return dedent(md[1]).replace(/#quot;/g, '"');
  return t.replace(/^"(.*)"$/s, "$1").replace(/<br\s*\/?>/gi, "\n").replace(/#quot;/g, '"');
}

/** Remove the indentation shared by all lines after the first (the source's own indent). */
function dedent(s: string): string {
  const lines = s.split("\n");
  const rest = lines.slice(1).filter((l) => l.trim());
  const common = Math.min(...rest.map((l) => l.match(/^ */)![0].length), Infinity);
  if (!rest.length || common === Infinity) return s;
  return [lines[0], ...lines.slice(1).map((l) => l.slice(Math.min(common, l.match(/^ */)![0].length)))].join("\n");
}

/**
 * A label written for Mermaid: bare if it's a simple word or phrase, quoted if it has
 * punctuation Mermaid reads as syntax, a markdown string if it has several lines.
 */
export function quote(text: string, indent = ""): string {
  const t = text.replace(/"/g, "#quot;");
  if (t.includes("\n")) return `"\`${t.split("\n").join("\n" + indent)}\`"`;
  return /^[\p{L}\p{N} _.,!?'/-]+$/u.test(t) && t.trim() === t && t !== "" ? t : `"${t}"`;
}

/** Text for a message or note, where Mermaid only has <br> for line breaks. */
export function inline(text: string): string {
  return text.replace(/\n/g, "<br>");
}
