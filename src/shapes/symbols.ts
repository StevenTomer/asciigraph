import { type Point, type Rect, type Side, bottom, right } from "../geometry/geom";
import type { LineStyle, Node } from "../model/types";
import type { CharGrid } from "../render/grid";
import { layoutText } from "../render/textLayout";
import { document as docShape, lineStyle, strokePath, through } from "./more";
import type { ShapeDef } from "./registry";

/**
 * The rest of Mermaid's flowchart shapes, UML components, clouds, and state diagrams' dots:
 *
 *     ┌────────────┐     ╭──╮ ╭──╮          ╱──────────┐    ╱──────────╲     ╱───────────╮
 *   ┌─┤            │   ╭─╯  ╰─╯  ╰─╮       ╱  card     │   │ each order │   <   screen    )
 *   └─┤  payments  │   │ internet  │       │           │   └────────────┘    ╲───────────╯
 *     │            │   ╰─╮ ╭──╮ ╭──╯       └───────────┘
 *   ┌─┤            │     ╰─╯  ╰─╯
 *   └─┤            │                     ╭────────────╮   ┌────────────┐   ┌─┬──────────┐
 *     └────────────┘                     (  archive   (   ├────────────┤   │ │  lined   │
 *                                        ╰────────────╯   │  divided   │   └─┴──────────┘
 *   ┌──┬─────────┐    ╲──────────┐                         └────────────┘
 *   ├──┼─────────┤     >  flag   │      ┌─╮  ╭──╮  ╭─┐               ┌────┐
 *   │  │ storage │    ╱──────────┘      │ ╰──╯  ╰──╯ │          ┌────┘    │
 *   └──┴─────────┘                      │   tape     │     ┌────┘         │
 *                                       ╰─╮  ╭──╮  ╭─┤     │ type it in   │
 *   ╭────────╮  ┌─┬──────────┐            ╰──╯  ╰──╯ ╯     └──────────────┘
 *   ├────────┤  │ │  lined   │
 *   ├────────┤  ╰─┴╮  ╭──╮  ╭╯     ●  ◉   ╭─╮     ╱╲      ╲──────╱    ╲───╱
 *   │  disk  │     ╰──╯  ╰──╯             │╳│    ╱  ╲      ╲    ╱      ╲ ╱
 *   ╰────────╯                            ╰─╯   ╱────╲      ╲  ╱        ╳
 *                                                            ╲╱        ╱ ╲
 *                                                                     ╱───╲
 *
 * (Approximate: each is drawn from its rect by the code below.)
 */

const slashes = (style: LineStyle) => (style === "ascii" ? ["/", "\\"] : ["╱", "╲"]);
const drawText = (n: Node, area: Rect, grid: CharGrid) => {
  for (const [p, c] of layoutText(n.text, area, n.align, n.lists === false)) grid.setChar(p, c);
};
const keepSize = (n: Node) => ({ w: n.rect.w, h: n.rect.h });
const flat = (grid: CharGrid, y: number, x0: number, x1: number, style: LineStyle) => {
  for (let x = x0; x <= x1; x++) grid.stroke({ x, y }, ["left", "right"], style);
};
const rectOutline = (r: Rect): Point[] =>
  through([{ x: r.x, y: r.y }, { x: right(r), y: r.y }, { x: right(r), y: bottom(r) }, { x: r.x, y: bottom(r) }, { x: r.x, y: r.y }]);
const isCorner = (r: Rect) => (p: Point) => (p.x === r.x || p.x === right(r)) && (p.y === r.y || p.y === bottom(r));
const bordered = (n: Node) => n.border !== "none";
const flatSides = (n: Node, side: Side): [number, number] =>
  side === "top" || side === "bottom" ? [n.rect.x + 1, right(n.rect) - 1] : [n.rect.y + 1, bottom(n.rect) - 1];
const perRow = (r: Rect, inset: (i: number) => [number, number]) =>
  Array.from({ length: r.h }, (_, i) => {
    const [a, b] = inset(i);
    return { x: r.x + a, y: r.y + i, w: Math.max(1, r.w - a - b), h: 1 };
  });
