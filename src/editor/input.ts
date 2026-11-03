import { eq } from "../geometry/geom";
import { hitTest } from "./hitTest";
import { cancel, finishEditing, getState, select, setMenu, setView } from "./store";
import { type PointerInfo, TOOL_IMPL } from "./tools";
import { screenToCell, zoomAt } from "./view";

/** Space is held: dragging pans (set by keyboard.ts). */
export const keys = { space: false };

/**
 * Pointer input on the canvas. Adapted from asciidraw/ASCIIFlow's InputController:
 *  - one pointer: the current tool (middle button, or space + drag: pan),
 *  - two touches: pan and pinch-zoom,
 *  - wheel: pan; Ctrl/Cmd + wheel (and trackpad pinch): zoom around the pointer.
 */
export function attachInput(canvas: HTMLCanvasElement): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let toolActive = false;
  let lastCell = { x: NaN, y: NaN };
  let pan: { sx: number; sy: number; vx: number; vy: number } | null = null;
  let pinch: { dist: number; zoom: number; mid: { x: number; y: number }; vx: number; vy: number } | null = null;

  const info = (e: PointerEvent | MouseEvent): PointerInfo => {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { sx, sy, cell: screenToCell(sx, sy), shift: e.shiftKey, alt: e.altKey };
  };
  const tool = () => TOOL_IMPL[getState().tool];
  const startPan = (sx: number, sy: number) => {
    const v = getState().view;
    pan = { sx, sy, vx: v.x, vy: v.y };
  };

  const down = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    // We manage focus: the browser's default (focusing the canvas on mousedown) would otherwise
    // land after a tool opens the text editor, and close it again.
    e.preventDefault();
    if (!getState().editing) canvas.focus();
    const p = info(e);
    pointers.set(e.pointerId, { x: p.sx, y: p.sy });
    if (pointers.size === 2) {
      // Second finger: abandon whatever the first started, and pinch/pan instead.
      if (toolActive) cancel();
      toolActive = false;
      pan = null;
      const [a, b] = [...pointers.values()];
      const v = getState().view;
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: v.zoom, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, vx: v.x, vy: v.y };
      return;
    }
    if (pointers.size > 2) return;
    if (e.button === 1 || keys.space) {
      e.preventDefault();
      startPan(p.sx, p.sy);
      return;
    }
    if (e.button !== 0) return;
    finishEditing();
    toolActive = true;
    lastCell = p.cell;
    tool().down(p);
  };

  const move = (e: PointerEvent) => {
    const p = info(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: p.sx, y: p.sy });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const z = zoomAt((pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, pinch.dist), 0, 0).zoom;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // Keep the point under the fingers' starting midpoint under their current midpoint.
      const fx = pinch.vx + pinch.mid.x / pinch.zoom, fy = pinch.vy + pinch.mid.y / pinch.zoom;
      setView({ zoom: z, x: fx - mid.x / z, y: fy - mid.y / z });
      return;
    }
    if (pan) {
      const z = getState().view.zoom;
      setView({ x: pan.vx - (p.sx - pan.sx) / z, y: pan.vy - (p.sy - pan.sy) / z });
      return;
    }
    if (toolActive) {
      if (!eq(p.cell, lastCell)) {
        lastCell = p.cell;
        tool().move(p);
      }
      return;
    }
    canvas.style.cursor = keys.space ? "grab" : tool().cursor(p);
  };

  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) pan = null;
    if (toolActive && pointers.size === 0) {
      toolActive = false;
      tool().up(info(e));
    }
  };

  const dblclick = (e: MouseEvent) => {
    tool().dblclick?.(info(e));
  };

  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = info(e);
    const v = getState().view;
    if (e.ctrlKey || e.metaKey) {
      const delta = e.deltaY || e.deltaX;
      if (!delta) return;
      setView(zoomAt(v.zoom * Math.pow(0.998, delta * (e.deltaMode === 1 ? 30 : 1)), p.sx, p.sy));
    } else {
      const dx = e.shiftKey ? e.deltaX || e.deltaY : e.deltaX;
      const dy = e.shiftKey ? 0 : e.deltaY;
      const scale = e.deltaMode === 1 ? 20 : 1;
      setView({ x: v.x + (dx * scale) / v.zoom, y: v.y + (dy * scale) / v.zoom });
    }
  };

  // Right-click (or long-press): select what's under the pointer, unless it's already part of
  // the selection, then open the menu for it.
  const contextmenu = (e: MouseEvent) => {
    e.preventDefault();
    if (toolActive) return;
    finishEditing();
    const p = info(e);
    const hit = hitTest(p.sx, p.sy);
    const id =
      hit.kind === "node" || hit.kind === "handle" ? hit.node
      : hit.kind === "edge" || hit.kind === "endpoint" ? hit.edge
      : null;
    if (!id) select([]);
    else if (!getState().selection.includes(id)) select([id]);
    setMenu({ x: e.clientX, y: e.clientY, cell: p.cell });
  };

  // Middle-click paste (X11 primary selection) would otherwise fire on Linux.
  const auxclick = (e: MouseEvent) => e.button === 1 && e.preventDefault();

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("dblclick", dblclick);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("auxclick", auxclick);
  canvas.addEventListener("contextmenu", contextmenu);
  return () => {
    canvas.removeEventListener("contextmenu", contextmenu);
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", up);
    canvas.removeEventListener("dblclick", dblclick);
    canvas.removeEventListener("wheel", wheel);
    canvas.removeEventListener("auxclick", auxclick);
  };
}
