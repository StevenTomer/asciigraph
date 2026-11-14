import type { Point, Rect, Side } from "../geometry/geom";
import type { Node } from "../model/types";
import { layoutText, textLines } from "../render/textLayout";
import { lineStyle, strokePath, through } from "./more";
import type { ShapeDef } from "./registry";

/**
 * A circle or ellipse, drawn as steps of line characters (cells are about twice as tall as they
 * are wide, so a round one is about twice as wide as it is tall):
 *
 *        ╭───────╮                  .-------.
 *     ╭──╯       ╰──╮            .--'       '--.
 *   ╭─╯             ╰─╮        .-'             '-.
 *   │     circle      │        |     circle      |
 *   ╰─╮             ╭─╯        '-.             .-'
 *     ╰──╮       ╭──╯            '--.       .--'
 *        ╰───────╯                  '-------'
 *
 * Each row's ends follow a real ellipse through the rect. Going down the right side, a step out
 * goes down then across (on the wider row below), a step in goes across then down, so the outline
 * is the same upside down. Corners are rounded (╭ ╮ ╰ ╯), and . and ' in ASCII.
 */

/** Each row's leftmost and rightmost outline cell (columns relative to the rect). */
export function ellipseRows(w: number, h: number): { l: number[]; r: number[] } {
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  // The ellipse through the cells' outer edges: half a cell past the middle of the end rows.
  const a = (w - 1) / 2, b = cy + 0.5;
  const r = Array.from({ length: h }, (_, i) => {
    const t = (i - cy) / b;
    return Math.min(w - 1, Math.round(cx + a * Math.sqrt(Math.max(0, 1 - t * t))));
  });
  // A row wider than both its neighbors can't be stepped out to and back in (the runs would
  // overlap): it's as wide as the wider of them.
  for (let i = 1; i < h - 1; i++) if (r[i] > r[i - 1] && r[i] > r[i + 1]) r[i] = Math.max(r[i - 1], r[i + 1]);
  // Out to the rect's edges (rounding, or the line above, may have left it a column short).
  const short = w - 1 - Math.max(...r);
  for (let i = 0; i < h; i++) r[i] = Math.min(w - 1, r[i] + short);
  // The top and bottom rows keep a flat stretch of at least one cell.
  const least = Math.ceil(cx) + 1;
  for (let i = 0; i < h; i++) r[i] = Math.max(r[i], least);
  return { l: r.map((x) => w - 1 - x), r };
}

