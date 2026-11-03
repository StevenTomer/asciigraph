import { useEffect, useRef } from "react";
import { type Rect, type Side, bottom, right } from "../geometry/geom";
import { HANDLES, handlePositions } from "../editor/hitTest";
import { attachInput } from "../editor/input";
import { type EditorState, useEditor } from "../editor/store";
import { borderToScreen, cellCenter, cellToScreen, rectToScreen, rendered, screenToCell } from "../editor/view";
import { cellGlyph } from "../render/grid";
import { FONT_FAMILY, FONT_SIZE, metrics } from "../render/font";

/** Counts paints, for tests that need to wait for one. */
export let paintCount = 0;

function colors() {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    bg: v("--color-canvas-bg"),
    grid: v("--color-canvas-grid"),
    text: v("--color-canvas-text"),
    highlight: v("--color-canvas-highlight"),
    accent: v("--color-accent"),
    selection: v("--color-canvas-selection"),
    guide: v("--color-orange"),
  };
}

/** The diagram, drawn as characters, with selection and gesture overlays in pixels on top. */
export function Canvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const detach = attachInput(canvas);
    let frame = 0;
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        paint(canvas, useEditor.getState());
      });
    };
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      schedule();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const unsubscribe = useEditor.subscribe(schedule);
    // Theme changes (dark mode) restyle the CSS variables the painter reads.
    const themeObserver = new MutationObserver(schedule);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    resize();
    return () => {
      detach();
      observer.disconnect();
      themeObserver.disconnect();
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={ref} id="canvas" className="canvas" tabIndex={0} />;
}

