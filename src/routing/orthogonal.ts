import {
  type Point, type Rect, type Side, OPPOSITE, STEP, bottom, contains, eq, right, stepSide,
} from "../geometry/geom";

/** One end of a route: the first/last cell of the path, and for ends on a node, which way the
 * node's side faces. The path should leave/arrive perpendicular to it: `strict` (arrowheads) makes
 * anything else costly; otherwise it's a slight preference. */
export interface RouteEnd {
  cell: Point;
  dir: Side | null;
  strict?: boolean;
}

const BEND_COST = 4;
/** Not leaving or reaching a node's side straight on: allowed (it may be the only way), but costly
 * for strict ends, and a tie-breaker for the rest. */
const SKEW_COST = 12;
const SOFT_SKEW_COST = 1;
const skewCost = (end: RouteEnd) => (end.strict ? SKEW_COST : SOFT_SKEW_COST);
const GOAL = -1;

export interface Route {
  cells: Point[];
  cost: number;
  /** Leaves and arrives straight on, without going through anything. */
  clean: boolean;
}
const DIRS: Side[] = ["top", "right", "bottom", "left"];

/**
 * An orthogonal path of cells from `start` to `end` that avoids `obstacles` (node rects), using as
 * few bends as it reasonably can. Searches a sparse grid made of the interesting coordinates (the
 * ends, midpoints, and just outside each obstacle), so it stays cheap for diagram-sized inputs.
 * Falls back to a plain L (through whatever is in the way) when no clear path exists.
 */
export function route(start: RouteEnd, end: RouteEnd, obstacles: Rect[]): Route {
  const s = start.cell, e = end.cell;
  if (eq(s, e)) return { cells: [s], cost: 0, clean: true };
  // An end that sits inside an obstacle (overlapping nodes) shouldn't make the route impossible.
  const obs = obstacles.filter((r) => !contains(r, s) && !contains(r, e));

  // Room to loop around the ends themselves, too (a target behind the source).
  const xs = new Set([s.x, e.x, Math.floor((s.x + e.x) / 2), s.x - 2, s.x + 2, e.x - 2, e.x + 2]);
  const ys = new Set([s.y, e.y, Math.floor((s.y + e.y) / 2), s.y - 2, s.y + 2, e.y - 2, e.y + 2]);
  for (const r of obs) {
    for (const x of [r.x - 2, r.x - 1, right(r) + 1, right(r) + 2]) xs.add(x);
    for (const y of [r.y - 2, r.y - 1, bottom(r) + 1, bottom(r) + 2]) ys.add(y);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  const ix = new Map(X.map((v, i) => [v, i]));
  const iy = new Map(Y.map((v, i) => [v, i]));

  const blocked = (p: Point) => obs.some((r) => contains(r, p));
  const segmentClear = (a: Point, b: Point) => {
    const seg: Rect = {
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1,
    };
    return !obs.some(
      (r) => seg.x <= right(r) && r.x <= right(seg) && seg.y <= bottom(r) && r.y <= bottom(seg)
    );
  };

  // Dijkstra over (grid point, direction of travel). Direction 4 = not moving yet.
  const W = X.length, H = Y.length;
  const id = (i: number, j: number, d: number) => (j * W + i) * 5 + d;
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const heap = new MinHeap();
  const startDir = start.dir ? DIRS.indexOf(start.dir) : 4;
  const arriveDir = end.dir ? DIRS.indexOf(OPPOSITE[end.dir]) : -1;
  const si = ix.get(s.x)!, sj = iy.get(s.y)!, ei = ix.get(e.x)!, ej = iy.get(e.y)!;
  const s0 = id(si, sj, startDir);
  dist.set(s0, 0);
  heap.push(0, s0);
  let goal = -1;
  let goalCost = 0;

  while (heap.size) {
    const [cost, u] = heap.pop();
    if (cost > (dist.get(u) ?? Infinity)) continue;
    if (u === GOAL) {
      goal = prev.get(GOAL)!;
      goalCost = cost;
      break;
    }
    const d = u % 5, cellIdx = Math.floor(u / 5), i = cellIdx % W, j = Math.floor(cellIdx / W);
    if (i === ei && j === ej) {
      if (arriveDir < 0 || d === arriveDir) {
        goal = u;
        goalCost = cost;
        break;
      }
      // Arriving from the side: only if nothing straight-on turns up first.
      const gc = cost + skewCost(end);
      if (gc < (dist.get(GOAL) ?? Infinity)) {
        dist.set(GOAL, gc);
        prev.set(GOAL, u);
        heap.push(gc, GOAL);
      }
      continue;
    }
    for (let nd = 0; nd < 4; nd++) {
      if (d < 4 && nd === (d + 2) % 4) continue; // no U-turns in place (or back into the node)
      const ni = i + (nd === 1 ? 1 : nd === 3 ? -1 : 0);
      const nj = j + (nd === 2 ? 1 : nd === 0 ? -1 : 0);
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const a = { x: X[i], y: Y[j] }, b = { x: X[ni], y: Y[nj] };
      if (blocked(b) || !segmentClear(a, b)) continue;
      const step = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const bend = d < 4 && nd !== d ? BEND_COST : 0;
      const skew = u === s0 && start.dir && nd !== startDir ? skewCost(start) : 0;
      const v = id(ni, nj, nd);
      const nc = cost + step + bend + skew;
      if (nc < (dist.get(v) ?? Infinity)) {
        dist.set(v, nc);
        prev.set(v, u);
        heap.push(nc, v);
      }
    }
  }

  if (goal < 0) return { cells: expand([s, { x: e.x, y: s.y }, e]), cost: 1e9, clean: false };
  const corners: Point[] = [];
  for (let u: number | undefined = goal; u !== undefined; u = prev.get(u)) {
    const c = Math.floor(u / 5);
    corners.push({ x: X[c % W], y: Y[Math.floor(c / W)] });
  }
  const cells = expand(corners.reverse());
  const n = cells.length;
  const clean =
    (!start.strict || stepSide(cells[0], cells[1]) === start.dir) &&
    (!end.strict || stepSide(cells[n - 2], cells[n - 1]) === OPPOSITE[end.dir!]);
  return { cells, cost: goalCost, clean };
}

/** Turn a list of corner points into every cell along the way. */
function expand(points: Point[]): Point[] {
  const cells: Point[] = [points[0]];
  for (let k = 1; k < points.length; k++) {
    let p = cells[cells.length - 1];
    const target = points[k];
    while (!eq(p, target)) {
      const step = STEP[stepSide(p, target)];
      p = { x: p.x + step.x, y: p.y + step.y };
      cells.push(p);
    }
  }
  return cells;
}

/** A small binary min-heap of [priority, value]. */
class MinHeap {
  private a: [number, number][] = [];
  get size() {
    return this.a.length;
  }
  push(p: number, v: number) {
    const a = this.a;
    a.push([p, v]);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent][0] <= a[i][0]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
