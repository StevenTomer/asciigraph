import { type Rect, type Side, bottom, inset, right } from "../geometry/geom";
import type { Node } from "../model/types";
import type { CharGrid } from "../render/grid";
import { chars, layoutText, textLines } from "../render/textLayout";
import type { ShapeDef } from "./registry";

/**
 * The box shape: border (or none), text inside, and an optional name set into the top border:
 *
 *   ┌─ Name ──────┐
 *   │ text inside │
 *   └─────────────┘
 */
export const box: ShapeDef = {
  label: "box",
  defaultSize: { w: 16, h: 3 },

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
      const lines = textLines(text, 100000, node.lists === false);
      return { w: Math.max(1, ...lines.map((l) => chars(l).length)), h: lines.length };
    }
    let content = this.contentRect(node);
    let w = node.rect.w;
    if (content.w < 1 && text.trim()) {
      // Too narrow for any text (a 2-wide bordered box): wide enough for its longest line.
      const longest = Math.max(1, ...textLines(text, 100000, node.lists === false).map((l) => chars(l).length));
      w = longest + 4;
      content = this.contentRect({ ...node, rect: { ...node.rect, w } });
    }
    const lines = textLines(text, content.w, node.lists === false).length;
    return { w, h: Math.max(node.rect.h, lines + (node.rect.h - content.h)) };
  },

  rasterize(node, grid) {
    const r = node.rect;
    if (node.border !== "none") drawBorder(grid, r, node);
    for (const [p, c] of layoutText(node.text, this.contentRect(node), node.align, node.lists === false)) {
      grid.setChar(p, c);
    }
    if (node.name && node.border !== "none") drawName(grid, r, node.name, node.nameAlign ?? "left");
  },
};

export function drawBorder(grid: CharGrid, r: Rect, node: Node) {
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

/** `┌─ Name ───┐`: name padded by a space each side, after one border character (or centered or
 * right-aligned), truncated with … when the box is too narrow. */
export function drawName(grid: CharGrid, r: Rect, name: string, align: Node["align"]["h"]) {
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

/**
 * A frame: a named outline that groups things without hiding them (sequence-diagram loop/alt
 * blocks, graph subgraphs). Only its border is opaque and clickable; what's inside shows through.
 */
export const frame: ShapeDef = {
  ...box,
  label: "frame",
  defaultSize: { w: 30, h: 10 },
  footprint(n) {
    const r = n.rect;
    return [
      { x: r.x, y: r.y, w: r.w, h: 1 },
      { x: r.x, y: bottom(r), w: r.w, h: 1 },
      { x: r.x, y: r.y, w: 1, h: r.h },
      { x: right(r), y: r.y, w: 1, h: r.h },
    ];
  },
  hitTest(n, c) {
    const r = n.rect;
    const inside = c.x >= r.x && c.x <= right(r) && c.y >= r.y && c.y <= bottom(r);
    return inside && (c.x === r.x || c.x === right(r) || c.y === r.y || c.y === bottom(r));
  },
};
