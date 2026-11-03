import type { Point, Rect, Side } from "../geometry/geom";

/**
 * The document: objects only. Characters are a rendering of it (see render/rasterize.ts).
 * Documents are immutable; every edit returns a new one (see ops.ts), which is what makes undo a
 * plain stack of documents.
 */
export interface Diagram {
  version: 1;
  nodes: Record<Id, Node>;
  edges: Record<Id, Edge>;
  /** Paint order of nodes, back to front. */
  order: Id[];
}

export type Id = string;

export type BorderStyle = "single" | "double" | "rounded" | "heavy" | "dashed" | "dotted" | "ascii" | "none";
export type LineStyle = "single" | "double" | "heavy" | "dashed" | "dotted" | "ascii";
export type HAlign = "left" | "center" | "right";
/** Node shapes: plain box, flowchart decision / input-output / start-end, sequence lifeline. */
export type NodeKind = "box" | "decision" | "io" | "terminal" | "lifeline";
export type VAlign = "top" | "middle" | "bottom";

/**
 * A box: a rectangle with optional border, text inside, and an optional name set into its top
 * border (`┌─ Name ───┐`). With border "none" it's a free text label. `kind` selects the shape
 * implementation (shapes/registry.ts); new diagram types add kinds rather than special cases.
 */
export interface Node {
  id: Id;
  kind: NodeKind;
  rect: Rect;
  border: BorderStyle;
  text: string;
  align: { h: HAlign; v: VAlign };
  name?: string;
  nameAlign?: HAlign;
  /** Size follows the text (text labels); resizing by hand turns it off. */
  autosize?: boolean;
  /** Moving this box takes along what's inside it (default true). See model/containment.ts. */
  carry?: boolean;
}

/** A connector. Its path is computed (routing/orthogonal.ts), never stored. */
export interface Edge {
  id: Id;
  from: Endpoint;
  to: Endpoint;
  line: LineStyle;
  arrows: { start: boolean; end: boolean };
  /** Text shown on (or beside) the line: `── yes ──►`. */
  label?: string;
  /** Bend points the route passes through, in order (absolute cells; they move only when the
   * connector itself is moved). Without them the route is automatic. */
  via?: Point[];
}

/**
 * An edge end: either a free cell, or attached to a node. Attached ends follow the node.
 * `side: "auto"` picks the side facing the other end on every render. `offset` pins the position
 * along the side (cells from the side's top/left corner); without it the end centres itself, or
 * lines up with the other end when that makes a straight line possible.
 */
export type Endpoint =
  | { kind: "free"; at: Point }
  | { kind: "attached"; node: Id; side: Side | "auto"; offset?: number };
