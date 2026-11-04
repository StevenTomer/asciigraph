import type { Point, Rect } from "../geometry/geom";
import type { HAlign, VAlign } from "../model/types";
import { renderText } from "./markdown";

/** Split into characters by code point (so emoji and astral characters aren't split in half). */
export const chars = (s: string) => Array.from(s);

/**
 * Greedy word wrap to `width` columns. Explicit newlines are kept, and so is each line's leading
 * indentation (its wrapped continuation lines are indented the same, when there's room); words
 * longer than a line are broken. Always returns at least one line.
 */
export function wrap(text: string, width: number): string[] {
  const w = Math.max(1, width);
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    const lead = paragraph.match(/^[ \t]*/)![0].replace(/\t/g, "  ");
    const indent = lead.length < w ? lead : "";
    const room = w - indent.length;
    const lines: string[] = [];
    let line: string[] = [];
    for (const word of paragraph.trimStart().split(" ")) {
      let wc = chars(word);
      const needed = line.length === 0 ? wc.length : line.length + 1 + wc.length;
      if (needed <= room) {
        line = line.length === 0 ? wc : [...line, " ", ...wc];
        continue;
      }
      if (line.length > 0) lines.push(line.join(""));
      while (wc.length > room) {
        lines.push(wc.slice(0, room).join(""));
        wc = wc.slice(room);
      }
      line = wc;
    }
    lines.push(line.join(""));
    out.push(...lines.map((l) => (l ? indent + l : l)));
  }
  return out;
}

/** Lines of text without wrapping, and the size they need. */
export function measure(text: string): { lines: string[]; w: number; h: number } {
  const lines = text.split("\n");
  return { lines, w: Math.max(1, ...lines.map((l) => chars(l).length)), h: lines.length };
}

/** The lines node text shows at `width` columns: wrapped, with Markdown lists rendered. */
export function textLines(text: string, width: number, plain = false): string[] {
  return renderText(text, width, plain).lines;
}

/**
 * Place text in `area`: wrap (rendering Markdown lists), align, and clip (marking the last visible
 * line with … when lines are cut off). Returns each character with its cell. Text containing a
 * list is laid out left-aligned, so bullets line up. `plain`: no Markdown (see markdown.ts).
 */
export function layoutText(
  text: string,
  area: Rect,
  align: { h: HAlign; v: VAlign },
  plain = false
): [Point, string][] {
  if (area.w < 1 || area.h < 1 || text === "") return [];
  const rendered = renderText(text, area.w, plain);
  let lines = rendered.lines;
  if (rendered.list) align = { ...align, h: "left" };
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
