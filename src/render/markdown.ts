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
 * Everything else is plain text, wrapped as usual.
 */

const ITEM = /^([ \t]*)([-*+]|(\d+)([.)]))\s+(.*)$/;
const BULLETS = ["•", "◦", "▪"];

export interface Rendered {
  lines: string[];
  /** Whether any line was a list item (such blocks are laid out left-aligned). */
  list: boolean;
}

export function renderText(text: string, width: number): Rendered {
  const w = Math.max(1, width);
  const out: string[] = [];
  let list = false;
  // Numbering per nesting level, for the current list.
  let counters: (number | undefined)[] = [];

  for (const line of text.split("\n")) {
    const m = ITEM.exec(line);
    if (!m) {
      counters = [];
      out.push(...wrap(line, w));
      continue;
    }
    list = true;
    const [, indent, , num, delim, body] = m;
    const level = Math.floor(indent.replace(/\t/g, "  ").length / 2);
    counters = counters.slice(0, level + 1);
    let marker: string;
    if (num !== undefined) {
      const n = counters[level] === undefined ? Number(num) : counters[level]! + 1;
      counters[level] = n;
      marker = `${n}${delim}`;
    } else {
      counters[level] = undefined;
      marker = BULLETS[level % BULLETS.length];
    }
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