function paint(canvas: HTMLCanvasElement, s: EditorState) {
  const dpr = window.devicePixelRatio || 1;
  const ctx = canvas.getContext("2d")!;
  const c = colors();
  const { zoom } = s.view;
  const W = canvas.width / dpr, H = canvas.height / dpr;
  const cw = metrics.cw * zoom, ch = metrics.ch * zoom;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, W, H);

  const tl = screenToCell(0, 0), br = screenToCell(W, H);
  const visible: Rect = { x: tl.x - 1, y: tl.y - 1, w: br.x - tl.x + 3, h: br.y - tl.y + 3 };

  if (s.grid && zoom >= 0.5) {
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = visible.x; x <= right(visible); x++) {
      const px = Math.round(cellToScreen(x, 0).x) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, H);
    }
    for (let y = visible.y; y <= bottom(visible); y++) {
      const py = Math.round(cellToScreen(0, y).y) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(W, py);
    }
    ctx.stroke();
  }

  const r = rendered(s.diagram);

  // Selected edges: tint their cells.
  ctx.fillStyle = c.highlight;
  for (const id of s.selection) {
    const e = r.edges.get(id);
    if (!e) continue;
    for (const cell of e.cells) {
      const p = cellToScreen(cell.x, cell.y);
      ctx.fillRect(p.x, p.y, cw, ch);
    }
  }

  // The characters.
  ctx.fillStyle = c.text;
  ctx.font = `${FONT_SIZE * zoom}px ${FONT_FAMILY}`;
  ctx.textBaseline = "alphabetic";
  const editing = s.editing && s.diagram.nodes[s.editing.id];
  for (const [k, cell] of r.grid.cells) {
    const [x, y] = k.split(",").map(Number);
    if (x < visible.x || x > right(visible) || y < visible.y || y > bottom(visible)) continue;
    const g = cellGlyph(cell, false);
    if (!g || g === " ") continue;
    const p = cellToScreen(x, y);
    ctx.fillText(g, p.x, p.y + metrics.baseline * zoom);
  }

  ctx.lineWidth = 1.5;

  // Selected nodes: outline, plus resize handles when one is selected.
  ctx.strokeStyle = c.accent;
  const selectedNodes = s.selection.filter((id) => s.diagram.nodes[id]);
  for (const id of selectedNodes) {
    const box = borderToScreen(s.diagram.nodes[id].rect);
    ctx.strokeRect(box.x - 4, box.y - 4, box.w + 8, box.h + 8);
  }
  if (selectedNodes.length === 1 && !editing) {
    const hp = handlePositions(s.diagram.nodes[selectedNodes[0]].rect);
    ctx.fillStyle = c.bg;
    for (const h of HANDLES) {
      ctx.fillRect(hp[h].x - 4, hp[h].y - 4, 8, 8);
      ctx.strokeRect(hp[h].x - 4, hp[h].y - 4, 8, 8);
    }
  }

  // Selected edges: endpoint handles. Filled = attached to a node, hollow = free.
  for (const id of s.selection) {
    const e = r.edges.get(id);
    if (!e) continue;
    for (const [cell, ep] of [[e.cells[0], e.edge.from], [e.cells[e.cells.length - 1], e.edge.to]] as const) {
      const p = cellCenter(cell);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = ep.kind === "attached" ? c.accent : c.bg;
      ctx.fill();
      ctx.stroke();
    }
  }

  // Bend points of selected connectors: small squares.
  for (const id of s.selection) {
    const e = r.edges.get(id);
    for (const v of e?.edge.via ?? []) {
      const p = cellCenter(v);
      ctx.fillStyle = c.bg;
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
      ctx.strokeRect(p.x - 4, p.y - 4, 8, 8);
    }
  }

  // Where a dragged end would attach: the node, and its side if pinned.
  const attach = s.overlay.attach;
  if (attach && s.diagram.nodes[attach.node]) {
    const box = borderToScreen(s.diagram.nodes[attach.node].rect);
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(box.x - 5, box.y - 5, box.w + 10, box.h + 10);
    ctx.restore();
    if (attach.side) {
      ctx.lineWidth = 3;
      sideLine(ctx, box, attach.side);
      ctx.lineWidth = 1.5;
    }
  }

  // Alignment guides while snapping: dashed lines through the matching borders/centres.
  if (s.overlay.guides?.length) {
    ctx.save();
    ctx.strokeStyle = c.guide;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    for (const g of s.overlay.guides) {
      if (g.axis === "x") {
        const a = cellCenter({ x: g.at, y: g.from }), b = cellCenter({ x: g.at, y: g.to });
        ctx.moveTo(Math.round(a.x) + 0.5, a.y - 12);
        ctx.lineTo(Math.round(a.x) + 0.5, b.y + 12);
      } else {
        const a = cellCenter({ x: g.from, y: g.at }), b = cellCenter({ x: g.to, y: g.at });
        ctx.moveTo(a.x - 12, Math.round(a.y) + 0.5);
        ctx.lineTo(b.x + 12, Math.round(a.y) + 0.5);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  const marquee = s.overlay.marquee;
  if (marquee) {
    const box = rectToScreen(marquee);
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  }

  // w×h while creating or resizing a box.
  const sizeOf = s.overlay.sizeOf;
  if (sizeOf) {
    const box = rectToScreen(sizeOf);
    const label = `${sizeOf.w}×${sizeOf.h}`;
    ctx.font = `12px ${FONT_FAMILY}`;
    const w = ctx.measureText(label).width + 8;
    ctx.fillStyle = c.accent;
    ctx.fillRect(box.x + box.w + 6, box.y + box.h + 4, w, 16);
    ctx.fillStyle = c.bg;
    ctx.fillText(label, box.x + box.w + 10, box.y + box.h + 16);
  }
  paintCount++;
}

function sideLine(ctx: CanvasRenderingContext2D, b: { x: number; y: number; w: number; h: number }, side: Side) {
  ctx.beginPath();
  if (side === "top") { ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.w, b.y); }
  if (side === "bottom") { ctx.moveTo(b.x, b.y + b.h); ctx.lineTo(b.x + b.w, b.y + b.h); }
  if (side === "left") { ctx.moveTo(b.x, b.y); ctx.lineTo(b.x, b.y + b.h); }
  if (side === "right") { ctx.moveTo(b.x + b.w, b.y); ctx.lineTo(b.x + b.w, b.y + b.h); }
  ctx.stroke();
}
