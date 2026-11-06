import { chars, wrap } from "./textLayout";

/**
 * Markdown lists in node text: `- item` / `* item` / `+ item` become bullets, `1.` / `1)` number
 * themselves, and indentation (2 spaces or a tab per level) nests them. Wrapped item text hangs
 * under the item's first word:
 *
 *   - first point, which wraps     •  first point, which
 *     onto two lines                  wraps
 *   - second                       •  second
 *     1. nested                       1. nested
 *
 * Checklists (task lists, as in GitHub's Markdown): `- [ ] to do` and `- [x] done` show a box in
 * place of the bullet, `[ ]` or `[✓]` (`[x]` in ASCII); numbered items take one too (`1. [ ]`):
 *
 *   - [x] write it                 [✓] write it
 *   - [ ] test it                  [ ] test it
 *
 * Everything else is plain text, wrapped as usual. A backslash before the marker (`\- not a
 * list`, `\1. nor this`) keeps a line as written, minus the backslash. With `plain` (a box set to
 * "lists: off"), nothing is treated as Markdown: the text shows exactly as typed.
 */

const ITEM = /^([ \t]*)([-*+]|(\d+)([.)]))\s+(.*)$/;
const ESCAPED = /^([ \t]*)\\(?=([-*+]|\d+[.)])\s)/;
const BULLETS = ["•", "◦", "▪"];
/** A checklist item's box, at the start of an item's text. */
const TASK = /^\[([ xX])\](?:\s+|$)/;

export interface Rendered {
  lines: string[];
  /** Whether any line was a list item (such blocks are laid out left-aligned). */
  list: boolean;
}

export function renderText(text: string, width: number, plain = false): Rendered {
  const w = Math.max(1, width);
  if (plain) {
    const lines = text.split("\n").flatMap((l) => wrap(l, w));
    return { lines: lines.length ? lines : [""], list: false };
  }
  const out: string[] = [];
  let list = false;
  // Numbering per nesting level, for the current list.
  let counters: (number | undefined)[] = [];

  for (const line of text.split("\n")) {
    const m = ITEM.exec(line);
    if (!m) {
      counters = [];
      out.push(...wrap(line.replace(ESCAPED, "$1"), w));
      continue;
    }
    list = true;
    const [, indent, , num, delim] = m;
    let body = m[5] ?? "";
    const task = TASK.exec(body);
    if (task) body = body.slice(task[0].length);
    const box = task ? (task[1] === " " ? "[ ]" : "[✓]") : "";
    const level = Math.floor(indent.replace(/\t/g, "  ").length / 2);
    counters = counters.slice(0, level + 1);
    let marker: string;
    if (num !== undefined) {
      const n = counters[level] === undefined ? Number(num) : counters[level]! + 1;
      counters[level] = n;
      marker = `${n}${delim}`;
    } else {
      counters[level] = undefined;
      marker = task ? "" : BULLETS[level % BULLETS.length];
    }
    if (box) marker = marker ? `${marker} ${box}` : box;
    const prefix = "  ".repeat(level) + marker + " ";
    const hang = chars(prefix).length;
    if (hang >= w) {
      // No room to indent: just the marker and text, wrapped.
      out.push(...wrap(prefix + body, w));
      continue;
    }
    wrap(body, w - hang).forEach((l, i) => out.push((i === 0 ? prefix : " ".repeat(hang)) + l));
  }
  return { lines: out.length ? out : [""], list };
}
