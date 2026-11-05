import { type Point, type Rect, bottom, contains, eq, rectFromCorners, right, sub, union } from "../geometry/geom";
import { type Guide, snapMove, snapPoint, snapResize } from "./snap";
import {
  addEdge, addNode, bringToFront, makeEdge, makeNode, moveObjects, resizeNode, setEndpoint, updateEdge, updateNode,
} from "../model/ops";
import { withContents } from "../model/containment";
import { lockMates, moveWithLocks } from "../model/locks";
import type { Diagram, Id } from "../model/types";
import { lifelineColumn } from "../shapes/lifeline";
import { shapeOf } from "../shapes/registry";
import { columnLeft, withColumnWidth } from "../shapes/table";
import { type Handle, endpointAt, hitTest, nodeAt } from "./hitTest";
import {
  type ToolId, apply, begin, cancel, commit, finishEditing, getState, select, set, setOverlay, setTool, startEditing,
} from "./store";
import { rendered } from "./view";

export interface PointerInfo {
  sx: number;
  sy: number;
  cell: Point;
  shift: boolean;
  alt: boolean;
  /** Ctrl (⌘ on Mac) held: no snapping. */
  mod: boolean;
}

export interface Tool {
  down(p: PointerInfo): void;
  move(p: PointerInfo): void;
  up(p: PointerInfo): void;
  dblclick?(p: PointerInfo): void;
  cursor(p: PointerInfo): string;
}

/** Tool order, labels and shortcuts (the first letter of the label). */
export const TOOLS: { id: ToolId; label: string }[] = [
  { id: "select", label: "select" },
  { id: "box", label: "box" },
  { id: "arrow", label: "arrow" },
  { id: "line", label: "line" },
  { id: "text", label: "text" },
];


// ---------------------------------------------------------------------------------------------
// Select: pick, move, resize, re-attach edge ends, rubber-band select, double-click to edit.
// ---------------------------------------------------------------------------------------------

type Gesture =
  /** `carried` adds what's inside the selected boxes; Alt moves just `ids`. */
  | { kind: "move"; start: Point; base: Diagram; ids: Id[]; carried: Id[] }
  | { kind: "resize"; node: Id; handle: Handle; start: Point; orig: Rect }
  /** Dragging a table's column line: that column's width. */
  | { kind: "column"; node: Id; col: number }
  | { kind: "endpoint"; edge: Id; which: "from" | "to" }
  /** Dragging a connector's label along it. */
  | { kind: "label"; edge: Id }
  /** Sliding the middle stretch of an S-shaped connector (where it turns) along `axis`, between
   * the ends' coordinates `a` and `b`. */
  | { kind: "turn"; edge: Id; axis: "x" | "y"; a: number; b: number }
  /** Dragging a bend point; `index` null until the pointer moves (then a new bend is added). */
  | { kind: "bend"; edge: Id; index: number | null; insertAt: number }
  /** Rubber-band selection. `click`: the object pressed on with Ctrl/⌘ held (a marquee started
   * inside a box): selected as usual if the pointer is released without dragging. */
  | { kind: "marquee"; start: Point; base: Id[]; click?: { id: Id; shift: boolean }; dragged?: boolean };

let gesture: Gesture | null = null;

/** Snapping is on (the toolbar's "snap"), and not held off with Alt or Ctrl/⌘. */
const snapping = (p: PointerInfo) => getState().snap && !p.alt && !p.mod;

const RESIZE_CURSORS: Record<Handle, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize",
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
};

