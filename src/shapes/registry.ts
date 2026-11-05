import { type Point, type Rect, type Side, contains, intersects } from "../geometry/geom";
import type { Node, NodeKind } from "../model/types";
import type { CharGrid } from "../render/grid";
import { box, frame } from "./box";
import { classBox } from "./compartments";
import { table } from "./table";
import { decision, io, terminal } from "./flowchart";
import { activation, lifeline } from "./lifeline";
import { database, document, note, subroutine } from "./more";

/**
 * What a node kind must provide. New diagram types (flowchart shapes, sequence-diagram
 * lifelines, …) add an entry here instead of special-casing the editor or renderer.
 */
export interface ShapeDef {
  /** Shown in the shape picker and properties panel. */
  label: string;
  /** Size when created with a click rather than a drag. */
  defaultSize: { w: number; h: number };
  minSize(node: Node): { w: number; h: number };
  /** Adjust a rect to what the shape can draw (e.g. odd heights for diamonds). */
  normalize?(rect: Rect): Rect;
  /** Whether connector ends join its outline with a junction (┴ ├) where it has line strokes. */
  hasBorder(node: Node): boolean;
  /** Where the node's text goes. */
  contentRect(node: Node): Rect;
  /** Sides connectors may attach to (default: all four). */
  sides?: Side[];
  /** First and last cell (x for top/bottom, y for left/right) where connectors may attach. */
  sideRange(node: Node, side: Side): [number, number];
  /** The cell on the outline where a connector attaching at `along` on `side` meets it (default:
   * on the rect's edge). The connector's path starts one cell further out. */
  anchor?(node: Node, side: Side, along: number): Point | undefined;
  /** The size the node should have for `text` (autosize labels, growing boxes). */
  fitSize(node: Node, text: string): { w: number; h: number };
  /** The opaque parts: blanked before drawing, they hide connectors passing behind and are routed
   * around (default: the whole rect). */
  footprint?(node: Node): Rect[];
  /** Whether drawing this node would cover something at `r` inside it, so that thing must be
   * drawn in front of it (default: its footprint overlaps `r`). */
  covers?(node: Node, r: Rect): boolean;
  /** Whether a cell counts as on the node, for clicking (default: anywhere in its rect). */
  hitTest?(node: Node, cell: Point): boolean;
  /** Connectors attach here by row, on the left or right (sequence diagrams): a connector end
   * dropped on such a cell gets `offset` = that row, so messages stay put and horizontal. */
  attachByRow?(node: Node, cell: Point): boolean;
  /** Draw into the grid. The rasterizer has already cleared the node's footprint. */
  rasterize(node: Node, grid: CharGrid): void;
}

/** In picker order. */
const SHAPES: Record<NodeKind, ShapeDef> = {
  box, decision, io, terminal, database, document, subroutine, note, class: classBox, table, frame, lifeline, activation,
};

export const SHAPE_KINDS = Object.keys(SHAPES) as NodeKind[];

export const shapeOf = (node: Node): ShapeDef => SHAPES[node.kind] ?? box;
export const shapeFor = (kind: NodeKind): ShapeDef => SHAPES[kind];

export const footprint = (node: Node): Rect[] => shapeOf(node).footprint?.(node) ?? [node.rect];
export const covers = (node: Node, r: Rect): boolean =>
  shapeOf(node).covers?.(node, r) ?? footprint(node).some((f) => intersects(f, r));
export const hits = (node: Node, cell: Point): boolean =>
  shapeOf(node).hitTest?.(node, cell) ?? contains(node.rect, cell);
