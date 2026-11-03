import type { Point, Rect } from "../geometry/geom";
import type { HAlign, VAlign } from "../model/types";

/** Split into characters by code point (so emoji and astral characters aren't split in half). */
export const chars = (s: string) => Array.from(s);

/**
 * Greedy word wrap to `width` columns. Explicit newlines are kept; words longer than a line are
 * broken. Always returns at least one line.
 */
export function wrap(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line: string[] = [];
    for (const word of paragraph.split(" ")) {
      let wc = chars(word);
      const needed = line.length === 0 ? wc.length : line.length + 1 + wc.length;
      if (needed <= w) {
        line = line.length === 0 ? wc : [...line, " ", ...wc];
        continue;
      }
      if (line.length > 0) out.push(line.join(""));
      while (wc.length > w) {
        out.push(wc.slice(0, w).join(""));
        wc = wc.slice(w);
      }
      line = wc;
    }
    out.push(line.join(""));
  }
  return out;
}

/** Lines of text without wrapping, and the size they need. */
export function measure(text: string): { lines: string[]; w: number; h: number } {
  const lines = text.split("\n");
  return { lines, w: Math.max(1, ...lines.map((l) => chars(l).length)), h: lines.length };
}

/**
 * Place text in `area`: wrap, align, and clip (marking the last visible line with … when lines are
 * cut off). Returns each character with its cell.
 */
export function layoutText(
  text: string,
  area: Rect,
  align: { h: HAlign; v: VAlign }
): [Point, string][] {
  if (area.w < 1 || area.h < 1 || text === "") return [];
  let lines = wrap(text, area.w);
  if (lines.length > area.h) {
    lines = lines.slice(0, area.h);
    const last = chars(lines[area.h - 1]);
    lines[area.h - 1] = [...last.slice(0, area.w - 1), "…"].join("");
  }
  const top =
    align.v === "top" ? area.y
    : align.v === "bottom" ? area.y + area.h - lines.length
    : area.y + Math.floor((area.h - lines.length) / 2);
  const out: [Point, string][] = [];
  lines.forEach((line, i) => {
    const cs = chars(line);
    const left =
      align.h === "left" ? area.x
      : align.h === "right" ? area.x + area.w - cs.length
      : area.x + Math.floor((area.w - cs.length) / 2);
    cs.forEach((c, j) => out.push([{ x: left + j, y: top + i }, c]));
  });
  return out;
}