const hitRows = (r: Rect, inset: (i: number) => [number, number], p: Point) => {
  const i = p.y - r.y;
  if (i < 0 || i >= r.h) return false;
  const [a, b] = inset(i);
  return p.x >= r.x + a && p.x <= right(r) - b;
};

/** A box outline, rounded at the corners if the border is. */
function boxOutline(n: Node, grid: CharGrid, style: LineStyle, r: Rect = n.rect) {
  strokePath(grid, rectOutline(r), style, (p) => n.border === "rounded" && isCorner(r)(p));
}

// --- boxes with lines inside ------------------------------------------------------------------

/** A box with lines across (rows, from the top) and down (columns, from the left), all the way. */
function linedBox(label: string, rows: number[], cols: number[], rounded = false): ShapeDef {
  const top = rows.length ? Math.max(...rows) : 0, left = cols.length ? Math.max(...cols) : 0;
  return {
    label,
    defaultSize: { w: 16, h: 3 + top },
    minSize: () => ({ w: left + 5, h: top + 3 }),
    hasBorder: bordered,
    contentRect: (n) => ({ x: n.rect.x + left + 2, y: n.rect.y + top + 1, w: Math.max(1, n.rect.w - left - 4), h: Math.max(1, n.rect.h - top - 2) }),
    sideRange: (n, side) =>
      side === "top" || side === "bottom" ? [n.rect.x + left + 1, right(n.rect) - 1] : [n.rect.y + top + 1, bottom(n.rect) - 1],
    fitSize: keepSize,
    rasterize(n, grid) {
      const r = n.rect, style = lineStyle(n.border);
      if (style) {
        strokePath(grid, rectOutline(r), style, (p) => (rounded ? style === "single" : n.border === "rounded") && isCorner(r)(p));
        for (const dy of rows) strokePath(grid, through([{ x: r.x, y: r.y + dy }, { x: right(r), y: r.y + dy }]), style);
        for (const dx of cols) strokePath(grid, through([{ x: r.x + dx, y: r.y }, { x: r.x + dx, y: bottom(r) }]), style);
      }
      drawText(n, this.contentRect(n), grid);
    },
  };
}

export const divided = linedBox("divided", [1], []);
export const lined = linedBox("lined", [], [2]);
export const storage = linedBox("internal storage", [1], [2]);
/** A lined cylinder (disk storage): a database with a second rim. */
export const disk = linedBox("disk", [1, 2], [], true);

/** A document with a line down its left (the document shape's outline, from more.ts). */
export const lineddoc: ShapeDef = {
  ...docShape,
  label: "lined document",
  minSize: () => ({ w: 9, h: 4 }),
  contentRect: (n) => ({ x: n.rect.x + 4, y: n.rect.y + 1, w: Math.max(1, n.rect.w - 6), h: Math.max(1, n.rect.h - 3) }),
  sideRange(n, side) {
    if (side === "top") return [n.rect.x + 3, right(n.rect) - 1];
    return docShape.sideRange(n, side);
  },
  rasterize(n, grid) {
    docShape.rasterize({ ...n, text: "" }, grid);
    const style = lineStyle(n.border);
    if (style) strokePath(grid, through([{ x: n.rect.x + 2, y: n.rect.y }, { x: n.rect.x + 2, y: bottom(n.rect) - 1 }]), style);
    drawText(n, this.contentRect(n), grid);
  },
};

// --- component ---------------------------------------------------------------------------------

