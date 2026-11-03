import type { Point, Rect } from "../geometry/geom";
import type { Diagram } from "../model/types";
import { type Rendered, rasterize } from "../render/rasterize";
import { metrics } from "../render/font";
import { getState } from "./store";

/** Screen px (relative to the canvas) → cell. */
export function screenToCell(sx: number, sy: number): Point {
  const { zoom, x, y } = getState().view;
  return { x: Math.floor((sx / zoom + x) / metrics.cw), y: Math.floor((sy / zoom + y) / metrics.ch) };
}

/** Cell's top-left corner → screen px. */
export function cellToScreen(cx: number, cy: number): Point {
  const { zoom, x, y } = getState().view;
  return { x: (cx * metrics.cw - x) * zoom, y: (cy * metrics.ch - y) * zoom };
}

/** Screen px rectangle covering a rect of cells. */
export function rectToScreen(r: Rect): { x: number; y: number; w: number; h: number } {
  const a = cellToScreen(r.x, r.y);
  const b = cellToScreen(r.x + r.w, r.y + r.h);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/** Screen px rectangle through the centres of a rect's corner cells: where its border is drawn. */
export function borderToScreen(r: Rect): { x: number; y: number; w: number; h: number } {
  const a = cellCenter({ x: r.x, y: r.y });
  const b = cellCenter({ x: r.x + r.w - 1, y: r.y + r.h - 1 });
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/** Screen px of a cell's centre. */
export function cellCenter(p: Point): Point {
  const a = cellToScreen(p.x, p.y);
  const z = getState().view.zoom;
  return { x: a.x + (metrics.cw * z) / 2, y: a.y + (metrics.ch * z) / 2 };
}

/** Zoom to `zoom`, keeping the screen point (sx, sy) over the same spot. */
export function zoomAt(zoom: number, sx: number, sy: number) {
  const v = getState().view;
  const z = Math.min(4, Math.max(0.25, zoom));
  // Snap so rows are whole pixels (no hairline gaps between cells), as asciidraw does.
  const snapped = Math.round(z * metrics.ch) / metrics.ch;
  return {
    zoom: snapped,
    x: v.x + sx / v.zoom - sx / snapped,
    y: v.y + sy / v.zoom - sy / snapped,
  };
}

/**
 * The diagram's rendering, computed once per diagram version (diagrams are immutable). While a
 * gesture is in progress (dragging), connectors are routed in quick mode; the full routing runs
 * when it ends.
 */
const cache = new WeakMap<Diagram, Rendered>();
const quickCache = new WeakMap<Diagram, Rendered>();
export function rendered(d: Diagram): Rendered {
  const quick = getState().pending !== null && !getState().editing;
  const c = quick ? quickCache : cache;
  let r = c.get(d);
  if (!r) {
    r = rasterize(d, quick);
    c.set(d, r);
  }
  return r;
}
