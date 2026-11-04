import { type Point, type Rect, type Side, OPPOSITE, contains, key, stepSide } from "../geometry/geom";
import { paintOrder, within } from "../model/containment";
import type { Diagram } from "../model/types";
import { type ResolvedEdge, resolveEdge } from "../routing/endpoints";
import { Occupancy } from "../routing/occupancy";
import { renderText } from "./markdown";
import { chars } from "./textLayout";
import { footprint, shapeOf } from "../shapes/registry";
import { CharGrid, cellGlyph } from "./grid";

export interface Rendered {
  grid: CharGrid;
  /** Each edge's computed path, for hit-testing and handles. */
  edges: Map<string, ResolvedEdge>;
  /** Which edge is visible in each cell ("x,y"), for clicking on connectors. */
  edgeCells: Map<string, string>;
}

/**
 * Draw the diagram into a character grid:
 *  1. nodes in paint order (containers behind their contents), each blanking its rect first:
 *     nodes are opaque;
 *  2. connectors on top, with junctions where they meet borders (┴ ├ …) and arrowheads; except
 *     where a connector passes behind a node that contains neither of its ends. So a connector
 *     inside a container shows, and one crossing the container's border joins it (┼).
 */
export function rasterize(d: Diagram, quick = false): Rendered {
  const grid = new CharGrid();
  const edges = new Map<string, ResolvedEdge>();
  const edgeCells = new Map<string, string>();

  for (const id of paintOrder(d)) {
    const node = d.nodes[id];
    for (const r of footprint(node)) grid.clear(r);
    shapeOf(node).rasterize(node, grid);
  }

  const occupancy = new Occupancy();
  const labels: (() => void)[] = [];
  for (const edge of Object.values(d.edges)) {
    const r = resolveEdge(d, edge, occupancy, quick);
    edges.set(edge.id, r);
    const { cells } = r;
    const style = edge.line;
    const hiders = hidingNodes(d, r);
    const hidden = (p: Point) => hiders.some((rect) => contains(rect, p));
    for (const c of cells) if (!hidden(c)) edgeCells.set(key(c), edge.id);

    for (let k = 1; k < cells.length; k++) {
      const a = cells[k - 1], b = cells[k];
      const dir = stepSide(a, b);
      if (!hidden(a)) grid.stroke(a, dir, style);
      if (!hidden(b)) grid.stroke(b, OPPOSITE[dir], style);
    }
    for (const [anchor, arrow, end] of [
      [r.from, edge.arrows.start, cells[0]],
      [r.to, edge.arrows.end, cells[cells.length - 1]],
    ] as const) {
      if (hidden(end)) continue;
      const neighbor = cells.length > 1 ? (end === cells[0] ? cells[1] : cells[cells.length - 2]) : null;
      // Which way the line runs as it reaches this end.
      const pointing: Side = anchor.dir
        ? OPPOSITE[anchor.dir]
        : neighbor ? stepSide(neighbor, end) : "right";
      if (arrow) {
        grid.setArrow(end, pointing, style);
      } else if (anchor.dir) {
        // Run the line into the border and join it there.
        grid.stroke(end, OPPOSITE[anchor.dir], style);
        const border = anchor.border;
        const c = border && grid.get(border);
        if (border && c && c.mask && c.ch === undefined) grid.stroke(border, anchor.dir, style);
      } else if (cells.length === 1) {
        grid.stroke(end, ["left", "right"], style);
      }
    }
    // Labels go on after every connector's lines, so a later one doesn't draw over them; each
    // keeps clear of other labels, boxes and other connectors (not on a trunk it shares).
    labels.push(() => {
      const mine = new Set(r.cells.map(key));
      const canUse = (p: Point, onLine: boolean) => {
        const k = key(p);
        if (labelCells.has(k)) return false;
        const c = grid.get(p);
        if (!c || cellGlyph(c, false) === "") return true;
        return onLine && mine.has(k) && pathUse.get(k) === 1 && c.ch === undefined;
      };
      const placed = placeLabel(r.cells, edge.label ?? "", edge.labelAt, canUse);
      if (edge.label) {
        for (let y = placed.rect.y; y < placed.rect.y + placed.rect.h; y++) {
          for (let x = placed.rect.x - 1; x <= placed.rect.x + placed.rect.w; x++) labelCells.add(`${x},${y}`);
        }
      }
      r.label = placed.rect;
      for (const [p, ch] of placed.chars) {
        if (hidden(p)) continue;
        grid.setChar(p, ch);
      }
      // The whole label block is the connector's, for clicking (gaps between words too).
      if (edge.label) {
        const b = placed.rect;
        for (let y = b.y; y < b.y + b.h; y++) {
          for (let x = b.x; x < b.x + b.w; x++) if (!hidden({ x, y })) edgeCells.set(`${x},${y}`, edge.id);
        }
      }
    });
  }
  // How many connectors run through each cell (a shared trunk has more than one).
  const pathUse = new Map<string, number>();
  for (const r of edges.values()) for (const k of new Set(r.cells.map(key))) pathUse.set(k, (pathUse.get(k) ?? 0) + 1);
  const labelCells = new Set<string>();
  labels.forEach((f) => f());

  return { grid, edges, edgeCells };
}