/** A UML component: a box with two tabs sticking out of its left side. */
export const component: ShapeDef = {
  label: "component",
  defaultSize: { w: 18, h: 7 },
  minSize: () => ({ w: 9, h: 6 }),
  hasBorder: bordered,
  contentRect: (n) => ({ x: n.rect.x + 4, y: n.rect.y + 1, w: Math.max(1, n.rect.w - 6), h: Math.max(1, n.rect.h - 2) }),
  sideRange(n, side) {
    const r = n.rect;
    if (side === "top" || side === "bottom") return [r.x + 3, right(r) - 1];
    if (side === "right") return [r.y + 1, bottom(r) - 1];
    // Between the tabs (or, with no room there, at the first tab).
    return r.y + 3 <= bottom(r) - 3 ? [r.y + 3, bottom(r) - 3] : [r.y + 1, r.y + 1];
  },
  anchor(n, side, along) {
    const r = n.rect;
    if (side !== "left") return undefined;
    return { x: along >= r.y + 3 && along <= bottom(r) - 3 ? r.x + 2 : r.x, y: along };
  },
  fitSize: keepSize,
  footprint: (n) => [
    { x: n.rect.x + 2, y: n.rect.y, w: n.rect.w - 2, h: n.rect.h },
    { x: n.rect.x, y: n.rect.y + 1, w: 2, h: 2 },
    { x: n.rect.x, y: bottom(n.rect) - 2, w: 2, h: 2 },
  ],
  rasterize(n, grid) {
    const r = n.rect, style = lineStyle(n.border);
    if (style) {
      boxOutline(n, grid, style, { x: r.x + 2, y: r.y, w: r.w - 2, h: r.h });
      for (const y of [r.y + 1, bottom(r) - 2]) {
        strokePath(grid, through([{ x: r.x + 2, y }, { x: r.x, y }, { x: r.x, y: y + 1 }, { x: r.x + 2, y: y + 1 }]), style);
      }
    }
    drawText(n, this.contentRect(n), grid);
  },
};

// --- waves: clouds and paper tape -----------------------------------------------------------

/**
 * A wavy edge from x0 to x1 between rows `up` and `down` (period 6: up for columns 0–3 of each
 * period, down for 3–6, a step in the column where it changes), as cells left to right. It never
 * steps down at its last column.
 */
function wave(x0: number, x1: number, up: number, down: number, startUp = true, phase0 = 0): Point[] {
  const cells: Point[] = [{ x: x0, y: startUp ? up : down }];
  let low = !startUp;
  for (let x = x0 + 1; x <= x1; x++) {
    const phase = (x - x0 + phase0) % 6;
    if (!low && phase === 3 && x < x1) {
      cells.push({ x, y: up }, { x, y: down });
      low = true;
    } else if (low && phase === 0) {
      cells.push({ x, y: down }, { x, y: up });
      low = false;
    } else {
      cells.push({ x, y: low ? down : up });
    }
  }
  return cells;
}

/** Paper tape: wavy top and bottom (the same wave), straight sides. */
export function tapeOutline(r: Rect): Point[] {
  const top = wave(r.x, right(r), r.y, r.y + 1);
  const shift = r.h - 2;
  const end = top[top.length - 1];
  return [
    ...top,
    ...through([end, { x: end.x, y: end.y + shift }]).slice(1),
    ...[...top].reverse().slice(1).map((p) => ({ x: p.x, y: p.y + shift })),
    ...through([{ x: r.x, y: r.y + shift }, { x: r.x, y: r.y }]).slice(1, -1),
  ];
}

export const tape: ShapeDef = {
  label: "paper tape",
  defaultSize: { w: 16, h: 5 },
  minSize: () => ({ w: 9, h: 5 }),
  hasBorder: bordered,
  contentRect: (n) => ({ x: n.rect.x + 2, y: n.rect.y + 2, w: Math.max(1, n.rect.w - 4), h: Math.max(1, n.rect.h - 4) }),
  sideRange(n, side) {
    const r = n.rect;
    if (side === "top" || side === "bottom") return [r.x + 1, r.x + 2];
    if (side === "left") return [r.y + 1, bottom(r) - 2];
    const end = wave(r.x, right(r), r.y, r.y + 1).pop()!;
    return [end.y + 1, end.y + r.h - 3];
  },
  anchor(n, side, along) {
    if (side === "bottom") return { x: along, y: bottom(n.rect) - 1 };
    return undefined;
  },
  fitSize: keepSize,
  rasterize(n, grid) {
    const style = lineStyle(n.border);
    if (style) {
      const cells = tapeOutline(n.rect);
      const r = n.rect;
      strokePath(grid, [...cells, cells[0]], style, (p) => style === "single" && p.x !== r.x && p.x !== right(r));
    }
    drawText(n, this.contentRect(n), grid);
  },
};

/** Where a cloud's bumps go: [first, last] columns of each (both corners), evenly from x0+2 to
 * x1-2, a column apart. */
