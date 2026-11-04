import { type Rect, bottom, right } from "../geometry/geom";
import type { LineStyle } from "../model/types";
import { layoutText } from "../render/textLayout";
import type { ShapeDef } from "./registry";

/**
 * A sequence-diagram lifeline: a participant box with a dashed line down from it. Messages are
 * connectors attached to the line at a row (left or right side, `offset` = the row), so they stay
 * put as the lifelines move apart or together. Only the header is opaque; messages cross other
 * lifelines' lines.
 *
 *   ┌──────────┐
 *   │  Client  │
 *   └────┬─────┘
 *        ┆
 *        ├────────────► (to another lifeline)
 *        ┆
 */
const HEADER = 3;

const header = (r: Rect): Rect => ({ x: r.x, y: r.y, w: r.w, h: HEADER });
/** The column the line runs down. */
export const lifelineColumn = (r: Rect) => r.x + Math.floor((r.w - 1) / 2);

export const lifeline: ShapeDef = {
  label: "lifeline",
  defaultSize: { w: 14, h: 16 },
  minSize: () => ({ w: 5, h: HEADER + 2 }),
  hasBorder: () => true,
  contentRect(n) {
    const r = n.rect;
    return { x: r.x + (r.w >= 5 ? 2 : 1), y: r.y + 1, w: Math.max(1, r.w - (r.w >= 5 ? 4 : 2)), h: 1 };
  },
  sides: ["left", "right"],
  sideRange(n, side) {
    const r = n.rect;
    if (side === "left" || side === "right") return [r.y + HEADER, bottom(r)];
    return [lifelineColumn(r), lifelineColumn(r)];
  },
  anchor(n, side, along) {
    const r = n.rect;
    if (side === "left" || side === "right") return { x: lifelineColumn(r), y: along };
    return { x: lifelineColumn(r), y: side === "top" ? r.y : bottom(r) };
  },
  fitSize: (n) => ({ w: n.rect.w, h: n.rect.h }),
  footprint: (n) => [header(n.rect)],
  attachByRow: (n, cell) => cell.y >= n.rect.y + HEADER && cell.y <= bottom(n.rect),
  // Its header, and its dashed line (so an activation bar on it stays in front of it).
  covers(n, q) {
    const r = n.rect, cx = lifelineColumn(r);
    const header = q.y < r.y + HEADER && bottom(q) >= r.y;
    return header || (cx >= q.x && cx <= right(q) && bottom(q) >= r.y + HEADER && q.y <= bottom(r));
  },
  hitTest(n, cell) {
    const r = n.rect;
    if (cell.x >= r.x && cell.x <= right(r) && cell.y >= r.y && cell.y < r.y + HEADER) return true;
    // The line, give or take a column, so it's easy to grab.
    return Math.abs(cell.x - lifelineColumn(r)) <= 1 && cell.y >= r.y + HEADER && cell.y <= bottom(r);
  },
  rasterize(n, grid) {
    const r = n.rect, h = header(r);
    const style: LineStyle = n.border === "none" || n.border === "rounded" ? "single" : n.border;
    const x1 = right(h), y1 = bottom(h), cx = lifelineColumn(r);
    // The header box (rounded corners if asked), joined to the line below it (┬).
    for (let x = h.x; x <= x1; x++) {
      for (const y of [h.y, y1]) {
        const dirs: ("left" | "right" | "top" | "bottom")[] = [];
        if (x > h.x) dirs.push("left");
        if (x < x1) dirs.push("right");
        if (x === h.x || x === x1) dirs.push(y === h.y ? "bottom" : "top");
        if (y === y1 && x === cx) dirs.push("bottom");
        grid.stroke({ x, y }, dirs, style, n.border === "rounded");
      }
    }
    for (let y = h.y + 1; y < y1; y++) for (const x of [h.x, x1]) grid.stroke({ x, y }, ["top", "bottom"], style);
    for (const [p, c] of layoutText(n.text, this.contentRect(n), n.align, n.lists === false)) grid.setChar(p, c);
    // The dashed line.
    for (let y = y1 + 1; y <= bottom(r); y++) {
      grid.stroke({ x: cx, y }, y < bottom(r) ? ["top", "bottom"] : ["top"], "dashed");
    }
  },
};

/**
 * An activation bar: a narrow box on a lifeline showing when that participant is busy. It joins
 * the dashed line above and below (┴ ┬), and takes messages by row, like the lifeline.
 *
 *      ┆
 *     ┌┴┐
 *  ──►│ │
 *     │ ├──►
 *     └┬┘
 *      ┆
 */
export const activation: ShapeDef = {
  label: "activation",
  defaultSize: { w: 3, h: 6 },
  minSize: () => ({ w: 3, h: 3 }),
  normalize: (r) => ({ ...r, w: 3 }),
  hasBorder: () => true,
  contentRect: (n) => ({ x: n.rect.x + 1, y: n.rect.y + 1, w: 1, h: Math.max(1, n.rect.h - 2) }),
  sides: ["left", "right"],
  sideRange(n, side) {
    const r = n.rect;
    return side === "left" || side === "right" ? [r.y + 1, bottom(r) - 1] : [r.x + 1, r.x + 1];
  },
  fitSize: (n) => ({ w: n.rect.w, h: n.rect.h }),
  attachByRow: () => true,
  rasterize(n, grid) {
    const r = n.rect;
    const style: LineStyle = n.border === "none" || n.border === "rounded" ? "single" : n.border;
    const x1 = right(r), y1 = bottom(r), cx = r.x + 1;
    for (let x = r.x; x <= x1; x++) {
      for (const y of [r.y, y1]) {
        const dirs: ("left" | "right" | "top" | "bottom")[] = [];
        if (x > r.x) dirs.push("left");
        if (x < x1) dirs.push("right");
        if (x === r.x || x === x1) dirs.push(y === r.y ? "bottom" : "top");
        if (x === cx) dirs.push(y === r.y ? "top" : "bottom"); // join the lifeline
        grid.stroke({ x, y }, dirs, style);
      }
    }
    for (let y = r.y + 1; y < y1; y++) for (const x of [r.x, x1]) grid.stroke({ x, y }, ["top", "bottom"], style);
  },
};
