import { type Side, OPPOSITE, stepSide } from "../geometry/geom";
import type { Diagram } from "../model/types";
import { type ResolvedEdge, resolveEdge } from "../routing/endpoints";
import { shapeOf } from "../shapes/registry";
import { CharGrid } from "./grid";

export interface Rendered {
  grid: CharGrid;
  /** Each edge's computed path, for hit-testing and handles. */
  edges: Map<string, ResolvedEdge>;
}

/**
 * Draw the diagram into a character grid:
 *  1. connector paths (so nodes drawn later hide whatever passes behind them),
 *  2. nodes back to front, each blanking its rect first (nodes are opaque),
 *  3. where connectors meet nodes: border junctions (┴ ├ …) and arrowheads, on top.
 */
export function rasterize(d: Diagram): Rendered {
  const grid = new CharGrid();
  const edges = new Map<string, ResolvedEdge>();
  const finish: (() => void)[] = [];

  for (const edge of Object.values(d.edges)) {
    const r = resolveEdge(d, edge);
    edges.set(edge.id, r);
    const { cells } = r;
    const style = edge.line;
    for (let k = 1; k < cells.length; k++) {
      const dir = stepSide(cells[k - 1], cells[k]);
      grid.stroke(cells[k - 1], dir, style);
      grid.stroke(cells[k], OPPOSITE[dir], style);
    }
    for (const [anchor, arrow, end] of [
      [r.from, edge.arrows.start, cells[0]],
      [r.to, edge.arrows.end, cells[cells.length - 1]],
    ] as const) {
      const neighbour = cells.length > 1 ? (end === cells[0] ? cells[1] : cells[cells.length - 2]) : null;
      // Which way the line runs as it reaches this end.
      const pointing: Side = anchor.dir
        ? OPPOSITE[anchor.dir]
        : neighbour ? stepSide(neighbour, end) : "right";
      if (arrow) {
        finish.push(() => grid.setArrow(end, pointing, style));
      } else if (anchor.dir) {
        // Run the line into the border and join it there.
        const into = OPPOSITE[anchor.dir];
        grid.stroke(end, into, style);
        const border = anchor.border;
        if (border) {
          finish.push(() => {
            const c = grid.get(border);
            if (c && c.mask && c.ch === undefined) grid.stroke(border, anchor.dir!, style);
          });
        }
      } else if (cells.length === 1) {
        grid.stroke(end, ["left", "right"], style);
      }
    }
  }

  for (const id of d.order) {
    const node = d.nodes[id];
    grid.clear(node.rect);
    shapeOf(node).rasterize(node, grid);
  }

  finish.forEach((f) => f());
  return { grid, edges };
}

/** Plain text of the whole diagram. */
export function diagramToText(d: Diagram, ascii = false): string {
  return rasterize(d).grid.toText(null, ascii);
}