const selectTool: Tool = {
  down(p) {
    const hit = hitTest(p.sx, p.sy);
    const { selection, diagram } = getState();
    if (hit.kind === "handle") {
      begin();
      gesture = { kind: "resize", node: hit.node, handle: hit.handle, start: p.cell, orig: diagram.nodes[hit.node].rect };
    } else if (hit.kind === "column") {
      begin();
      gesture = { kind: "column", node: hit.node, col: hit.col };
    } else if (hit.kind === "endpoint") {
      begin();
      gesture = { kind: "endpoint", edge: hit.edge, which: hit.which };
    } else if (hit.kind === "via") {
      begin();
      gesture = { kind: "bend", edge: hit.edge, index: hit.index, insertAt: hit.index };
    } else if (hit.kind === "label") {
      select([hit.edge]);
      begin();
      gesture = { kind: "label", edge: hit.edge };
    } else if (hit.kind === "edge" && !p.shift && selection.length === 1 && selection[0] === hit.edge && turnSegment(diagram, hit.edge, p.cell)) {
      // Dragging the middle stretch of the selected connector moves where it turns.
      begin();
      gesture = { kind: "turn", edge: hit.edge, ...turnSegment(diagram, hit.edge, p.cell)! };
    } else if (hit.kind === "edge" && !p.shift && selection.length === 1 && selection[0] === hit.edge) {
      // Dragging the line of the selected connector bends it there.
      begin();
      gesture = { kind: "bend", edge: hit.edge, index: null, insertAt: bendIndex(diagram, hit.edge, p.cell) };
    } else if ((hit.kind === "node" || hit.kind === "edge") && p.mod) {
      // Ctrl/⌘ held from the press: draw a selection box, even inside a box or frame.
      const id = hit.kind === "node" ? hit.node : hit.edge;
      gesture = { kind: "marquee", start: p.cell, base: p.shift ? selection : [], click: { id, shift: p.shift } };
    } else if (hit.kind === "node" || hit.kind === "edge") {
      const id = hit.kind === "node" ? hit.node : hit.edge;
      let ids = selection;
      if (p.shift) {
        ids = selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id];
        select(ids);
        if (!ids.includes(id)) return;
      } else if (!selection.includes(id)) {
        ids = [id];
        select(ids);
      }
      begin();
      const base = getState().diagram;
      gesture = { kind: "move", start: p.cell, base, ids, carried: withContents(base, ids) };
    } else {
      gesture = { kind: "marquee", start: p.cell, base: p.shift ? selection : [] };
      if (!p.shift) select([]);
    }
  },

  move(p) {
    const g = gesture;
    if (!g) return;
    const d = getState().diagram;
    if (g.kind === "move") {
      const ids = p.alt ? g.ids : g.carried;
      let delta = sub(p.cell, g.start);
      let guides: Guide[] = [];
      // Snap the moved boxes' outline to other boxes (not with Ctrl held).
      const moved = union(ids.filter((id) => g.base.nodes[id]).map((id) => g.base.nodes[id].rect));
      if (moved && snapping(p)) {
        // Lock-mates move too: they're not snap targets.
        const alongside = p.alt ? ids : [...ids, ...lockMates(g.base, ids).keys()];
        const snapped = snapMove(g.base, alongside, { ...moved, x: moved.x + delta.x, y: moved.y + delta.y });
        delta = { x: delta.x + snapped.shift.x, y: delta.y + snapped.shift.y };
        guides = snapped.guides;
      }
      // What you drag comes to the front, so a box pulled partly out of a frame isn't hidden by it.
      // Alt moves just what's selected: no contents, no lock-mates.
      set(bringToFront(p.alt ? moveObjects(g.base, ids, delta) : moveWithLocks(g.base, ids, delta), ids));
      setOverlay({ guides });
    } else if (g.kind === "resize") {
      let rect = resizedRect(d, g.node, g.orig, g.handle, sub(p.cell, g.start));
      let guides: Guide[] = [];
      if (snapping(p)) {
        const h = g.handle;
        const snapped = snapResize(d, g.node, rect, {
          left: h.includes("w"), right: h.includes("e"), top: h.includes("n"), bottom: h.includes("s"),
        });
        rect = snapped.rect;
        guides = snapped.guides;
      }
      set(resizeNode(d, g.node, rect));
      setOverlay({ sizeOf: getState().diagram.nodes[g.node].rect, guides });
    } else if (g.kind === "column") {
      // The column's text runs from two cells past its left line to two before its right one.
      const n = d.nodes[g.node];
      const left = columnLeft(n, g.col);
      set(updateNode(d, g.node, withColumnWidth(n, g.col, Math.max(1, p.cell.x - left - 3))));
      setOverlay({ sizeOf: getState().diagram.nodes[g.node].rect });
    } else if (g.kind === "label") {
      // The nearest point on the connector to the pointer, as a fraction of its length.
      const cells = rendered(d).edges.get(g.edge)?.cells ?? [];
      if (cells.length > 2) {
        let best = 0, bestDist = Infinity;
        cells.forEach((c, i) => {
          const dist = Math.abs(c.x - p.cell.x) + Math.abs(c.y - p.cell.y);
          if (dist < bestDist) {
            bestDist = dist;
            best = i;
          }
        });
        set(updateEdge(d, g.edge, { labelAt: best / (cells.length - 1) }));
      }
    } else if (g.kind === "turn") {
      // A fraction of the way from start to end, kept a cell clear of both.
      const lo = Math.min(g.a, g.b) + 1, hi = Math.max(g.a, g.b) - 1;
      const v = Math.max(lo, Math.min(hi, g.axis === "x" ? p.cell.x : p.cell.y));
      set(updateEdge(d, g.edge, { turnAt: Math.round(((v - g.a) / (g.b - g.a)) * 1000) / 1000 }));
    } else if (g.kind === "bend") {
      const via = [...(d.edges[g.edge].via ?? [])];
      if (g.index === null) {
        via.splice(g.insertAt, 0, p.cell);
        g.index = g.insertAt;
      } else {
        via[g.index] = p.cell;
      }
      set(updateEdge(d, g.edge, { via }));
    } else if (g.kind === "endpoint") {
      const edge = d.edges[g.edge];
      const other = g.which === "from" ? edge.to : edge.from;
      const ep = endpointAt(d, p.cell, p.alt, other.kind === "attached" ? other.node : undefined);
      set(setEndpoint(d, g.edge, g.which, ep));
      setOverlay(ep.kind === "attached" ? { attach: { node: ep.node, side: ep.side === "auto" ? null : ep.side } } : {});
    } else {
      if (!g.dragged && g.start.x === p.cell.x && g.start.y === p.cell.y) return;
      g.dragged = true;
      const marquee = rectFromCorners(g.start, p.cell);
      setOverlay({ marquee });
      select([...new Set([...g.base, ...objectsIn(d, marquee)])]);
    }
  },

  up() {
    if (gesture && gesture.kind !== "marquee") commit();
    // A Ctrl/⌘-click that didn't drag: select what was clicked, as a plain (or Shift-) click does.
    if (gesture?.kind === "marquee" && gesture.click && !gesture.dragged) {
      const { id, shift } = gesture.click;
      const { selection } = getState();
      select(shift ? (selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]) : [id]);
    }
    gesture = null;
    setOverlay({});
  },

  dblclick(p) {
    const hit = hitTest(p.sx, p.sy);
    if (hit.kind === "column") {
      // Double-click a column line: that column sizes itself again.
      apply((d) => updateNode(d, hit.node, withColumnWidth(d.nodes[hit.node], hit.col, null)));
    } else if (hit.kind === "via") {
      // Double-click a bend point to remove it.
      apply((d) => {
        const via = (d.edges[hit.edge].via ?? []).filter((_, i) => i !== hit.index);
        return updateEdge(d, hit.edge, { via: via.length ? via : undefined });
      });
    } else if (hit.kind === "edge" || hit.kind === "label") {
      startEditing(hit.edge, "label");
    } else if (hit.kind === "node") {
      startEditing(hit.node, hit.nameRow ? "name" : "text");
    } else if (hit.kind === "none") {
      createLabel(p.cell);
    }
  },

  cursor(p) {
    const hit = hitTest(p.sx, p.sy);
    if (hit.kind === "handle") return RESIZE_CURSORS[hit.handle];
    if (hit.kind === "column") return "col-resize";
    if (hit.kind === "endpoint") return "crosshair";
    if (hit.kind === "via" || hit.kind === "label") return "move";
    if (hit.kind === "edge" && getState().selection.length === 1 && getState().selection[0] === hit.edge) {
      const turn = turnSegment(getState().diagram, hit.edge, p.cell);
      return turn ? (turn.axis === "x" ? "ew-resize" : "ns-resize") : "copy";
    }
    if ((hit.kind === "node" || hit.kind === "edge") && p.mod) return "crosshair"; // Ctrl/⌘: select box
    if (hit.kind === "node" || hit.kind === "edge") return "move";
    return "default";
  },
};