/** The outline, clockwise from the top row's left end (absolute cells, each once). */
export function ellipseOutline(rect: Rect): Point[] {
  const { l, r } = ellipseRows(rect.w, rect.h);
  const X = (dx: number) => rect.x + dx, Y = (dy: number) => rect.y + dy;
  const corners: Point[] = [{ x: X(l[0]), y: Y(0) }, { x: X(r[0]), y: Y(0) }];
  // Down the right side.
  for (let i = 1; i < rect.h; i++) {
    if (r[i] >= r[i - 1]) corners.push({ x: X(r[i - 1]), y: Y(i) }, { x: X(r[i]), y: Y(i) });
    else corners.push({ x: X(r[i]), y: Y(i - 1) }, { x: X(r[i]), y: Y(i) });
  }
  // Along the bottom, then up the left side (the right side mirrored).
  corners.push({ x: X(l[rect.h - 1]), y: Y(rect.h - 1) });
  for (let i = rect.h - 2; i >= 0; i--) {
    if (l[i] <= l[i + 1]) corners.push({ x: X(l[i + 1]), y: Y(i) }, { x: X(l[i]), y: Y(i) });
    else corners.push({ x: X(l[i]), y: Y(i + 1) }, { x: X(l[i]), y: Y(i) });
  }
  const cells = through(corners);
  // through() repeats a corner where two runs meet: once each.
  const seen = new Set<string>();
  return cells.filter((p) => {
    const k = `${p.x},${p.y}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Per row, the first and last cell inside the outline (relative columns). */
function inside(w: number, h: number): [number, number][] {
  const cells = ellipseOutline({ x: 0, y: 0, w, h });
  return Array.from({ length: h }, (_, y) => {
    const xs = cells.filter((p) => p.y === y).map((p) => p.x);
    const mid = (w - 1) / 2;
    const leftOf = xs.filter((x) => x <= mid), rightOf = xs.filter((x) => x > mid);
    return [Math.max(-1, ...leftOf) + 1, Math.min(w, ...rightOf) - 1];
  });
}

/** The rows with no step on either side (the straight │ stretch down each side). */
function straightRows(w: number, h: number): number[] {
  const { r } = ellipseRows(w, h);
  const most = Math.max(...r);
  const rows: number[] = [];
  for (let i = 1; i < h - 1; i++) if (r[i - 1] === most && r[i] === most && r[i + 1] === most) rows.push(i);
  return rows;
}

export const ellipse: ShapeDef = {
  label: "circle",
  defaultSize: { w: 15, h: 5 },
  minSize: () => ({ w: 9, h: 5 }),
  // Odd heights: a straight stretch down the middle of each side, where connectors attach.
  normalize: (r) => ({ ...r, h: r.h % 2 ? r.h : r.h + 1 }),
  hasBorder: (n) => n.border !== "none",
  contentRect(n) {
    const { w, h } = n.rect;
    // The middle rows that are nearly as wide inside as the widest, less a space each side.
    const spans = inside(w, h);
    const mid = Math.floor((h - 1) / 2);
    const width = ([a, b]: [number, number]) => b - a + 1;
    const widest = width(spans[mid]);
    let top = mid, end = h - 1 - mid;
    while (top - 1 >= 1 && width(spans[top - 1]) >= widest * 0.7) top--;
    while (end + 1 <= h - 2 && width(spans[end + 1]) >= widest * 0.7) end++;
    const lo = Math.max(...spans.slice(top, end + 1).map((s) => s[0])) + 1;
    const hi = Math.min(...spans.slice(top, end + 1).map((s) => s[1])) - 1;
    return { x: n.rect.x + lo, y: n.rect.y + top, w: Math.max(1, hi - lo + 1), h: end - top + 1 };
  },
  sideRange(n, side) {
    const { w, h } = n.rect;
    if (side === "top" || side === "bottom") {
      const { l, r } = ellipseRows(w, h);
      const row = side === "top" ? 0 : h - 1;
      return [n.rect.x + l[row] + 1, Math.max(n.rect.x + l[row] + 1, n.rect.x + r[row] - 1)];
    }
    const rows = straightRows(w, h);
    const mid = n.rect.y + Math.floor((h - 1) / 2);
    return rows.length ? [n.rect.y + rows[0], n.rect.y + rows[rows.length - 1]] : [mid, mid];
  },
  anchor(n, side, along): Point | undefined {
    const { l, r } = ellipseRows(n.rect.w, n.rect.h);
    const row = along - n.rect.y;
    if (side === "left") return { x: n.rect.x + (l[row] ?? 0), y: along };
    if (side === "right") return { x: n.rect.x + (r[row] ?? n.rect.w - 1), y: along };
    return undefined; // top and bottom: on the rect's edge, as usual
  },
  fitSize(n, text) {
    // Grows (never shrinks), two rows at a time, until its wrapped text fits.
    let h = n.rect.h;
    for (;;) {
      const c = this.contentRect({ ...n, rect: { ...n.rect, h } });
      if (textLines(text, c.w, n.lists === false).length <= c.h || h > 200) return { w: n.rect.w, h };
      h += 2;
    }
  },
  footprint(n) {
    const { l, r } = ellipseRows(n.rect.w, n.rect.h);
    return l.map((lx, i) => ({ x: n.rect.x + lx, y: n.rect.y + i, w: r[i] - lx + 1, h: 1 }));
  },
  hitTest(n, cell) {
    const i = cell.y - n.rect.y;
    if (i < 0 || i >= n.rect.h) return false;
    const { l, r } = ellipseRows(n.rect.w, n.rect.h);
    return cell.x >= n.rect.x + l[i] && cell.x <= n.rect.x + r[i];
  },
  rasterize(n, grid) {
    const style = lineStyle(n.border);
    if (style) {
      const cells = ellipseOutline(n.rect);
      strokePath(grid, [...cells, cells[0]], style, () => style === "single");
      for (const p of cells) grid.soften(p);
    }
    for (const [p, c] of layoutText(n.text, this.contentRect(n), n.align, n.lists === false)) grid.setChar(p, c);
  },
};

/** The smallest circle that holds text `tw` wide and `lines` tall (odd heights; it widens
 * before it grows taller, up to about twice as wide as tall, the roundest). */
export function ellipseFit(tw: number, lines: number): { w: number; h: number } {
  for (let h = Math.max(5, lines + 2 + ((lines + 2) % 2 ? 0 : 1)); ; h += 2) {
    for (let w = Math.max(9, tw + 4); w <= Math.max(tw + 4, 2 * h + 1) + 4 * h; w++) {
      const c = ellipse.contentRect({ rect: { x: 0, y: 0, w, h } } as Node);
      if (c.w >= tw && c.h >= lines) return { w, h };
    }
  }
}

/** Which side of an ellipse an outline cell is on, for connectors (null: a corner or step). */
export function ellipseSide(rect: Rect, p: Point): Side | null {
  const { l, r } = ellipseRows(rect.w, rect.h);
  const i = p.y - rect.y, x = p.x - rect.x;
  if (i === 0 && x > l[0] && x < r[0]) return "top";
  if (i === rect.h - 1 && x > l[i] && x < r[i]) return "bottom";
  const straight = straightRows(rect.w, rect.h);
  if (straight.includes(i) && x === l[i]) return "left";
  if (straight.includes(i) && x === r[i]) return "right";
  return null;
}
