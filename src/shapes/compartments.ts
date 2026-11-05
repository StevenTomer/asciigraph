import { type Rect, bottom, right } from "../geometry/geom";
import type { LineStyle, Node } from "../model/types";
import { chars, layoutText, textLines } from "../render/textLayout";
import { box, drawBorder } from "./box";
import type { ShapeDef } from "./registry";

/**
 * A box in compartments, for UML classes and ER entities. The text's lines that are just `---`
 * divide it; the first part (the name) is centered, the rest (attributes, methods) left-aligned:
 *
 *   ┌───────────────┐
 *   │    Animal     │
 *   ├───────────────┤
 *   │ +name: String │
 *   ├───────────────┤
 *   │ +eat()        │
 *   └───────────────┘
 */

const DIVIDER = /^\s*-{3,}\s*$/;

/** The text's parts, between `---` lines. */
export function compartments(text: string): string[] {
  const parts: string[][] = [[]];
  for (const line of text.split("\n")) {
    if (DIVIDER.test(line)) parts.push([]);
    else parts[parts.length - 1].push(line);
  }
  return parts.map((p) => p.join("\n"));
}

/** Lines each part takes at a width (an empty part still takes one). */
function partHeights(n: Node, width: number): number[] {
  return compartments(n.text).map((p) => Math.max(1, textLines(p, width, n.lists === false).length));
}

const inner = (n: Node): Rect => {
  const r = n.rect;
  return { x: r.x + 2, y: r.y + 1, w: Math.max(1, r.w - 4), h: Math.max(1, r.h - 2) };
};

/** The rows of the dividers between parts (absolute), as drawn. */
export function dividerRows(n: Node): number[] {
  const heights = partHeights(n, inner(n).w);
  const rows: number[] = [];
  let y = n.rect.y + 1;
  for (let i = 0; i + 1 < heights.length; i++) {
    y += heights[i];
    if (y < bottom(n.rect)) rows.push(y);
    y++;
  }
  return rows;
}

export const classBox: ShapeDef = {
  ...box,
  label: "class",
  defaultSize: { w: 16, h: 7 },
  minSize: () => ({ w: 5, h: 3 }),
  contentRect: inner,

  // A connector on the left or right side meets a text row, not a divider (├ ┤ would become ┼).
  anchor(n, side, along) {
    if (side === "top" || side === "bottom") return undefined;
    const dividers = new Set(dividerRows(n));
    let y = along;
    if (dividers.has(y)) {
      const [lo, hi] = this.sideRange(n, side);
      y = y - 1 >= lo && !dividers.has(y - 1) ? y - 1 : y + 1 <= hi && !dividers.has(y + 1) ? y + 1 : y;
    }
    return { x: side === "left" ? n.rect.x : right(n.rect), y };
  },

  fitSize(n, text) {
    const w = inner(n).w;
    const h = compartments(text).reduce((sum, p) => sum + Math.max(1, textLines(p, w, n.lists === false).length), 0);
    const parts = compartments(text).length;
    return { w: n.rect.w, h: Math.max(n.rect.h, h + parts - 1 + 2) };
  },

  rasterize(n, grid) {
    const r = n.rect;
    const style: LineStyle | null = n.border === "none" ? null : n.border === "rounded" ? "single" : n.border;
    if (style) drawBorder(grid, r, n);
    const area = inner(n);
    const parts = compartments(n.text);
    const heights = partHeights(n, area.w);
    let y = area.y;
    const last = r.y + r.h - 2;
    parts.forEach((part, i) => {
      if (i > 0) {
        if (y > last) return;
        // ├────┤ across the box, joined to its sides.
        if (style) {
          for (let x = r.x; x <= right(r); x++) {
            grid.stroke({ x, y }, x === r.x ? ["right"] : x === right(r) ? ["left"] : ["left", "right"], style);
          }
        }
        y++;
      }
      // The last part takes whatever room is left.
      const h = i === parts.length - 1 ? Math.max(0, last - y + 1) : Math.min(heights[i], last - y + 1);
      if (h > 0) {
        const align = i === 0 ? { h: n.align.h, v: "top" as const } : { h: "left" as const, v: "top" as const };
        for (const [p, c] of layoutText(part, { x: area.x, y, w: area.w, h }, align, n.lists === false)) grid.setChar(p, c);
      }
      y += heights[i];
    });
  },
};

/** Width a class box needs for its text (the widest line, plus border and padding). */
export const classWidth = (text: string) => Math.max(5, ...text.split("\n").filter((l) => !DIVIDER.test(l)).map((l) => chars(l).length + 4));
