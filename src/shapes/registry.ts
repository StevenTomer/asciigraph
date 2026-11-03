import type { Rect, Side } from "../geometry/geom";
import type { Node } from "../model/types";
import type { CharGrid } from "../render/grid";
import { box } from "./box";

/**
 * What a node kind must provide. New diagram types (flowchart decisions, sequence-diagram
 * lifelines, …) add an entry here instead of special-casing the editor or renderer.
 */
export interface ShapeDef {
  minSize(node: Node): { w: number; h: number };
  hasBorder(node: Node): boolean;
  /** Where the node's text goes. */
  contentRect(node: Node): Rect;
  /** First and last cell (x for top/bottom, y for left/right) where connectors may attach. */
  sideRange(node: Node, side: Side): [number, number];
  /** The size the node should have for `text` (autosize labels, growing boxes). */
  fitSize(node: Node, text: string): { w: number; h: number };
  /** Draw into the grid. The rasterizer has already cleared the node's rect. */
  rasterize(node: Node, grid: CharGrid): void;
}

const SHAPES: Record<Node["kind"], ShapeDef> = { box };

export const shapeOf = (node: Node): ShapeDef => SHAPES[node.kind];
