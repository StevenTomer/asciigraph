import { type Rect, bottom, right } from "../geometry/geom";
import type { LineStyle, Node } from "../model/types";
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
    for (const [p, c] of layoutText(n.text, this.contentRect(n), n.align)) grid.setChar(p, c);
    // The dashed line.
    for (let y = y1 + 1; y <= bottom(r); y++) {
      grid.stroke({ x: cx, y }, y < bottom(r) ? ["top", "bottom"] : ["top"], "dashed");
    }
  },
};

/** Whether a node is a lifeline and the cell is on its line (not the header). */
export function onLifelineLine(n: Node, y: number): boolean {
  return n.kind === "lifeline" && y >= n.rect.y + HEADER && y <= bottom(n.rect);
}