/**
 * If `cell` is on the middle stretch of a connector shaped like an S (`─┐ └─`: three straight
 * runs, no bend points), the way that stretch slides and the ends' coordinates along it.
 */
export function turnSegment(d: Diagram, edgeId: Id, cell: Point): { axis: "x" | "y"; a: number; b: number } | null {
  const r = rendered(d).edges.get(edgeId);
  if (!r || d.edges[edgeId]?.via?.length) return null;
  const cells = r.cells;
  const corners: number[] = [];
  for (let i = 1; i + 1 < cells.length; i++) {
    const straight = (cells[i - 1].x === cells[i + 1].x) || (cells[i - 1].y === cells[i + 1].y);
    if (!straight) corners.push(i);
  }
  if (corners.length !== 2) return null;
  const [c1, c2] = corners;
  // An S, not a U (which turns back: its middle stretch isn't between the ends).
  const n = cells.length;
  if (stepDir(cells[0], cells[1]) !== stepDir(cells[n - 2], cells[n - 1])) return null;
  const at = cells.findIndex((c) => eq(c, cell));
  if (at < c1 || at > c2) return null;
  // A vertical middle stretch slides left–right, a horizontal one up–down.
  const axis = cells[c1].x === cells[c2].x ? "x" : "y";
  const a = r.from.cell[axis], b = r.to.cell[axis];
  return Math.abs(b - a) >= 2 ? { axis, a, b } : null;
}