export function cloudBumps(r: Rect): [number, number][] {
  const from = r.x + 2, span = r.w - 4;
  // (Two at least: with one, it would be a circle.)
  const n = Math.max(2, Math.floor((span + 1) / 6));
  // n bumps and n-1 gaps of one column fill the span: share what's left among the bumps.
  const widths = Array.from({ length: n }, (_, i) => Math.floor((span - (n - 1)) / n) + (i < (span - (n - 1)) % n ? 1 : 0));
  const out: [number, number][] = [];
  let x = from;
  for (const w of widths) {
    out.push([x, x + w - 1]);
    x += w + 1;
  }
  return out;
}

/** Cells along an edge from a to b on row `base`, rising (or dropping) to row `bump` over each
 * interval, the corners in the interval's first and last columns. */
function bumpy(a: number, b: number, base: number, bump: number, bumps: [number, number][]): Point[] {
  const cells: Point[] = [];
  for (let x = a; x <= b; x++) {
    const start = bumps.find(([s]) => s === x), end = bumps.find(([, e]) => e === x);
    if (start) cells.push({ x, y: base }, { x, y: bump });
    else if (end) cells.push({ x, y: bump }, { x, y: base });
    else cells.push({ x, y: bumps.some(([s, e]) => x > s && x < e) ? bump : base });
  }
  return cells;
}

/** A cloud: bumps along the top and bottom, rounded corners. */
export function cloudOutline(r: Rect): Point[] {
  const x0 = r.x, x1 = right(r), y0 = r.y, y1 = bottom(r), bumps = cloudBumps(r);
  const top = bumpy(x0, x1, y0 + 1, y0, bumps);
  const bot = bumpy(x0, x1, y1 - 1, y1, bumps).reverse();
  return [...top, ...through([{ x: x1, y: y0 + 1 }, { x: x1, y: y1 - 1 }]).slice(1, -1), ...bot, ...through([{ x: x0, y: y1 - 1 }, { x: x0, y: y0 + 1 }]).slice(1, -1)];
}

export const cloud: ShapeDef = {
  label: "cloud",
  defaultSize: { w: 17, h: 5 },
  minSize: () => ({ w: 11, h: 5 }),
  hasBorder: bordered,
  contentRect: (n) => ({ x: n.rect.x + 2, y: n.rect.y + 2, w: Math.max(1, n.rect.w - 4), h: Math.max(1, n.rect.h - 4) }),
  sideRange(n, side) {
    const r = n.rect;
    if (side === "left" || side === "right") return [r.y + 2, Math.max(r.y + 2, bottom(r) - 2)];
    // The flat top (or bottom) of the first bump.
    const [s0, e0] = cloudBumps(r)[0];
    return e0 - s0 >= 2 ? [s0 + 1, e0 - 1] : [s0, s0];
  },
  fitSize: keepSize,
  footprint: (n) => [{ x: n.rect.x, y: n.rect.y + 1, w: n.rect.w, h: n.rect.h - 2 }, { x: n.rect.x + 2, y: n.rect.y, w: n.rect.w - 4, h: n.rect.h }],
  rasterize(n, grid) {
    const style = lineStyle(n.border);
    if (style) {
      const cells = cloudOutline(n.rect);
      strokePath(grid, [...cells, cells[0]], style, () => style === "single");
    }
    drawText(n, this.contentRect(n), grid);
  },
};

// --- manual input -----------------------------------------------------------------------------

/** Where a manual input's top steps up (two steps, a third of the way along each). */
const steps = (r: Rect) => [r.x + Math.round(r.w / 3), r.x + Math.round((2 * r.w) / 3)];

export function manualOutline(r: Rect): Point[] {
  const [s1, s2] = steps(r);
  return through([
    { x: r.x, y: r.y + 2 }, { x: s1, y: r.y + 2 }, { x: s1, y: r.y + 1 }, { x: s2, y: r.y + 1 }, { x: s2, y: r.y },
    { x: right(r), y: r.y }, { x: right(r), y: bottom(r) }, { x: r.x, y: bottom(r) }, { x: r.x, y: r.y + 2 },
  ]).slice(0, -1);
}

