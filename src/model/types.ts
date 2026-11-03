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
  /** Text the diagram was (partly) drawn from; editing it redraws those parts (text/sync.ts). */
  sources?: Record<Id, TextSource>;
}

export type SourceKind = "sequence" | "graph" | "tree";

/** A text description drawn as part of the diagram: a message sequence, a graph, a folder tree. */
export interface TextSource {
  id: Id;
  kind: SourceKind;
  text: string;
  options: { direction?: "down" | "right"; treeStyle?: "text" | "boxes" };
  /** Top-left of where it's drawn. */
  origin: Point;
}

/**
 * On objects drawn from a text source: which source, and the stable key of the thing in the text
 * they show (a participant's name, a graph node's id, a file path…). `at` is the rect last
 * generated for a node: if it still matches, the user hasn't moved the node, so a redraw may.
 */
export interface Generated {
  source: Id;
  key: string;
  at?: Rect;
  /** The style last generated (JSON), to tell whether the user has restyled it since. */
  style?: string;
  /** Connector ends last generated (JSON), to tell whether the user has moved them since. */
  ends?: string;
  /** Placed by hand (drawn before it was linked to text): keeps its own position and size. */
  placed?: boolean;
}

export type Id = string;

export type BorderStyle = "single" | "double" | "rounded" | "heavy" | "dashed" | "dotted" | "ascii" | "none";
export type LineStyle = "single" | "double" | "heavy" | "dashed" | "dotted" | "ascii";
export type HAlign = "left" | "center" | "right";
/** Node shapes: plain box; flowchart decision, input/output, start/end, database, document,
 * subroutine; notes; sequence-diagram lifelines and activation bars. */
export type NodeKind =
  | "box" | "decision" | "io" | "terminal" | "database" | "document" | "subroutine" | "note"
  | "frame" | "lifeline" | "activation";
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
  gen?: Generated;
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
  /** Where along the connector the label sits, 0 (start) to 1 (end), when dragged there.
   * Without it, the label goes on the longest straight stretch. */
  labelAt?: number;
  /** Bend points the route passes through, in order (absolute cells; they move only when the
   * connector itself is moved). Without them the route is automatic. */
  via?: Point[];
  gen?: Generated;
}

/**
 * An edge end: either a free cell, or attached to a node. Attached ends follow the node.
 * `side: "auto"` picks the side facing the other end on every render. `offset` pins the position
 * along the side (cells from the side's top/left corner); without it the end centres itself, or
 * lines up with the other end when that makes a straight line possible.
 */
export type Endpoint =
  | { kind: "free"; at: Point }
  | {
      kind: "attached"; node: Id; side: Side | "auto"; offset?: number;
      /** For an auto side: use this one (a graph's flow direction: leave right, arrive left)
       * unless the other end is behind it, where it would have to loop round. */
      prefer?: Side;
    };
