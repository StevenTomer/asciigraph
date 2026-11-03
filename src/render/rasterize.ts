import { type Point, type Rect, type Side, OPPOSITE, contains, key, stepSide } from "../geometry/geom";
import { paintOrder, within } from "../model/containment";
import type { Diagram } from "../model/types";
import { type ResolvedEdge, resolveEdge } from "../routing/endpoints";
import { Occupancy } from "../routing/occupancy";
import { renderText } from "./markdown";
import { chars } from "./textLayout";
import { footprint, shapeOf } from "../shapes/registry";
import { CharGrid } from "./grid";

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
      const neighbour = cells.length > 1 ? (end === cells[0] ? cells[1] : cells[cells.length - 2]) : null;
      // Which way the line runs as it reaches this end.
      const pointing: Side = anchor.dir
        ? OPPOSITE[anchor.dir]
        : neighbour ? stepSide(neighbour, end) : "right";
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
    // Labels go on after every connector's lines, so a later one doesn't draw over them.
    labels.push(() => {
      const placed = placeLabel(r.cells, edge.label ?? "", edge.labelAt);
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
  labels.forEach((f) => f());

  return { grid, edges, edgeCells };
}

/**
 * Where a connector's label goes: inline on a horizontal run it fits on, with a space each side
 * (`── yes ──►`), otherwise beside a vertical run. `at` (0–1 along the connector) puts it near
 * that point; without it, the longest horizontal run that fits (or the middle of the longest
 * vertical one). Without a label, `rect` is where one would go (for the editor). One line.
 */
export function placeLabel(cells: Point[], label: string, at?: number): { rect: Rect; chars: [Point, string][] } {
  // Lines as shown (Markdown lists rendered). A block of several lines is centred on the line.
  const rendered = label ? renderText(label, 1000) : { lines: [], list: false };
  const lines = rendered.lines.map((l) => chars(l.replace(/\s+$/, "")));
  const len = Math.max(1, ...lines.map((l) => l.length));
  const n = Math.max(1, lines.length);
  /** Each line's characters from `x0`: centred in the block, or left-aligned for lists. */
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
  const inline = (run: { a: number; b: number }, centre?: number) => {
    const lo = Math.max(run.a, 1), hi = Math.min(run.b, cells.length - 2);
    const minX = Math.min(cells[lo].x, cells[hi].x), maxX = Math.max(cells[lo].x, cells[hi].x);
    // Centred on `centre` (or the run), whichever way the run heads, with a space either side.
    const x0 = centre === undefined
      ? Math.floor((minX + maxX + 1 - len) / 2)
      : Math.max(minX + 1, Math.min(maxX - len, centre - Math.floor((len - 1) / 2)));
    const y = cells[lo].y, top = y - Math.floor((n - 1) / 2);
    const out: [Point, string][] = [];
    if (lines.length) {
      // Blank the connector under the text on its row (a space each side), then the text.
      const mid = lines[y - top];
      const left = rendered.list ? x0 : x0 + Math.floor((len - mid.length) / 2);
      for (let x = left - 1; x <= left + mid.length; x++) out.push([{ x, y }, " "]);
      place(x0, top, out);
    }
    return { rect: { x: x0, y: top, w: len, h: n }, chars: out };
  };
  const beside = (cell: Point) => {
    const x0 = cell.x + 2, top = cell.y - Math.floor((n - 1) / 2);
    const out: [Point, string][] = [];
    place(x0, top, out);
    return { rect: { x: x0, y: top, w: len, h: n }, chars: out };
  };

  if (at !== undefined && cells.length > 2) {
    const k = Math.max(1, Math.min(cells.length - 2, Math.round(at * (cells.length - 1))));
    const run = runs.find((r) => r.horizontal && r.a <= k && k <= r.b && room(r) >= len + 2);
    return run ? inline(run, cells[k].x) : beside(cells[k]);
  }
  const fits = runs.filter((r) => r.horizontal && room(r) >= len + 2).sort((p, q) => room(q) - room(p))[0];
  if (fits) return inline(fits);
  const vertical = runs.filter((r) => !r.horizontal || r.a === r.b).sort((p, q) => q.b - q.a - (p.b - p.a))[0] ?? runs[0];
  return beside(cells[Math.floor((vertical.a + vertical.b) / 2)]);
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

