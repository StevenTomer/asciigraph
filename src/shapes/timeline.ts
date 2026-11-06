import type { Point, Rect } from "../geometry/geom";
import type { LineStyle, Node } from "../model/types";
import type { CharGrid } from "../render/grid";
import { chars, wrap } from "../render/textLayout";
import { box } from "./box";
import type { ShapeDef } from "./registry";

/**
 * A timeline: periods along an axis, each with its events. Its text is the body of a Mermaid
 * `timeline` (the `timeline` line itself is optional):
 *
 *   title Product history
 *   section Planning
 *     2024 : Plan
 *   section Delivery
 *     2025 : Build : Test          2024        2025        2026
 *     2026 : Ship               ───●───────────●───────────●──►
 *          : Celebrate             Plan        Build       Ship
 *                                              Test        Celebrate
 *
 * Drawn across (periods above the axis, events below) or down (periods to the left, events to
 * the right). The axis takes the node's line style; drawn wider than it needs, the periods
 * spread out. Made from text, it sizes itself to fit (autosize), like a table.
 */

export interface Period {
  when: string;
  events: string[];
  /** The section it's in (index into `sections`), if any. */
  section?: number;
}

export interface TimelineText {
  title?: string;
  sections: string[];
  periods: Period[];
}

const HEADER = /^\s*timeline\b\s*$/i;
const COMMENT = /^\s*%%/;

/** Whether text is a Mermaid timeline (its first line says so). */
export function isTimelineText(text: string): boolean {
  const first = text.split("\n").find((l) => l.trim() && !COMMENT.test(l));
  return !!first && HEADER.test(first);
}

export function parseTimeline(text: string): TimelineText {
  const out: TimelineText = { sections: [], periods: [] };
  let section: number | undefined;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line || COMMENT.test(line) || HEADER.test(line)) continue;
    const title = /^title\s+(.*)$/i.exec(line);
    if (title) {
      out.title = title[1].trim();
      continue;
    }
    const sec = /^section\s+(.*)$/i.exec(line);
    if (sec) {
      out.sections.push(sec[1].trim());
      section = out.sections.length - 1;
      continue;
    }
    const parts = line.split(/\s*:\s*/).map((p) => p.trim());
    if (line.startsWith(":") && out.periods.length) {
      // More events for the period above.
      out.periods[out.periods.length - 1].events.push(...parts.slice(1).filter(Boolean));
      continue;
    }
    out.periods.push({ when: parts[0], events: parts.slice(1).filter(Boolean), ...(section !== undefined && { section }) });
  }
  return out;
}

/** A timeline's text as Mermaid. */
export function timelineMermaid(text: string): string {
  const body = text.split("\n").filter((l) => !HEADER.test(l) && l.trim());
  return ["timeline", ...body.map((l) => "    " + l.trim().replace(/^:/, "    :"))].join("\n");
}

const len = (s: string) => chars(s).length;
const GAP = 3, LEAD = 3, TAIL = 3;

type Direction = "across" | "down";
const directionOf = (n: Node): Direction => (n.timeline?.direction === "down" ? "down" : "across");
const styleOf = (n: Node): LineStyle => (n.border === "none" || n.border === "rounded" ? "single" : n.border);

interface Placed {
  chars: [Point, string][];
  axis: Point[];
  markers: Point[];
  /** The axis's arrowhead. */
  end: Point | null;
  size: { w: number; h: number };
}

/** Lay a timeline out at `rect` (its width used when `fixed`; otherwise as wide as it needs). */
function layout(t: TimelineText, dir: Direction, rect: Rect, fixed: boolean): Placed {
  return dir === "down" ? layoutDown(t, rect, fixed) : layoutAcross(t, rect, fixed);
}

function layoutAcross(t: TimelineText, r: Rect, fixed: boolean): Placed {
  const out: Placed = { chars: [], axis: [], markers: [], end: null, size: { w: 0, h: 0 } };
  const put = (x: number, y: number, s: string) => chars(s).forEach((c, i) => out.chars.push([{ x: x + i, y }, c]));
  const n = t.periods.length;
  const natural = t.periods.map((p) => Math.max(1, len(p.when), ...p.events.map(len)));
  // A section's name fits over its periods (and a space before the next): its last one widens.
  t.sections.forEach((name, s) => {
    const cols = t.periods.flatMap((p, i) => (p.section === s ? [i] : []));
    if (!cols.length) return;
    const span = cols.reduce((a, i) => a + natural[i], 0) + GAP * (cols.length - 1);
    const short = len(name) + 2 - GAP - span;
    if (short > 0) natural[cols[cols.length - 1]] += short;
  });
  const need = LEAD + natural.reduce((a, b) => a + b, 0) + GAP * Math.max(0, n - 1) + TAIL;
  let widths = natural, gap = GAP;
  if (fixed && n) {
    const room = r.w - LEAD - TAIL - GAP * (n - 1);
    const sum = natural.reduce((a, b) => a + b, 0);
    if (room < sum) {
      // Narrower than it needs: the widest columns give up room first, down to their longest
      // word, and their text wraps.
      const least = t.periods.map((p) => Math.max(3, ...[p.when, ...p.events].flatMap((s) => s.split(/\s+/)).map(len)));
      widths = [...natural];
      for (let over = sum - room; over > 0; over--) {
        let widest = -1;
        widths.forEach((w, i) => {
          if (w > least[i] && (widest < 0 || w > widths[widest])) widest = i;
        });
        if (widest < 0) break;
        widths[widest]--;
      }
    } else if (n > 1) {
      // Wider: the room goes between the periods.
      gap = GAP + Math.floor((room - sum) / (n - 1));
    }
  }
  const xs: number[] = [];
  let x = r.x + LEAD;
  for (const w of widths) {
    xs.push(x);
    x += w + gap;
  }
  const whens = t.periods.map((p, i) => wrap(p.when, widths[i]));
  const events = t.periods.map((p, i) => p.events.flatMap((e) => wrap(e, widths[i])));
  const whenRows = Math.max(1, ...whens.map((w) => w.length));
  let y = r.y;
  if (t.title) put(r.x, y++, t.title);
  if (t.sections.length) {
    t.sections.forEach((name, s) => {
      const first = t.periods.findIndex((p) => p.section === s);
      if (first >= 0) put(xs[first], y, name);
    });
    y++;
  }
  t.periods.forEach((_, i) => whens[i].forEach((l, k) => put(xs[i], y + whenRows - whens[i].length + k, l)));
  y += whenRows;
  const w = fixed ? r.w : Math.max(need, t.title ? len(t.title) : 0);
  for (let ax = r.x; ax < r.x + w - 1; ax++) out.axis.push({ x: ax, y });
  out.end = { x: r.x + w - 1, y };
  xs.forEach((mx) => out.markers.push({ x: mx, y }));
  events.forEach((ls, i) => ls.forEach((l, k) => put(xs[i], y + 1 + k, l)));
  const h = y - r.y + 1 + Math.max(0, ...events.map((e) => e.length));
  out.size = { w, h };
  return out;
}