export const manual: ShapeDef = {
  label: "manual input",
  defaultSize: { w: 16, h: 5 },
  minSize: () => ({ w: 9, h: 5 }),
  hasBorder: bordered,
  contentRect: (n) => ({ x: n.rect.x + 2, y: n.rect.y + 3, w: Math.max(1, n.rect.w - 4), h: Math.max(1, n.rect.h - 4) }),
  sideRange(n, side) {
    const r = n.rect;
    if (side === "top") return [steps(r)[1] + 1, right(r) - 1];
    if (side === "left") return [r.y + 3, bottom(r) - 1];
    return flatSides(n, side);
  },
  fitSize: keepSize,
  footprint(n) {
    const r = n.rect, [s1, s2] = steps(r);
    return [{ x: s2, y: r.y, w: right(r) - s2 + 1, h: 1 }, { x: s1, y: r.y + 1, w: right(r) - s1 + 1, h: 1 }, { x: r.x, y: r.y + 2, w: r.w, h: r.h - 2 }];
  },
  rasterize(n, grid) {
    const style = lineStyle(n.border);
    if (style) {
      const cells = manualOutline(n.rect);
      strokePath(grid, [...cells, cells[0]], style, (p) => n.border === "rounded" && isCorner(n.rect)(p));
    }
    drawText(n, this.contentRect(n), grid);
  },
};

// --- shapes with slanted or curved corners ----------------------------------------------------

/** A card: a box with its top-left corner cut off (two rows deep). */
export const card: ShapeDef = {
  label: "card",
  defaultSize: { w: 16, h: 4 },
  minSize: () => ({ w: 6, h: 3 }),
  hasBorder: bordered,
  contentRect: (n) => ({ x: n.rect.x + 2, y: n.rect.y + 1, w: Math.max(1, n.rect.w - 4), h: Math.max(1, n.rect.h - 2) }),
  sideRange(n, side) {
    const r = n.rect;
    if (side === "top") return [r.x + 2, right(r) - 1];
    if (side === "left") return r.y + 2 <= bottom(r) - 1 ? [r.y + 2, bottom(r) - 1] : [r.y + 1, r.y + 1];
    return flatSides(n, side);
  },
  fitSize: keepSize,
  footprint: (n) => perRow(n.rect, (i) => [i === 0 ? 1 : 0, 0]),
  hitTest: (n, p) => hitRows(n.rect, (i) => [i === 0 ? 1 : 0, 0], p),
  rasterize(n, grid) {
    const r = n.rect, style = lineStyle(n.border);
    if (style) {
      const [up] = slashes(style);
      grid.setChar({ x: r.x + 1, y: r.y }, up);
      grid.setChar({ x: r.x, y: r.y + 1 }, up);
      const round = (p: Point) => n.border === "rounded" && isCorner(r)(p);
      strokePath(grid, through([{ x: r.x + 2, y: r.y }, { x: right(r), y: r.y }, { x: right(r), y: bottom(r) }, { x: r.x, y: bottom(r) }, { x: r.x, y: r.y + 2 }]), style, round);
      // The left side reaches up to the slash.
      grid.stroke({ x: r.x, y: r.y + 2 }, ["top"], style);
    }
    drawText(n, this.contentRect(n), grid);
  },
};

/** A loop limit: a box with both top corners cut off. */
export const loop: ShapeDef = {
  label: "loop limit",
  defaultSize: { w: 16, h: 3 },
  minSize: () => ({ w: 6, h: 3 }),
  hasBorder: bordered,
  contentRect: (n) => ({ x: n.rect.x + 2, y: n.rect.y + 1, w: Math.max(1, n.rect.w - 4), h: Math.max(1, n.rect.h - 2) }),
  sideRange(n, side) {
    if (side === "top") return [n.rect.x + 2, right(n.rect) - 2];
    return flatSides(n, side);
  },
  fitSize: keepSize,
  footprint: (n) => perRow(n.rect, (i) => (i === 0 ? [1, 1] : [0, 0])),
  hitTest: (n, p) => hitRows(n.rect, (i) => (i === 0 ? [1, 1] : [0, 0]), p),
  rasterize(n, grid) {
    const r = n.rect, style = lineStyle(n.border);
    if (style) {
      const [up, down] = slashes(style);
      grid.setChar({ x: r.x + 1, y: r.y }, up);
      grid.setChar({ x: right(r) - 1, y: r.y }, down);
      flat(grid, r.y, r.x + 2, right(r) - 2, style);
      strokePath(grid, through([{ x: r.x, y: r.y + 1 }, { x: r.x, y: bottom(r) }, { x: right(r), y: bottom(r) }, { x: right(r), y: r.y + 1 }]), style, (p) => n.border === "rounded" && isCorner(r)(p));
      // The sides reach up to the slashes.
      grid.stroke({ x: r.x, y: r.y + 1 }, ["top"], style);
      grid.stroke({ x: right(r), y: r.y + 1 }, ["top"], style);
    }
    drawText(n, this.contentRect(n), grid);
  },
};

