import { type Point, type Side, OPPOSITE, STEP, add } from "../geometry/geom";
import { makeEdge } from "../model/ops";
import type { Head } from "../model/types";
import { DIR_BITS, SIDE_INDEX, asciiChar } from "../render/charsets";
import { CharGrid } from "../render/grid";
import { drawBus } from "../render/bus";
import type { Anchor } from "../routing/endpoints";

/**
 * Reading buses (render/bus.ts) back from a drawing: two walls two cells apart with nothing
 * between them, ended as a bus is (a point, a crossbar, a cap round a head, joined to a border,
 * or open). Each one found is checked by drawing it again (every drawn cell must be there).
 */

export interface BusEnv<B> {
  ch: (x: number, y: number) => string;
  /** The line strokes in a cell (charsets bits), 0 for none. */
  maskAt: (x: number, y: number) => number;
  /** Part of a box's outline (not a line). */
  isOutline: (x: number, y: number) => boolean;
  /** Drawn with ASCII characters. */
  isAscii: (x: number, y: number) => boolean;
  /** A heavy stroke (Unicode). */
  isHeavy: (x: number, y: number) => boolean;
  /** The box whose border cell this is, on `side` (facing outward that way). */
  boxAt: (border: Point, side: Side) => B | null;
  /** What a head character is (from the importer's table). */
  headOf: (c: string) => { head: Head; points: Side | null } | undefined;
}

export interface BusEnd<B> {
  cell: Point;
  head?: Head;
  box?: B;
  side?: Side;
  border?: Point;
}

export interface FoundBus<B> {
  from: BusEnd<B>;
  to: BusEnd<B>;
  /** The route: the cells down the middle. */
  path: Point[];
  label?: string;
  labelAt?: { start: Point; cell: Point };
  /** The strokes it drew, per cell, to take off the drawing's lines. */
  strokes: { p: Point; mask: number }[];
  /** Every cell that's part of it (walls, ends, the middle and its label). */
  cells: Point[];
}

const normal = (s: Side): Point => ({ x: STEP[s].y, y: -STEP[s].x });
const sideOf = (v: Point): Side => (v.x > 0 ? "right" : v.x < 0 ? "left" : v.y > 0 ? "bottom" : "top");
const neg = (v: Point): Point => ({ x: -v.x, y: -v.y });
const LEFT_OF: Record<Side, Side> = { right: "top", top: "left", left: "bottom", bottom: "right" };
const BIT = (s: Side) => DIR_BITS[SIDE_INDEX[s]];
const k = (p: Point) => `${p.x},${p.y}`;

type Kind = "wedge" | "bar" | "cap" | "join" | "open";

export function findBuses<B>(env: BusEnv<B>, W: number, H: number): FoundBus<B>[] {
  const m = (p: Point) => env.maskAt(p.x, p.y);
  const c = (p: Point) => env.ch(p.x, p.y);
  const wall = (p: Point) => m(p) !== 0 && !env.isOutline(p.x, p.y);
  const middle = (p: Point) => m(p) === 0 && !env.isOutline(p.x, p.y);
  const FLARE = (o: Point, d: Side) => {
    const v = STEP[d];
    return (o.x + v.x) * (o.y + v.y) < 0 ? ["╲", "\\"] : ["╱", "/"];
  };

  /** From middle cell `p` heading `d`: the cells on to the end, and how that end looks. */
  const walk = (start: Point, dir: Side) => {
    const path = [start];
    const seen = new Set([k(start)]);
    let p = start, d = dir;
    let kind: Kind = "open";
    let head: Head | undefined;
    for (;;) {
      const n = normal(d), q = add(p, STEP[d]);
      const qa = add(q, n), qb = add(q, neg(n));
      const h = env.headOf(c(q));
      const toward = (b: Point) => BIT(sideOf({ x: q.x - b.x, y: q.y - b.y }));
      if (h && h.points === d && FLARE(n, d).includes(c(qa)) && FLARE(neg(n), d).includes(c(qb))) {
        kind = "wedge"; head = h.head; path.push(q); break;
      }
      if (h && !h.points && (m(qa) & toward(qa)) && (m(qb) & toward(qb))) {
        kind = "cap"; head = h.head; path.push(q); break;
      }
      const across = BIT(sideOf(n)) | BIT(sideOf(neg(n))), back = BIT(OPPOSITE[d]);
      if ((m(q) & across) === across && !(m(q) & back) && !env.isOutline(q.x, q.y) && [qa, qb].every((b) => (m(b) & toward(b)) && !(m(b) & back))) {
        kind = "bar"; head = "bar"; path.push(q); break;
      }
      // Straight on between both walls; else round a turn; else on to a turn's middle (where
      // the inner wall has already turned away).
      let moved = false;
      // (Another connector may cross: ┿ │ ┿.)
      const through = BIT(sideOf(n)) | BIT(sideOf(neg(n)));
      const crossed = m(q) === through && !env.isOutline(q.x, q.y) &&
        (m(qa) & through) === through && (m(qb) & through) === through && m(add(q, STEP[d])) === 0;
      if ((middle(q) || crossed) && wall(qa) && wall(qb) && !seen.has(k(q))) {
        p = q; moved = true;
      } else {
        for (const t of [LEFT_OF[d], OPPOSITE[LEFT_OF[d]]]) {
          const q2 = add(p, STEP[t]), n2 = normal(t);
          if (middle(q2) && !seen.has(k(q2)) && wall(add(q2, n2)) && wall(add(q2, neg(n2))) && wall(q)) {
            p = q2; d = t; moved = true;
            break;
          }
        }
        if (!moved && middle(q) && !seen.has(k(q)) && (wall(qa) || wall(qb)) && wall(add(q, STEP[d]))) {
          p = q; moved = true;
        }
      }
      if (!moved) {
        kind = env.isOutline(q.x, q.y) ? "join" : "open";
        break;
      }
      path.push(p);
      seen.add(k(p));
    }
    // The direction the line points at its end.
    const last = path[path.length - 1], before = path[path.length - 2] ?? start;
    const pointing = path.length > 1 ? sideOf({ x: last.x - before.x, y: last.y - before.y }) : dir;
    return { path, kind, head, pointing };
  };

  const found: FoundBus<B>[] = [];
  const claimed = new Set<string>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const s = { x, y };
      if (claimed.has(k(s)) || !middle(s)) continue;
      for (const d of ["right", "bottom"] as Side[]) {
        const n = normal(d);
        const straight = BIT(d) | BIT(OPPOSITE[d]);
        if (m(add(s, n)) !== straight || m(add(s, neg(n))) !== straight) continue;
        const fwd = walk(s, d), back = walk(s, OPPOSITE[d]);
        const path = [...back.path.reverse(), ...fwd.path.slice(1)];
        for (const p of path) claimed.add(k(p));
        if (path.length < 3) continue;
        const bus = check(env, path, back, fwd);
        if (bus) {
          found.push(bus);
          for (const p of bus.cells) claimed.add(k(p));
          break;
        }
      }
    }
  }
  return found;
}

