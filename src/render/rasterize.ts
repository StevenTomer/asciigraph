import { type Point, type Rect, type Side, OPPOSITE, contains, key, stepSide } from "../geometry/geom";
import { paintOrder, within } from "../model/containment";
import type { Diagram } from "../model/types";
import { type ResolvedEdge, resolveEdge } from "../routing/endpoints";
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
export function rasterize(d: Diagram): Rendered {
  const grid = new CharGrid();
  const edges = new Map<string, ResolvedEdge>();
  const edgeCells = new Map<string, string>();

  for (const id of paintOrder(d)) {
    const node = d.nodes[id];
    grid.clear(node.rect);
    shapeOf(node).rasterize(node, grid);
  }

  for (const edge of Object.values(d.edges)) {
    const r = resolveEdge(d, edge);
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
  }

  return { grid, edges, edgeCells };
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