const middle = (r: Rect) => Math.floor(r.h / 2);
const odd = (r: Rect) => ({ ...r, h: r.h % 2 ? r.h : r.h + 1 });

/** A display: pointed on the left (like a decision), rounded on the right (like start/end). */
export const display: ShapeDef = {
  label: "display",
  defaultSize: { w: 16, h: 3 },
  minSize: () => ({ w: 7, h: 3 }),
  normalize: (r) => ({ ...odd(r), w: Math.max(r.w, middle(odd(r)) + 5) }),
  hasBorder: bordered,
  contentRect(n) {
    const r = n.rect, m = middle(r);
    return { x: r.x + m + 2, y: r.y + 1, w: Math.max(1, r.w - m - 4), h: Math.max(1, r.h - 2) };
  },
  sideRange(n, side) {
    const r = n.rect, m = middle(r);
    if (side === "left") return [r.y + m, r.y + m];
    if (side === "right") return [r.y + 1, bottom(r) - 1];
    return [r.x + m + 1, right(r) - 1];
  },
  fitSize: keepSize,
  footprint: (n) => perRow(n.rect, (i) => [Math.abs(i - middle(n.rect)), 0]),
  hitTest: (n, p) => hitRows(n.rect, (i) => [Math.abs(i - middle(n.rect)), 0], p),
  rasterize(n, grid) {
    const r = n.rect, m = middle(r), style = lineStyle(n.border);
    if (style) {
      const [up, down] = slashes(style);
      for (let i = 0; i < r.h; i++) {
        const d = Math.abs(i - m), y = r.y + i;
        grid.setChar({ x: r.x + d, y }, i === m ? "<" : i < m ? up : down);
        if (i > 0 && i < r.h - 1) grid.setChar({ x: right(r), y }, ")");
      }
      flat(grid, r.y, r.x + m + 1, right(r) - 1, style);
      flat(grid, bottom(r), r.x + m + 1, right(r) - 1, style);
      grid.stroke({ x: right(r), y: r.y }, ["left", "bottom"], style, style === "single");
      grid.stroke({ x: right(r), y: bottom(r) }, ["left", "top"], style, style === "single");
    }
    drawText(n, this.contentRect(n), grid);
  },
};

/** Stored data: ( on both sides, curving the same way. */
export const stored: ShapeDef = {
  label: "stored data",
  defaultSize: { w: 16, h: 3 },
  minSize: () => ({ w: 6, h: 3 }),
  hasBorder: bordered,
  contentRect: (n) => ({ x: n.rect.x + 2, y: n.rect.y + 1, w: Math.max(1, n.rect.w - 4), h: Math.max(1, n.rect.h - 2) }),
  sideRange: flatSides,
  fitSize: keepSize,
  rasterize(n, grid) {
    const r = n.rect, style = lineStyle(n.border);
    if (style) {
      const round = style === "single";
      grid.stroke({ x: r.x, y: r.y }, ["right", "bottom"], style, round);
      grid.stroke({ x: right(r), y: r.y }, ["left", "bottom"], style, round);
      grid.stroke({ x: r.x, y: bottom(r) }, ["right", "top"], style, round);
      grid.stroke({ x: right(r), y: bottom(r) }, ["left", "top"], style, round);
      flat(grid, r.y, r.x + 1, right(r) - 1, style);
      flat(grid, bottom(r), r.x + 1, right(r) - 1, style);
      for (let y = r.y + 1; y < bottom(r); y++) {
        grid.setChar({ x: r.x, y }, "(");
        grid.setChar({ x: right(r), y }, "(");
      }
    }
    drawText(n, this.contentRect(n), grid);
  },
};