/**
 * Where a connector's label goes: inline on a horizontal run it fits on, with a space each side
 * (`── yes ──►`), otherwise beside a vertical run. `at` (0–1 along the connector) puts it near
 * that point; without it, the longest horizontal run that fits (or the middle of the longest
 * vertical one). Without a label, `rect` is where one would go (for the editor). One line.
 */
export function placeLabel(
  cells: Point[], label: string, at?: number,
  /** Whether label text may go in a cell; `onLine`: the cell is on the label's own row of an
   * inline label, where covering this connector's own line is fine. */
  canUse: (p: Point, onLine: boolean) => boolean = () => true,
): { rect: Rect; chars: [Point, string][] } {
  // Lines as shown (Markdown lists rendered). A block of several lines is centered on the line.
  const rendered = label ? renderText(label, 1000) : { lines: [], list: false };
  const lines = rendered.lines.map((l) => chars(l.replace(/\s+$/, "")));
  const len = Math.max(1, ...lines.map((l) => l.length));
  const n = Math.max(1, lines.length);
  type Placed = { rect: Rect; chars: [Point, string][]; line?: number };
  /** Each line's characters from `x0`: centered in the block, or left-aligned for lists. */
  const place = (x0: number, top: number, out: [Point, string][]) => {
    lines.forEach((l, i) => {
      const left = rendered.list ? x0 : x0 + Math.floor((len - l.length) / 2);
      l.forEach((c, j) => out.push([{ x: left + j, y: top + i }, c]));
    });
  };
  // Straight runs: [first index, last index].
  const runs: { a: number; b: number; horizontal: boolean }[] = [];
  for (let i = 0; i < cells.length; ) {
    let j = i;
    const horizontal = cells[i + 1]?.y === cells[i].y;
    while (j + 1 < cells.length && (horizontal ? cells[j + 1].y === cells[i].y : cells[j + 1].x === cells[i].x)) j++;
    runs.push({ a: i, b: j, horizontal: horizontal && j > i });
    i = j === i ? i + 1 : j;
  }
  // Leave the ends alone (arrowheads, junctions): only inner cells take text.
  const room = (r: { a: number; b: number }) => Math.min(r.b, cells.length - 2) - Math.max(r.a, 1) + 1;
  const inline = (run: { a: number; b: number }, center?: number): Placed => {
    const lo = Math.max(run.a, 1), hi = Math.min(run.b, cells.length - 2);
    const minX = Math.min(cells[lo].x, cells[hi].x), maxX = Math.max(cells[lo].x, cells[hi].x);
    // Centered on `center` (or the run), whichever way the run heads, with a space either side.
    const x0 = center === undefined
      ? Math.floor((minX + maxX + 1 - len) / 2)
      : Math.max(minX + 1, Math.min(maxX - len, center - Math.floor((len - 1) / 2)));
    const y = cells[lo].y, top = y - Math.floor((n - 1) / 2);
    const out: [Point, string][] = [];
    if (lines.length) {
      // Blank the connector under the text on its row (a space each side), then the text.
      const mid = lines[y - top];
      const left = rendered.list ? x0 : x0 + Math.floor((len - mid.length) / 2);
      for (let x = left - 1; x <= left + mid.length; x++) out.push([{ x, y }, " "]);
      place(x0, top, out);
    }
    return { rect: { x: x0, y: top, w: len, h: n }, chars: out, line: y };
  };
  /** Beside a cell of a vertical stretch: to its right, or to its left. */
  const beside = (cell: Point, side: "right" | "left" = "right"): Placed => {
    const x0 = side === "right" ? cell.x + 2 : cell.x - 1 - len, top = cell.y - Math.floor((n - 1) / 2);
    const out: [Point, string][] = [];
    place(x0, top, out);
    return { rect: { x: x0, y: top, w: len, h: n }, chars: out };
  };
  /** Clear of other labels, boxes and connectors (and, inline, only on its own line). */
  const fine = (pl: Placed) => pl.chars.every(([p]) => canUse(p, p.y === pl.line));
  /** Positions along a run, from its middle outwards. */
  const outward = (lo: number, hi: number) => {
    const mid = Math.floor((lo + hi) / 2), out: number[] = [];
    for (let k = 0; mid - k >= lo || mid + k <= hi; k++) {
      if (mid + k <= hi) out.push(mid + k);
      if (k && mid - k >= lo) out.push(mid - k);
    }
    return out;
  };

  if (at !== undefined && cells.length > 2) {
    // Dragged here: as near that spot as it fits cleanly, else right there anyway.
    const k = Math.max(1, Math.min(cells.length - 2, Math.round(at * (cells.length - 1))));
    const run = runs.find((r) => r.horizontal && r.a <= k && k <= r.b && room(r) >= len + 2);
    const options = run ? [inline(run, cells[k].x)] : [beside(cells[k]), beside(cells[k], "left")];
    return options.find(fine) ?? options[0];
  }
  // Inline on a horizontal stretch (the roomiest first, middle outwards)…
  const horizontal = runs.filter((r) => r.horizontal && room(r) >= len + 2).sort((p, q) => room(q) - room(p));
  for (const r of horizontal) {
    const centered = inline(r);
    if (fine(centered)) return centered;
    const lo = Math.max(r.a, 1), hi = Math.min(r.b, cells.length - 2);
    for (const k of outward(lo, hi)) {
      const pl = inline(r, cells[k].x);
      if (fine(pl)) return pl;
    }
  }
  // …else beside a vertical stretch (the longest first, middle outwards, right then left)…
  const vertical = runs.filter((r) => !r.horizontal || r.a === r.b).sort((p, q) => q.b - q.a - (p.b - p.a));
  for (const r of vertical) {
    for (const k of outward(Math.max(r.a, 1), Math.min(r.b, cells.length - 2))) {
      for (const side of ["right", "left"] as const) {
        const pl = beside(cells[k], side);
        if (fine(pl)) return pl;
      }
    }
  }
  // …else where it would have gone regardless.
  if (horizontal[0]) return inline(horizontal[0]);
  const v = vertical[0] ?? runs[0];
  return beside(cells[Math.floor((v.a + v.b) / 2)]);
}

/** Rects of the nodes that hide an edge: all but those containing one of its ends. */
function hidingNodes(d: Diagram, r: ResolvedEdge): Rect[] {
  const holds = (rect: Rect, anchor: ResolvedEdge["from"]) => {
    const n = anchor.node ? d.nodes[anchor.node] : undefined;
    return n ? within(n.rect, rect) : contains(rect, anchor.cell);
  };
  return d.order
    .filter((id) => !holds(d.nodes[id].rect, r.from) && !holds(d.nodes[id].rect, r.to))
    .flatMap((id) => footprint(d.nodes[id]));
}

/** Plain text of the whole diagram. */
export function diagramToText(d: Diagram, ascii = false): string {
  return rasterize(d).grid.toText(null, ascii);
}

