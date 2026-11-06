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
  /** Lines between sections (cells, in order along each line): down the page across, or across
   * it down. */
  rules: Point[][];
  /** The axis's arrowhead. */
  end: Point | null;
  size: { w: number; h: number };
}

/** Where each period's point was put by hand (`Node.timeline.at`): cells along the axis from the
 * timeline's left (across) or top (down), or undefined to go where it would by itself. */
type Pins = (number | undefined)[];

/** A period's key in `Node.timeline.at`: what it's called, and which one of that name. */
export function periodKey(t: TimelineText, i: number): string {
  const when = t.periods[i].when;
  const n = t.periods.slice(0, i).filter((p) => p.when === when).length;
  return n ? `${when}#${n + 1}` : when;
}

const pinsOf = (n: Node, t: TimelineText): Pins => t.periods.map((_, i) => n.timeline?.at?.[periodKey(t, i)]);

/** Points are at least this far past the text of the one before (across). */
const MIN_GAP = 2;

/** Lay a timeline out at `rect` (its width used when `fixed`; otherwise as wide as it needs). */
function layout(t: TimelineText, dir: Direction, rect: Rect, fixed: boolean, pins: Pins = []): Placed {
  return dir === "down" ? layoutDown(t, rect, fixed, pins) : layoutAcross(t, rect, fixed, pins);
}