/** Mermaid's "odd" shape (>text]): a flag, notched on the left. */
export const flag: ShapeDef = {
  label: "flag",
  defaultSize: { w: 16, h: 3 },
  minSize: () => ({ w: 7, h: 3 }),
  normalize: (r) => ({ ...odd(r), w: Math.max(r.w, middle(odd(r)) + 5) }),
  hasBorder: bordered,
  contentRect(n) {
    const r = n.rect, m = middle(r);
    return { x: r.x + m + 2, y: r.y + 1, w: Math.max(1, r.w - m - 4), h: Math.max(1, r.h - 2) };
  },
  sideRange(n, side) {
    const r = n.rect, m = middle(r);
    if (side === "left") return [r.y + m, r.y + m];
    if (side === "right") return [r.y + 1, bottom(r) - 1];
    return [r.x + 1, right(r) - 1];
  },
  anchor(n, side, along) {
    if (side === "left") return { x: n.rect.x + middle(n.rect), y: along };
    return undefined;
  },
  fitSize: keepSize,
  rasterize(n, grid) {
    const r = n.rect, m = middle(r), style = lineStyle(n.border);
    if (style) {
      const [up, down] = slashes(style);
      for (let i = 0; i < r.h; i++) {
        const d = m - Math.abs(i - m);
        grid.setChar({ x: r.x + d, y: r.y + i }, i === m ? ">" : i < m ? down : up);
      }
      strokePath(grid, through([{ x: r.x + 1, y: r.y }, { x: right(r), y: r.y }, { x: right(r), y: bottom(r) }, { x: r.x + 1, y: bottom(r) }]), style, (p) => n.border === "rounded" && isCorner(r)(p));
    }
    drawText(n, this.contentRect(n), grid);
  },
};

// --- triangles and the hourglass --------------------------------------------------------------

const triInset = (r: Rect, i: number, down: boolean): [number, number] => {
  const d = down ? i : r.h - 1 - i;
  return [d, d];
};

function triangle(label: string, down: boolean): ShapeDef {
  /** The rows text goes in: the wider half. */
  const band = (r: Rect) => (down ? [1, Math.max(1, Math.floor((r.h - 1) / 2))] : [Math.ceil(r.h / 2), r.h - 2]);
  return {
    label,
    defaultSize: { w: 10, h: 5 },
    minSize: () => ({ w: 6, h: 3 }),
    normalize: (r) => ({ ...r, w: 2 * r.h }),
    hasBorder: bordered,
    contentRect(n) {
      const r = n.rect, [a, b] = band(r);
      const narrowest = down ? b : a, d = down ? narrowest : r.h - 1 - narrowest;
      return { x: r.x + d + 2, y: r.y + a, w: Math.max(1, r.w - 2 * d - 4), h: Math.max(1, b - a + 1) };
    },
    sideRange(n, side) {
      const r = n.rect, h = r.h;
      if (side === (down ? "bottom" : "top")) return [r.x + h - 1, r.x + h];
      if (side === "top" || side === "bottom") return [r.x + 1, right(r) - 1];
      return [r.y + 1, bottom(r) - 1];
    },
    anchor(n, side, along) {
      const r = n.rect, [d] = triInset(r, along - r.y, down);
      if (side === "left") return { x: r.x + d, y: along };
      if (side === "right") return { x: right(r) - d, y: along };
      return undefined;
    },
    fitSize: keepSize,
    footprint: (n) => perRow(n.rect, (i) => triInset(n.rect, i, down)),
    hitTest: (n, p) => hitRows(n.rect, (i) => triInset(n.rect, i, down), p),
    rasterize(n, grid) {
      const r = n.rect, style = lineStyle(n.border);
      if (style) {
        const [up, dn] = slashes(style);
        for (let i = 0; i < r.h; i++) {
          const [d] = triInset(r, i, down), y = r.y + i;
          grid.setChar({ x: r.x + d, y }, down ? dn : up);
          grid.setChar({ x: right(r) - d, y }, down ? up : dn);
        }
        const flatRow = down ? r.y : bottom(r);
        flat(grid, flatRow, r.x + 1, right(r) - 1, style);
      }
      drawText(n, this.contentRect(n), grid);
    },
  };
}

