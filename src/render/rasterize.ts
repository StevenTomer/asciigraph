import { type Point, type Rect, type Side, OPPOSITE, contains, key, stepSide } from "../geometry/geom";
import { paintOrder, within } from "../model/containment";
import type { Diagram } from "../model/types";
import { type ResolvedEdge, resolveEdge } from "../routing/endpoints";
import { Occupancy } from "../routing/occupancy";
import { chars } from "./textLayout";
import { shapeOf } from "../shapes/registry";
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
    grid.clear(node.rect);
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
      const placed = placeLabel(r.cells, edge.label ?? "");
      r.label = placed.rect;
      for (const [p, ch] of placed.chars) {
        if (hidden(p)) continue;
        grid.setChar(p, ch);
        edgeCells.set(key(p), edge.id);
      }
    });
  }
  labels.forEach((f) => f());

  return { grid, edges, edgeCells };
}

/**
 * Where a connector's label goes: inline on the longest horizontal run it fits on, with a space
 * each side (`── yes ──►`); otherwise beside the middle of the longest vertical run. Without a
 * label, `rect` is where one would go (for the editor). Labels are one line.
 */
export function placeLabel(cells: Point[], label: string): { rect: Rect; chars: [Point, string][] } {
  const text = chars(label.replace(/\s*\n\s*/g, " "));
  const len = Math.max(text.length, 1);
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
  const fits = runs.filter((r) => r.horizontal && room(r) >= len + 2).sort((p, q) => room(q) - room(p))[0];
  if (fits) {
    const lo = Math.max(fits.a, 1), hi = Math.min(fits.b, cells.length - 2);
    const minX = Math.min(cells[lo].x, cells[hi].x), maxX = Math.max(cells[lo].x, cells[hi].x);
    // Centred in the run, whichever way it's heading, with a space either side.
    const x0 = Math.floor((minX + maxX + 1 - len) / 2);
    const y = cells[lo].y;
    const out: [Point, string][] = [];
    if (text.length) {
      out.push([{ x: x0 - 1, y }, " "], [{ x: x0 + len, y }, " "]);
      text.forEach((c, i) => out.push([{ x: x0 + i, y }, c]));
    }
    return { rect: { x: x0, y, w: len, h: 1 }, chars: out };
  }
  const vertical = runs.filter((r) => !r.horizontal || r.a === r.b).sort((p, q) => q.b - q.a - (p.b - p.a))[0] ?? runs[0];
  const at = cells[Math.floor((vertical.a + vertical.b) / 2)];
  const x0 = at.x + 2;
  return {
    rect: { x: x0, y: at.y, w: len, h: 1 },
    chars: text.map((c, i) => [{ x: x0 + i, y: at.y }, c] as [Point, string]),
  };
}

/** Rects of the nodes that hide an edge: all but those containing one of its ends. */
function hidingNodes(d: Diagram, r: ResolvedEdge): Rect[] {
  const holds = (rect: Rect, anchor: ResolvedEdge["from"]) => {
    const n = anchor.node ? d.nodes[anchor.node] : undefined;
    return n ? within(n.rect, rect) : contains(rect, anchor.cell);
  };
  return d.order
    .map((id) => d.nodes[id].rect)
    .filter((rect) => !holds(rect, r.from) && !holds(rect, r.to));
}

/** Plain text of the whole diagram. */
export function diagramToText(d: Diagram, ascii = false): string {
  return rasterize(d).grid.toText(null, ascii);
}

