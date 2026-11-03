import { type Point, type Rect, bottom, contains, eq, rectFromCorners, right, sub, union } from "../geometry/geom";
import { type Guide, snapMove, snapPoint, snapResize } from "./snap";
import {
  addEdge, addNode, bringToFront, makeEdge, makeNode, moveObjects, resizeNode, setEndpoint, updateEdge, updateNode,
} from "../model/ops";
import { withContents } from "../model/containment";
import type { Diagram, Id } from "../model/types";
import { shapeOf } from "../shapes/registry";
import { type Handle, endpointAt, hitTest } from "./hitTest";
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

const DEFAULT_BOX = { w: 16, h: 3 };

// ---------------------------------------------------------------------------------------------
// Select: pick, move, resize, re-attach edge ends, rubber-band select, double-click to edit.
// ---------------------------------------------------------------------------------------------

type Gesture =
  /** `carried` adds what's inside the selected boxes; Alt moves just `ids`. */
  | { kind: "move"; start: Point; base: Diagram; ids: Id[]; carried: Id[] }
  | { kind: "resize"; node: Id; handle: Handle; start: Point; orig: Rect }
  | { kind: "endpoint"; edge: Id; which: "from" | "to" }
  /** Dragging a bend point; `index` null until the pointer moves (then a new bend is added). */
  | { kind: "bend"; edge: Id; index: number | null; insertAt: number }
  | { kind: "marquee"; start: Point; base: Id[] };

let gesture: Gesture | null = null;

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
    } else if (hit.kind === "endpoint") {
      begin();
      gesture = { kind: "endpoint", edge: hit.edge, which: hit.which };
    } else if (hit.kind === "via") {
      begin();
      gesture = { kind: "bend", edge: hit.edge, index: hit.index, insertAt: hit.index };
    } else if (hit.kind === "edge" && !p.shift && selection.length === 1 && selection[0] === hit.edge) {
      // Dragging the line of the selected connector bends it there.
      begin();
      gesture = { kind: "bend", edge: hit.edge, index: null, insertAt: bendIndex(diagram, hit.edge, p.cell) };
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
      if (moved && !p.mod) {
        const snapped = snapMove(g.base, ids, { ...moved, x: moved.x + delta.x, y: moved.y + delta.y });
        delta = { x: delta.x + snapped.shift.x, y: delta.y + snapped.shift.y };
        guides = snapped.guides;
      }
      // What you drag comes to the front, so a box pulled partly out of a frame isn't hidden by it.
      set(bringToFront(moveObjects(g.base, ids, delta), ids));
      setOverlay({ guides });
    } else if (g.kind === "resize") {
      let rect = resizedRect(d, g.node, g.orig, g.handle, sub(p.cell, g.start));
      let guides: Guide[] = [];
      if (!p.mod) {
        const h = g.handle;
        const snapped = snapResize(d, g.node, rect, {
          left: h.includes("w"), right: h.includes("e"), top: h.includes("n"), bottom: h.includes("s"),
        });
        rect = snapped.rect;
        guides = snapped.guides;
      }
      set(resizeNode(d, g.node, rect));
      setOverlay({ sizeOf: getState().diagram.nodes[g.node].rect, guides });
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
      const marquee = rectFromCorners(g.start, p.cell);
      setOverlay({ marquee });
      select([...new Set([...g.base, ...objectsIn(d, marquee)])]);
    }
  },

  up() {
    if (gesture && gesture.kind !== "marquee") commit();
    gesture = null;
    setOverlay({});
  },

  dblclick(p) {
    const hit = hitTest(p.sx, p.sy);
    if (hit.kind === "via") {
      // Double-click a bend point to remove it.
      apply((d) => {
        const via = (d.edges[hit.edge].via ?? []).filter((_, i) => i !== hit.index);
        return updateEdge(d, hit.edge, { via: via.length ? via : undefined });
      });
    } else if (hit.kind === "edge") {
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
    if (hit.kind === "endpoint") return "crosshair";
    if (hit.kind === "via") return "move";
    if (hit.kind === "edge" && getState().selection.length === 1 && getState().selection[0] === hit.edge) return "copy";
    if (hit.kind === "node" || hit.kind === "edge") return "move";
    return "default";
  },
};

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

let creating: { id: Id; start: Point; over: Id | null } | null = null;

/** The node or connector under the pointer, if any. */
function objectAt(p: PointerInfo): Id | null {
  const hit = hitTest(p.sx, p.sy);
  return hit.kind === "node" || hit.kind === "handle" ? hit.node
    : hit.kind === "edge" || hit.kind === "endpoint" || hit.kind === "via" ? hit.edge
    : null;
}

const boxTool: Tool = {
  down(p) {
    const over = objectAt(p);
    begin();
    const node = makeNode(rectFromCorners(p.cell, p.cell));
    set(addNode(getState().diagram, node));
    creating = { id: node.id, start: p.cell, over };
  },
  move(p) {
    if (!creating) return;
    const corner = p.mod ? { point: p.cell, guides: [] } : snapPoint(getState().diagram, [creating.id], p.cell);
    const rect = rectFromCorners(creating.start, corner.point);
    set(updateNode(getState().diagram, creating.id, { rect }));
    setOverlay({ sizeOf: getState().diagram.nodes[creating.id].rect, guides: corner.guides });
  },
  up(p) {
    if (!creating) return;
    const { id, start, over } = creating;
    creating = null;
    setOverlay({});
    if (eq(start, p.cell) && over) {
      cancel();
      setTool("select");
      select([over]);
      return;
    }
    if (eq(start, p.cell)) set(updateNode(getState().diagram, id, { rect: { ...start, ...DEFAULT_BOX } }));
    startEditing(id); // continues the same undo step; the box tool stays active for the next one
  },
  cursor: () => "crosshair",
};

// ---------------------------------------------------------------------------------------------
// Arrow / line: drag from one place to another; ends attach to nodes they start or end on.
// Clicking (without dragging) a box or connector selects it and switches to select, as in box mode.
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
      const to = endpointAt(d, p.cell, p.alt, from.kind === "attached" ? from.node : undefined);
      set(setEndpoint(d, drawing.id, "to", to));
      setOverlay(to.kind === "attached" ? { attach: { node: to.node, side: to.side === "auto" ? null : to.side } } : {});
    },
    up(p) {
      if (!drawing) return;
      const { id, start, over } = drawing;
      drawing = null;
      setOverlay({});
      const e = getState().diagram.edges[id];
      // A click that didn't go anywhere: nothing to draw (but select what was clicked).
      if (eq(start, p.cell) || (e.from.kind === "attached" && e.to.kind === "attached" && e.from.node === e.to.node)) {
        cancel();
        if (eq(start, p.cell) && over) {
          setTool("select");
          select([over]);
        }
        return;
      }
      commit();
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