const stepDir = (a: Point, b: Point) => `${Math.sign(b.x - a.x)},${Math.sign(b.y - a.y)}`;

/** Where a new bend at `cell` goes among the existing ones: after those the path reaches first. */
function bendIndex(d: Diagram, edgeId: Id, cell: Point): number {
  const r = rendered(d).edges.get(edgeId);
  const via = d.edges[edgeId].via ?? [];
  if (!r) return via.length;
  const at = r.cells.findIndex((c) => eq(c, cell));
  return via.filter((v) => r.cells.findIndex((c) => eq(c, v)) < at).length;
}

function resizedRect(d: Diagram, id: Id, orig: Rect, handle: Handle, delta: Point): Rect {
  const min = shapeOf(d.nodes[id]).minSize(d.nodes[id]);
  let x0 = orig.x, y0 = orig.y, x1 = right(orig), y1 = bottom(orig);
  if (handle.includes("w")) x0 = Math.min(x0 + delta.x, x1 - min.w + 1);
  if (handle.includes("e")) x1 = Math.max(x1 + delta.x, x0 + min.w - 1);
  if (handle.includes("n")) y0 = Math.min(y0 + delta.y, y1 - min.h + 1);
  if (handle.includes("s")) y1 = Math.max(y1 + delta.y, y0 + min.h - 1);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Nodes entirely inside the rect, and edges whose whole path is. */
function objectsIn(d: Diagram, r: Rect): Id[] {
  const inside = (q: Rect) => q.x >= r.x && q.y >= r.y && right(q) <= right(r) && bottom(q) <= bottom(r);
  const nodes = d.order.filter((id) => inside(d.nodes[id].rect));
  const edges = [...rendered(d).edges].filter(([, e]) => e.cells.every((c) => contains(r, c))).map(([id]) => id);
  return [...nodes, ...edges];
}

// ---------------------------------------------------------------------------------------------
// Box: drag out a box (or click empty space for a default-sized one), then type its text.
// Clicking an existing box or connector selects it and switches to select; dragging from inside
// a box draws a new box inside it.
// ---------------------------------------------------------------------------------------------

/** `start`: the box's first corner; `pressed`: where the pointer went down (they differ for an
 * activation bar, which moves onto the lifeline's line: `column`). */
let creating: { id: Id; start: Point; pressed: Point; over: Id | null; column: number | null } | null = null;

/** Activation bars drawn on a lifeline sit centered on its line: the bar's left column. */
function activationColumn(d: Diagram, cell: Point): number | null {
  const id = nodeAt(d, cell);
  const n = id ? d.nodes[id] : undefined;
  return n?.kind === "lifeline" ? lifelineColumn(n.rect) - 1 : null;
}

/** The node or connector under the pointer, if any. */
function objectAt(p: PointerInfo): Id | null {
  const hit = hitTest(p.sx, p.sy);
  return hit.kind === "node" || hit.kind === "handle" ? hit.node
    : hit.kind === "edge" || hit.kind === "endpoint" || hit.kind === "via" || hit.kind === "label" ? hit.edge
    : null;
}

const boxTool: Tool = {
  down(p) {
    const kind = getState().shape;
    const column = kind === "activation" ? activationColumn(getState().diagram, p.cell) : null;
    // Clicking a box selects it, except that an activation bar goes onto the lifeline clicked.
    const over = column === null ? objectAt(p) : null;
    begin();
    const start = column === null ? p.cell : { x: column, y: p.cell.y };
    const node = makeNode(rectFromCorners(start, start), { kind });
    set(addNode(getState().diagram, node));
    creating = { id: node.id, start, pressed: p.cell, over, column };
  },
  move(p) {
    if (!creating) return;
    const corner = !snapping(p) || creating.column !== null ? { point: p.cell, guides: [] } : snapPoint(getState().diagram, [creating.id], p.cell);
    let rect = rectFromCorners(creating.start, corner.point);
    if (creating.column !== null) rect = { ...rect, x: creating.column, w: 3 };
    set(updateNode(getState().diagram, creating.id, { rect }));
    setOverlay({ sizeOf: getState().diagram.nodes[creating.id].rect, guides: corner.guides });
  },
  up(p) {
    if (!creating) return;
    const { id, start, pressed, over } = creating;
    creating = null;
    setOverlay({});
    const click = eq(pressed, p.cell);
    if (click && over) {
      cancel();
      setTool("select");
      select([over]);
      return;
    }
    if (click) {
      const size = shapeOf(getState().diagram.nodes[id]).defaultSize;
      set(updateNode(getState().diagram, id, { rect: { ...start, ...size } }));
    }
    startEditing(id); // continues the same undo step; the box tool stays active for the next one
  },
  cursor: () => "crosshair",
};

// ---------------------------------------------------------------------------------------------
// Arrow / line: drag from one place to another; ends attach to nodes they start or end on.
// Afterwards it's back to select, with the new connector selected. Clicking (without dragging)
// switches to select too, selecting the box or connector clicked, if any.
// ---------------------------------------------------------------------------------------------

let drawing: { id: Id; start: Point; over: Id | null } | null = null;

function connectorTool(arrow: boolean): Tool {
  return {
    down(p) {
      const over = objectAt(p);
      begin();
      const d = getState().diagram;
      const from = endpointAt(d, p.cell, p.alt);
      const edge = makeEdge(from, { kind: "free", at: p.cell }, { arrows: { start: false, end: arrow } });
      set(addEdge(d, edge));
      drawing = { id: edge.id, start: p.cell, over };
      setOverlay(from.kind === "attached" ? { attach: { node: from.node, side: from.side === "auto" ? null : from.side } } : {});
    },
    move(p) {
      if (!drawing) return;
      const d = getState().diagram;
      const from = d.edges[drawing.id].from;
      const attachedFrom = from.kind === "attached" ? from : null;
      const fromNode = attachedFrom ? d.nodes[attachedFrom.node] : undefined;
      // Sequence diagrams: a message starting on a lifeline or activation bar, at a row.
      const fromRow = fromNode && attachedFrom?.offset !== undefined && shapeOf(fromNode).attachByRow
        ? fromNode.rect.y + attachedFrom.offset : null;
      // Those may message themselves; other nodes don't connect to themselves.
      let to = endpointAt(d, p.cell, p.alt, fromRow !== null ? undefined : fromNode?.id);
      let fromEnd = from;
      const toNode = to.kind === "attached" ? d.nodes[to.node] : undefined;
      if (fromRow !== null && attachedFrom && to.kind === "attached" && to.offset !== undefined && toNode && shapeOf(toNode).attachByRow) {
        if (toNode.id === fromNode!.id) {
          // A message to itself loops out to the right and back, at least two rows down.
          to = { ...to, side: "right", offset: Math.max(to.offset, attachedFrom.offset! + 2) };
          fromEnd = { ...attachedFrom, side: "right" };
        } else {
          // Messages are horizontal: the same row as where they started (kept within the target).
          const [lo, hi] = shapeOf(toNode).sideRange(toNode, "left");
          to = { ...to, offset: Math.max(lo, Math.min(hi, fromRow)) - toNode.rect.y };
          fromEnd = { ...attachedFrom, side: "auto" };
        }
      }
      set(setEndpoint(setEndpoint(d, drawing.id, "from", fromEnd), drawing.id, "to", to));
      setOverlay(to.kind === "attached" ? { attach: { node: to.node, side: to.side === "auto" ? null : to.side } } : {});
    },
    up(p) {
      if (!drawing) return;
      const { id, start, over } = drawing;
      drawing = null;
      setOverlay({});
      const e = getState().diagram.edges[id];
      // A click that didn't go anywhere: nothing to draw (but select what was clicked).
      const selfLoop = e.from.kind === "attached" && e.to.kind === "attached" && e.from.node === e.to.node;
      const fromNode = e.from.kind === "attached" ? getState().diagram.nodes[e.from.node] : undefined;
      const byRow = !!fromNode && !!shapeOf(fromNode).attachByRow;
      if (eq(start, p.cell) || (selfLoop && !byRow)) {
        cancel();
        // A click without a drag goes back to select: selecting what was clicked, or (on empty
        // space) nothing, as clicking away does after the other drawing tools.
        if (eq(start, p.cell)) {
          setTool("select");
          select(over ? [over] : []);
        }
        return;
      }
      commit();
      // Drawn: back to select, with the new connector selected (to label it, or drag its ends).
      setTool("select");
      select([id]);
    },
    cursor: () => "crosshair",
  };
}

// ---------------------------------------------------------------------------------------------
// Text: click empty space to type a free label. Clicking a box or connector selects it and
// switches to select (as the other drawing tools do), so it can be dragged straight away;
// Alt-click places a label there instead (e.g. inside a box, which it then moves with).
// ---------------------------------------------------------------------------------------------

function createLabel(cell: Point) {
  finishEditing();
  begin();
  const node = makeNode({ ...cell, w: 1, h: 1 }, {
    border: "none", autosize: true, align: { h: "left", v: "top" },
  });
  set(addNode(getState().diagram, node));
  startEditing(node.id); // continues the same undo step; an empty label is dropped when done
}

const textTool: Tool = {
  down(p) {
    if (!p.alt && objectAt(p)) {
      setTool("select");
      selectTool.down(p); // the rest of the gesture goes to select, which is now the tool
      return;
    }
    createLabel(p.cell);
  },
  move() {},
  up() {},
  cursor: () => "text",
};

export const TOOL_IMPL: Record<ToolId, Tool> = {
  select: selectTool,
  box: boxTool,
  arrow: connectorTool(true),
  line: connectorTool(false),
  text: textTool,
};
