import { type Rect, type Side, bottom, inset, right } from "../geometry/geom";
import type { Node } from "../model/types";
import type { CharGrid } from "../render/grid";
import { chars, layoutText, measure, wrap } from "../render/textLayout";
import type { ShapeDef } from "./registry";

/**
 * The box shape: border (or none), text inside, and an optional name set into the top border:
 *
 *   ┌─ Name ──────┐
 *   │ text inside │
 *   └─────────────┘
 */
export const box: ShapeDef = {
  minSize(node) {
    return node.border === "none" ? { w: 1, h: 1 } : { w: 2, h: 2 };
  },

  hasBorder(node) {
    return node.border !== "none";
  },

  contentRect(node) {
    const r = node.rect;
    if (node.border === "none") return r;
    // One column of padding inside the border when there's room for it.
    return inset(r, r.w >= 5 ? 2 : 1, 1);
  },

  sideRange(node, side) {
    // Cells along a side where connectors may attach: not the corners, if there's a border.
    const r = node.rect;
    const c = node.border === "none" ? 0 : 1;
    const [lo, hi] = side === "top" || side === "bottom" ? [r.x, right(r)] : [r.y, bottom(r)];
    return lo + c <= hi - c ? [lo + c, hi - c] : [lo, hi];
  },

  fitSize(node, text) {
    // Autosized labels size to their text; anything else grows (never shrinks) to fit its
    // wrapped text.
    if (node.autosize) {
      const m = measure(text);
      return { w: m.w, h: m.h };
    }
    const content = this.contentRect(node);
    const lines = wrap(text, content.w).length;
    return { w: node.rect.w, h: Math.max(node.rect.h, lines + (node.rect.h - content.h)) };
  },

  rasterize(node, grid) {
    const r = node.rect;
    if (node.border !== "none") drawBorder(grid, r, node);
    for (const [p, c] of layoutText(node.text, this.contentRect(node), node.align)) {
      grid.setChar(p, c);
    }
    if (node.name && node.border !== "none") drawName(grid, r, node.name, node.nameAlign ?? "left");
  },
};

function drawBorder(grid: CharGrid, r: Rect, node: Node) {
  const style = node.border === "rounded" ? "single" : (node.border as Exclude<Node["border"], "rounded" | "none">);
  const rounded = node.border === "rounded";
  const x1 = right(r), y1 = bottom(r);
  for (let x = r.x; x <= x1; x++) {
    for (const y of r.h === 1 ? [r.y] : [r.y, y1]) {
      const dirs: Side[] = [];
      if (x > r.x) dirs.push("left");
      if (x < x1) dirs.push("right");
      if (r.h > 1 && (x === r.x || x === x1)) dirs.push(y === r.y ? "bottom" : "top");
      grid.stroke({ x, y }, dirs, style, rounded);
    }
  }
  for (let y = r.y + 1; y < y1; y++) {
    for (const x of r.w === 1 ? [r.x] : [r.x, x1]) grid.stroke({ x, y }, ["top", "bottom"], style);
  }
}

/** `┌─ Name ───┐`: name padded by a space each side, after one border character (or centred or
 * right-aligned), truncated with … when the box is too narrow. */
function drawName(grid: CharGrid, r: Rect, name: string, align: Node["align"]["h"]) {
  const room = r.w - 6; // corner, line, space … space, line, corner
  if (room < 1) return;
  let cs = chars(name.replace(/\n/g, " "));
  if (cs.length > room) cs = [...cs.slice(0, room - 1), "…"];
  const start =
    align === "left" ? r.x + 3
    : align === "right" ? right(r) - 2 - cs.length
    : r.x + Math.floor((r.w - cs.length) / 2);
  grid.setChar({ x: start - 1, y: r.y }, " ");
  cs.forEach((c, i) => grid.setChar({ x: start + i, y: r.y }, c));
  grid.setChar({ x: start + cs.length, y: r.y }, " ");
}