function layoutDown(t: TimelineText, r: Rect, fixed: boolean): Placed {
  const out: Placed = { chars: [], axis: [], markers: [], end: null, size: { w: 0, h: 0 } };
  const put = (x: number, y: number, s: string) => chars(s).forEach((c, i) => out.chars.push([{ x: x + i, y }, c]));
  const left = Math.max(1, ...t.periods.map((p) => len(p.when)), ...t.sections.map(len));
  const ax = r.x + left + 1;
  const ex = ax + 2;
  const natural = Math.max(1, ...t.periods.flatMap((p) => p.events.map(len)));
  const room = fixed ? Math.max(3, r.x + r.w - ex) : natural;
  let y = r.y;
  if (t.title) put(r.x, y++, t.title);
  const top = y;
  let section: number | undefined;
  t.periods.forEach((p, i) => {
    if (p.section !== undefined && p.section !== section) {
      section = p.section;
      const name = t.sections[p.section];
      put(ax - 1 - len(name), y, name);
      out.axis.push({ x: ax, y });
      y++;
    }
    put(ax - 1 - len(p.when), y, p.when);
    out.markers.push({ x: ax, y });
    const lines = p.events.flatMap((e) => wrap(e, room));
    lines.forEach((l, k) => put(ex, y + k, l));
    for (let k = 1; k < Math.max(1, lines.length); k++) out.axis.push({ x: ax, y: y + k });
    y += Math.max(1, lines.length);
    if (i < t.periods.length - 1) out.axis.push({ x: ax, y: y++ });
  });
  for (let k = top; k < y; k++) if (!out.axis.some((p) => p.y === k) && !out.markers.some((p) => p.y === k)) out.axis.push({ x: ax, y: k });
  out.end = { x: ax, y };
  const w = fixed ? r.w : Math.max(ex - r.x + natural, t.title ? len(t.title) : 0);
  out.size = { w, h: y - r.y + 1 };
  return out;
}

export const timeline: ShapeDef = {
  ...box,
  label: "timeline",
  defaultSize: { w: 36, h: 4 },
  minSize: () => ({ w: 8, h: 3 }),
  hasBorder: () => false,
  contentRect: (n) => n.rect,

  fitSize(n, text) {
    const t = parseTimeline(text);
    const dir = directionOf(n);
    // Made from text (autosize): just as big as it needs. Sized by hand: that width, and tall
    // enough for it.
    if (n.autosize) return layout(t, dir, n.rect, false).size;
    const l = layout(t, dir, n.rect, true);
    return { w: n.rect.w, h: Math.max(n.rect.h, l.size.h) };
  },

  rasterize(n, grid: CharGrid) {
    const t = parseTimeline(n.text);
    const dir = directionOf(n);
    const l = layout(t, dir, n.rect, true);
    const style = styleOf(n);
    const [back, fore] = dir === "down" ? (["top", "bottom"] as const) : (["left", "right"] as const);
    const inside = (p: Point) => p.y < n.rect.y + n.rect.h && p.x < n.rect.x + n.rect.w;
    const line = [...l.axis, ...l.markers].filter(inside);
    const first = dir === "down" ? Math.min(...line.map((p) => p.y)) : Math.min(...line.map((p) => p.x));
    for (const p of line) {
      const at = dir === "down" ? p.y : p.x;
      grid.stroke(p, at === first ? [fore] : [back, fore], style);
    }
    if (l.end && inside(l.end)) grid.setChar(l.end, dir === "down" ? "▼" : "►");
    for (const p of l.markers) if (inside(p)) grid.setChar(p, "●");
    for (const [p, c] of l.chars) if (inside(p)) grid.setChar(p, c);
  },
};

/** A timeline node for Mermaid timeline text, as big as it needs. */
export function timelineNode(text: string, at: Point): Pick<Node, "kind" | "text" | "autosize" | "border" | "align" | "rect"> {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => !HEADER.test(l));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  // Less the indent the lines share (Mermaid's, under its `timeline` line).
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  const body = lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0).trimEnd()).join("\n");
  const size = layout(parseTimeline(body), "across", { ...at, w: 0, h: 0 }, false).size;
  return { kind: "timeline", text: body, autosize: true, border: "single", align: { h: "left", v: "top" }, rect: { ...at, ...size } };
}