/** Extract: a triangle pointing up. Merge: pointing down. */
export const extract = triangle("extract", false);
export const merge = triangle("merge", true);

/** Collate: an hourglass (two triangles point to point, crossing at ╳). */
export const collate: ShapeDef = {
  label: "collate",
  defaultSize: { w: 7, h: 7 },
  minSize: () => ({ w: 5, h: 5 }),
  normalize: (r) => {
    const h = r.h % 2 ? r.h : r.h + 1;
    return { ...r, h, w: h };
  },
  hasBorder: bordered,
  contentRect: (n) => ({ x: n.rect.x + Math.floor(n.rect.w / 2), y: n.rect.y + Math.floor(n.rect.h / 2), w: 1, h: 1 }),
  sideRange(n, side) {
    const r = n.rect, m = Math.floor(r.h / 2);
    if (side === "top" || side === "bottom") return [r.x + 1, right(r) - 1];
    return [r.y + m, r.y + m];
  },
  anchor(n, side, along) {
    const m = Math.floor(n.rect.w / 2);
    if (side === "left" || side === "right") return { x: n.rect.x + m, y: along };
    return undefined;
  },
  fitSize: keepSize,
  footprint: (n) => perRow(n.rect, (i) => {
    const m = Math.floor(n.rect.h / 2), d = m - Math.abs(i - m);
    return [d, d];
  }),
  rasterize(n, grid) {
    const r = n.rect, m = Math.floor(r.h / 2), style = lineStyle(n.border);
    if (!style) return;
    const [up, down] = slashes(style);
    for (let i = 0; i < r.h; i++) {
      const d = m - Math.abs(i - m), y = r.y + i;
      if (i === m) grid.setChar({ x: r.x + m, y }, "╳");
      else {
        grid.setChar({ x: r.x + d, y }, i < m ? down : up);
        grid.setChar({ x: right(r) - d, y }, i < m ? up : down);
      }
    }
    flat(grid, r.y, r.x + 1, right(r) - 1, style);
    flat(grid, bottom(r), r.x + 1, right(r) - 1, style);
  },
};

// --- small symbols ----------------------------------------------------------------------------

/** Summary: a small circle with a cross in it. */
export const summary: ShapeDef = {
  label: "summary",
  defaultSize: { w: 3, h: 3 },
  minSize: () => ({ w: 3, h: 3 }),
  normalize: (r) => ({ ...r, w: 3, h: 3 }),
  hasBorder: bordered,
  contentRect: (n) => ({ x: n.rect.x + 1, y: n.rect.y + 1, w: 1, h: 1 }),
  sideRange: flatSides,
  fitSize: keepSize,
  rasterize(n, grid) {
    const style = lineStyle(n.border) ?? "single";
    strokePath(grid, rectOutline(n.rect), style, () => style === "single");
    grid.setChar({ x: n.rect.x + 1, y: n.rect.y + 1 }, "╳");
  },
};

/** A dot (a state diagram's start, a junction) or a ringed dot (an end): connectors join it on
 * any side. */
function dotShape(label: string, glyph: string): ShapeDef {
  return {
    label,
    defaultSize: { w: 1, h: 1 },
    minSize: () => ({ w: 1, h: 1 }),
    normalize: (r) => ({ ...r, w: 1, h: 1 }),
    hasBorder: () => false,
    contentRect: (n) => n.rect,
    sideRange: (n, side) => (side === "top" || side === "bottom" ? [n.rect.x, n.rect.x] : [n.rect.y, n.rect.y]),
    fitSize: () => ({ w: 1, h: 1 }),
    rasterize(n, grid) {
      grid.setChar({ x: n.rect.x, y: n.rect.y }, glyph);
    },
  };
}

export const dot = dotShape("dot", "●");
export const ring = dotShape("end dot", "◉");