function layoutAcross(t: TimelineText, r: Rect, fixed: boolean, pins: Pins): Placed {
  const out: Placed = { chars: [], axis: [], markers: [], rules: [], end: null, size: { w: 0, h: 0 } };
  const put = (x: number, y: number, s: string) => chars(s).forEach((c, i) => out.chars.push([{ x: x + i, y }, c]));
  const n = t.periods.length;
  const natural = t.periods.map((p) => Math.max(1, len(p.when), ...p.events.map(len)));
  // A section's name fits over its periods (the line between sections comes after): its last
  // one widens.
  t.sections.forEach((name, s) => {
    const cols = t.periods.flatMap((p, i) => (p.section === s ? [i] : []));
    if (!cols.length) return;
    const span = cols.reduce((a, i) => a + natural[i], 0) + GAP * (cols.length - 1);
    const short = len(name) - span;
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
  // Each point where it goes by itself, or where it was put; but in order, and never on the text
  // of the one before (which it pushes along).
  const xs: number[] = [];
  let x = r.x + LEAD;
  widths.forEach((w, i) => {
    // A new section's first point leaves room for the line between sections.
    const opens = i > 0 && t.periods[i].section !== undefined && t.periods[i].section !== t.periods[i - 1].section;
    const least = i ? xs[i - 1] + widths[i - 1] + (opens ? GAP : MIN_GAP) : r.x + 1;
    xs.push(Math.max(pins[i] !== undefined ? r.x + pins[i]! : x, least));
    x = Math.max(x, xs[i]) + w + gap;
  });
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
  const reach = n ? xs[n - 1] + widths[n - 1] + TAIL - r.x : need;
  const w = fixed ? r.w : Math.max(need, reach, t.title ? len(t.title) : 0);
  for (let ax = r.x; ax < r.x + w - 1; ax++) out.axis.push({ x: ax, y });
  out.end = { x: r.x + w - 1, y };
  xs.forEach((mx) => out.markers.push({ x: mx, y }));
  events.forEach((ls, i) => ls.forEach((l, k) => put(xs[i], y + 1 + k, l)));
  const h = y - r.y + 1 + Math.max(0, ...events.map((e) => e.length));
  // Between sections: a line from the section names down, crossing the axis, midway between.
  const from = r.y + (t.title ? 1 : 0);
  const to = fixed ? r.y + r.h - 1 : r.y + h - 1;
  t.periods.forEach((p, i) => {
    if (!i || p.section === undefined || p.section === t.periods[i - 1].section) return;
    const end = xs[i - 1] + widths[i - 1];
    const rx = end + Math.floor((xs[i] - end - 1) / 2);
    const line: Point[] = [];
    for (let ry = from; ry <= to; ry++) line.push({ x: rx, y: ry });
    out.rules.push(line);
  });
  out.size = { w, h };
  return out;
}

function layoutDown(t: TimelineText, r: Rect, fixed: boolean, pins: Pins): Placed {
  const out: Placed = { chars: [], axis: [], markers: [], rules: [], end: null, size: { w: 0, h: 0 } };
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
  // The row after the last one used, and where the next point goes by itself (a row's gap).
  let next = top, auto = top;
  const rulesAt: number[] = [];
  t.periods.forEach((p, i) => {
    const opens = p.section !== undefined && p.section !== section;
    // A section's name takes the row above its first point, and a line between sections the row
    // above that (after the first).
    const ruled = opens && i > 0;
    const least = next + (opens ? 1 : 0) + (ruled ? 1 : 0);
    const at = Math.max(pins[i] !== undefined ? r.y + pins[i]! : auto + (opens ? 1 : 0), least);
    if (ruled) rulesAt.push(at - 2);
    if (opens) {
      section = p.section;
      const name = t.sections[p.section!];
      put(ax - 1 - len(name), at - 1, name);
    }
    put(ax - 1 - len(p.when), at, p.when);
    out.markers.push({ x: ax, y: at });
    const lines = p.events.flatMap((e) => wrap(e, room));
    lines.forEach((l, k) => put(ex, at + k, l));
    next = at + Math.max(1, lines.length);
    auto = Math.max(auto + (opens ? 1 : 0), at) + Math.max(1, lines.length) + 1;
  });
  y = next;
  for (let k = top; k < y; k++) if (!out.markers.some((p) => p.y === k)) out.axis.push({ x: ax, y: k });
  out.end = { x: ax, y };
  const w = fixed ? r.w : Math.max(ex - r.x + natural, t.title ? len(t.title) : 0);
  for (const ry of rulesAt) out.rules.push(Array.from({ length: w }, (_, k) => ({ x: r.x + k, y: ry })));
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
    const pins = pinsOf(n, t);
    if (n.autosize) return layout(t, dir, n.rect, false, pins).size;
    const l = layout(t, dir, n.rect, true, pins);
    return { w: n.rect.w, h: Math.max(n.rect.h, l.size.h) };
  },

  rasterize(n, grid: CharGrid) {
    const t = parseTimeline(n.text);
    const dir = directionOf(n);
    // (Sized to fit: laid out as it fits, not spread over its width.)
    const l = layout(t, dir, n.rect, !n.autosize, pinsOf(n, t));
    const style = styleOf(n);
    const [back, fore] = dir === "down" ? (["top", "bottom"] as const) : (["left", "right"] as const);
    const inside = (p: Point) => p.y < n.rect.y + n.rect.h && p.x < n.rect.x + n.rect.w;
    const line = [...l.axis, ...l.markers].filter(inside);
    const first = dir === "down" ? Math.min(...line.map((p) => p.y)) : Math.min(...line.map((p) => p.x));
    for (const p of line) {
      const at = dir === "down" ? p.y : p.x;
      grid.stroke(p, at === first ? [fore] : [back, fore], style);
    }
    for (const rule of l.rules) {
      const cells = rule.filter(inside);
      cells.forEach((p, k) => {
        const dirs = dir === "down" ? (["left", "right"] as const) : (["top", "bottom"] as const);
        grid.stroke(p, k === 0 ? [dirs[1]] : k === cells.length - 1 ? [dirs[0]] : [...dirs], style);
      });
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

/** Each period's point (its ● cell), in order. */
export function timelinePoints(n: Node): Point[] {
  if (n.kind !== "timeline") return [];
  const t = parseTimeline(n.text);
  return layout(t, directionOf(n), n.rect, !n.autosize, pinsOf(n, t)).markers;
}

/** The direction a timeline's points move in. */
export const timelineAxis = (n: Node): "x" | "y" => (directionOf(n) === "down" ? "y" : "x");

/**
 * Period `i`'s point moved to `cell` (along the axis; kept in order and clear of its neighbors,
 * which it pushes along), or back where it goes by itself (`cell` null). The timeline grows to
 * keep it all in.
 */
export function withPoint(n: Node, i: number, cell: Point | null): Partial<Node> {
  const t = parseTimeline(n.text);
  if (!t.periods[i]) return {};
  const dir = directionOf(n);
  const at = { ...n.timeline?.at };
  const key = periodKey(t, i);
  if (cell) at[key] = dir === "down" ? cell.y - n.rect.y : cell.x - n.rect.x;
  else delete at[key];
  // Where it actually lands (not before the one before it).
  const pins = t.periods.map((_, k) => at[periodKey(t, k)]);
  const placed = layout(t, dir, n.rect, !n.autosize, pins).markers[i];
  if (cell) at[key] = dir === "down" ? placed.y - n.rect.y : placed.x - n.rect.x;
  return withPins(n, t, at);
}

/** Every point back where it goes by itself. */
export function withoutPoints(n: Node): Partial<Node> {
  return withPins(n, parseTimeline(n.text), {});
}

function withPins(n: Node, t: TimelineText, at: Record<string, number>): Partial<Node> {
  const timeline = { ...n.timeline, at: Object.keys(at).length ? at : undefined };
  if (!timeline.at) delete timeline.at;
  const m = { ...n, timeline };
  const pins = pinsOf(m, t);
  const need = layout(t, directionOf(n), n.rect, false, pins).size;
  const size = n.autosize ? need : { w: Math.max(n.rect.w, need.w), h: Math.max(n.rect.h, layout(t, directionOf(n), { ...n.rect, w: Math.max(n.rect.w, need.w) }, true, pins).size.h) };
  return { timeline: Object.keys(timeline).length ? timeline : undefined, rect: { ...n.rect, ...size } };
}