/** Make the bus `path` describes, draw it, and keep it if the drawing has all of it. */
function check<B>(
  env: BusEnv<B>, path: Point[],
  a: { kind: Kind; head?: Head; pointing: Side }, b: { kind: Kind; head?: Head; pointing: Side },
): FoundBus<B> | null {
  const end = (cell: Point, e: typeof a): BusEnd<B> & { anchor: Anchor } => {
    const border = add(cell, STEP[e.pointing]);
    const side = OPPOSITE[e.pointing];
    const box = env.isOutline(border.x, border.y) ? env.boxAt(border, side) : null;
    if (e.kind === "join" && !box) return { cell, anchor: { cell, dir: null, border: null, node: null } };
    return {
      cell, head: e.head,
      ...(box && { box, side, border }),
      anchor: { cell, dir: box ? side : null, border: box ? border : null, node: box ? "box" : null },
    };
  };
  const from = end(path[0], a), to = end(path[path.length - 1], b);
  if ((a.kind === "join" && !from.box) || (b.kind === "join" && !to.box)) return null;
  const edge = makeEdge({ kind: "free", at: path[0] }, { kind: "free", at: path[path.length - 1] }, {
    line: "bus",
    arrows: { start: !!a.head, end: !!b.head },
    heads: { ...(a.head && a.head !== "arrow" && { start: a.head }), ...(b.head && b.head !== "arrow" && { end: b.head }) },
  });
  const grid = new CharGrid();
  const drawn = drawBus(grid, { edge, from: from.anchor, to: to.anchor, cells: path }, () => false);
  const strokes: { p: Point; mask: number }[] = [];
  let ascii = false, light = 0;
  for (const [key, cell] of grid.cells) {
    const [x, y] = key.split(",").map(Number);
    const got = env.ch(x, y);
    if (cell.ch !== undefined) {
      if (got !== cell.ch && got !== asciiChar(cell.ch)) return null;
    } else if (cell.arrow) {
      const h = env.headOf(got);
      if (!h || (h.points && h.points !== cell.arrow)) return null;
      // (ASCII draws a hollow arrow sideways like an arrow.)
      if (h.head !== cell.head && !(env.isAscii(x, y) && cell.head === "triangle" && h.head === "arrow")) return null;
    } else if (cell.mask) {
      if ((env.maskAt(x, y) & cell.mask) !== cell.mask || env.isOutline(x, y)) return null;
      if (env.isAscii(x, y)) ascii = true;
      else if (!env.isHeavy(x, y)) light++;
      strokes.push({ p: { x, y }, mask: cell.mask });
    }
  }
  // Heavy walls (a junction where another line crosses may be drawn mixed: ┿).
  if (light * 5 > strokes.length) return null;
  // In ASCII, two plain lines side by side look just like a bus with plain ends: it takes a head.
  if (ascii && !a.head && !b.head) return null;
  // Walls joined to a border: their stroke into it goes too.
  for (const [e, kind] of [[from, a.kind], [to, b.kind]] as const) {
    if (kind !== "join" || !e.side) continue;
    const n = normal(e.side);
    for (const o of [n, neg(n)]) strokes.push({ p: add(e.cell, o), mask: BIT(OPPOSITE[e.side]) });
  }
  // A crossbar goes whole.
  for (const [e, end] of [[from, a], [to, b]] as const) {
    if (end.kind !== "bar") continue;
    const n = normal(end.pointing);
    for (const p of [e.cell, add(e.cell, n), add(e.cell, neg(n))]) strokes.push({ p, mask: env.maskAt(p.x, p.y) });
  }
  // A label: text down the middle, on one row.
  const text = path.slice(1, -1).filter((p) => env.ch(p.x, p.y) !== " " && !env.maskAt(p.x, p.y));
  let label: string | undefined, labelAt: FoundBus<B>["labelAt"];
  const cells = [...drawn.cells, ...path];
  if (text.length && text.every((p) => p.y === text[0].y)) {
    const xs = text.map((p) => p.x);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y = text[0].y;
    let s = "";
    for (let x = x0; x <= x1; x++) s += env.ch(x, y);
    label = s;
    labelAt = { start: { x: x0, y }, cell: { x: x0 + Math.floor((x1 - x0) / 2), y } };
  } else if (text.length) {
    return null;
  }
  const { anchor: _f, ...f } = from, { anchor: _t, ...t } = to;
  return { from: f, to: t, path, label, labelAt, strokes, cells };
}
