import {
  type Point, type Rect, type Side, OPPOSITE, STEP, bottom, contains, eq, intersects, right, stepSide,
} from "../geometry/geom";
import type { Occupancy } from "./occupancy";

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
 * With `occupancy`, it also keeps off connectors already routed (see occupancy.ts); `groups` are
 * this connector's end cells, which it may share.
 */
export function route(start: RouteEnd, end: RouteEnd, obstacles: Rect[], occupancy?: Occupancy, groups: string[] = []): Route {
  const s = start.cell, e = end.cell;
  if (eq(s, e)) return { cells: [s], cost: 0, clean: true };
  // An end that sits inside an obstacle (overlapping nodes) shouldn't make the route impossible.
  const all = obstacles.filter((r) => !contains(r, s) && !contains(r, e));
  // Search a window around the two ends, widening it only if nothing is found: most routes are
  // local, and the search grid grows with every obstacle in it.
  const box = { x: Math.min(s.x, e.x), y: Math.min(s.y, e.y), w: Math.abs(s.x - e.x) + 1, h: Math.abs(s.y - e.y) + 1 };
  for (const margin of [8, 24, Infinity]) {
    const win = margin === Infinity ? null : { x: box.x - margin, y: box.y - margin, w: box.w + 2 * margin, h: box.h + 2 * margin };
    const obs = win ? all.filter((r) => intersects(r, win)) : all;
    const found = search(start, end, obs, win, occupancy, groups);
    if (found) return found;
    if (!win || obs.length === all.length) break;
  }
  return { cells: expand([s, { x: e.x, y: s.y }, e]), cost: 1e9, clean: false };
}

/** Dijkstra over a sparse grid of the coordinates that matter, within `win` (null: anywhere). */
function search(start: RouteEnd, end: RouteEnd, obs: Rect[], win: Rect | null, occupancy: Occupancy | undefined, groups: string[]): Route | null {
  const s = start.cell, e = end.cell;

  // Room to loop around the ends themselves, too (a target behind the source).
  const xs = new Set([s.x, e.x, Math.floor((s.x + e.x) / 2), s.x - 2, s.x + 2, e.x - 2, e.x + 2]);
  const ys = new Set([s.y, e.y, Math.floor((s.y + e.y) / 2), s.y - 2, s.y + 2, e.y - 2, e.y + 2]);
  // Tracks one cell clear of each obstacle (a line right against a border looks cramped).
  for (const r of obs) {
    xs.add(r.x - 2).add(right(r) + 2);
    ys.add(r.y - 2).add(bottom(r) + 2);
  }
  // Tracks beside existing connectors, within the area this route could use.
  if (occupancy) {
    const [x0, x1] = win ? [win.x, right(win)] : [Math.min(...xs), Math.max(...xs)];
    const [y0, y1] = win ? [win.y, bottom(win)] : [Math.min(...ys), Math.max(...ys)];
    for (const x of occupancy.xs) if (x >= x0 && x <= x1) xs.add(x);
    for (const y of occupancy.ys) if (y >= y0 && y <= y1) ys.add(y);
  }
  const X = [...xs].sort((a, b) => a - b);
  const Y = [...ys].sort((a, b) => a - b);
  const W = X.length, H = Y.length;
  const at = (i: number, j: number) => j * W + i;

  // Precompute which grid points are inside obstacles, and which grid segments (to the next point
  // right, and down) cross one, by letting each obstacle mark the indices it covers.
  const blocked = new Uint8Array(W * H);
  const crossRight = new Uint8Array(W * H), crossDown = new Uint8Array(W * H);
  /** First index whose coordinate is ≥ v. */
  const lowerBound = (A: number[], v: number) => {
    let lo = 0, hi = A.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (A[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  for (const r of obs) {
    // Points inside: X in [r.x, right], Y in [r.y, bottom].
    const i0 = lowerBound(X, r.x), i1 = lowerBound(X, right(r) + 1) - 1;
    const j0 = lowerBound(Y, r.y), j1 = lowerBound(Y, bottom(r) + 1) - 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) blocked[at(i, j)] = 1;
    // Horizontal segments X[i]..X[i+1] on rows inside the obstacle that overlap its columns.
    const si0 = Math.max(0, lowerBound(X, r.x) - 1), si1 = i1;
    for (let j = j0; j <= j1; j++) for (let i = si0; i <= si1 && i + 1 < W; i++) {
      if (X[i] <= right(r) && X[i + 1] >= r.x) crossRight[at(i, j)] = 1;
    }
    // Vertical segments Y[j]..Y[j+1] in columns inside the obstacle that overlap its rows.
    const sj0 = Math.max(0, lowerBound(Y, r.y) - 1), sj1 = j1;
    for (let i = i0; i <= i1; i++) for (let j = sj0; j <= sj1 && j + 1 < H; j++) {
      if (Y[j] <= bottom(r) && Y[j + 1] >= r.y) crossDown[at(i, j)] = 1;
    }
  }
  const crowdRight = new Float64Array(W * H).fill(NaN), crowdDown = new Float64Array(W * H).fill(NaN);
  /** Crowding cost of the segment between (i,j) and its neighbor in direction nd (either way). */
  const crowd = (i: number, j: number, nd: number) => {
    if (!occupancy) return 0;
    // Store by the segment's top/left end, so both directions share an entry.
    const horizontal = nd === 1 || nd === 3;
    const ai = nd === 3 ? i - 1 : i, aj = nd === 0 ? j - 1 : j;
    const cache = horizontal ? crowdRight : crowdDown;
    let c = cache[at(ai, aj)];
    if (Number.isNaN(c)) {
      const a = { x: X[ai], y: Y[aj] };
      const b = horizontal ? { x: X[ai + 1], y: Y[aj] } : { x: X[ai], y: Y[aj + 1] };
      c = occupancy.segmentCost(a, b, groups);
      cache[at(ai, aj)] = c;
    }
    return c;
  };

  // A* over (grid point, direction of travel); direction 4 = not moving yet. The heuristic is the
  // remaining straight-line (Manhattan) distance, which never overestimates, so routes are still
  // optimal; it just stops the search spreading in every direction.
  const h = (i: number, j: number) => Math.abs(X[i] - e.x) + Math.abs(Y[j] - e.y);
  const GOAL = W * H * 5;
  const dist = new Float64Array(GOAL + 1).fill(Infinity);
  const prev = new Int32Array(GOAL + 1).fill(-1);
  const heap = new MinHeap();
  const startDir = start.dir ? DIRS.indexOf(start.dir) : 4;
  const arriveDir = end.dir ? DIRS.indexOf(OPPOSITE[end.dir]) : -1;
  const si = X.indexOf(s.x), sj = Y.indexOf(s.y), ei = X.indexOf(e.x), ej = Y.indexOf(e.y);
  const s0 = at(si, sj) * 5 + startDir;
  dist[s0] = 0;
  heap.push(h(si, sj), s0);
  let goal = -1;
  let goalCost = 0;

  while (heap.size) {
    const [f, u] = heap.pop();
    if (u === GOAL) {
      if (f > dist[GOAL]) continue;
      goal = prev[GOAL];
      goalCost = f;
      break;
    }
    const d = u % 5, cellIdx = (u - d) / 5, i = cellIdx % W, j = (cellIdx - i) / W;
    const cost = dist[u];
    if (f > cost + h(i, j)) continue; // stale entry
    if (i === ei && j === ej) {
      if (arriveDir < 0 || d === arriveDir) {
        goal = u;
        goalCost = cost;
        break;
      }
      // Arriving from the side: only if nothing straight-on turns up first.
      const gc = cost + skewCost(end);
      if (gc < dist[GOAL]) {
        dist[GOAL] = gc;
        prev[GOAL] = u;
        heap.push(gc, GOAL);
      }
      continue;
    }
    for (let nd = 0; nd < 4; nd++) {
      if (d < 4 && nd === (d + 2) % 4) continue; // no U-turns in place (or back into the node)
      const ni = i + (nd === 1 ? 1 : nd === 3 ? -1 : 0);
      const nj = j + (nd === 2 ? 1 : nd === 0 ? -1 : 0);
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      if (blocked[at(ni, nj)]) continue;
      const crosses = nd === 1 ? crossRight[at(i, j)] : nd === 3 ? crossRight[at(ni, nj)] : nd === 2 ? crossDown[at(i, j)] : crossDown[at(ni, nj)];
      if (crosses) continue;
      const step = Math.abs(X[ni] - X[i]) + Math.abs(Y[nj] - Y[j]);
      const bend = d < 4 && nd !== d ? BEND_COST : 0;
      const skew = u === s0 && start.dir && nd !== startDir ? skewCost(start) : 0;
      const v = at(ni, nj) * 5 + nd;
      const nc = cost + step + bend + skew + crowd(i, j, nd);
      if (nc < dist[v]) {
        dist[v] = nc;
        prev[v] = u;
        heap.push(nc + h(ni, nj), v);
      }
    }
  }

  if (goal < 0) return null;
  const corners: Point[] = [];
  for (let u = goal; u >= 0; u = prev[u]) {
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

/** A binary min-heap of (priority, value) pairs, in two flat arrays (no per-entry objects). */
class MinHeap {
  private p: number[] = [];
  private v: number[] = [];
  get size() {
    return this.p.length;
  }
  push(priority: number, value: number) {
    const { p, v } = this;
    let i = p.length;
    p.push(priority);
    v.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (p[parent] <= priority) break;
      p[i] = p[parent];
      v[i] = v[parent];
      i = parent;
    }
    p[i] = priority;
    v[i] = value;
  }
  pop(): [number, number] {
    const { p, v } = this;
    const top: [number, number] = [p[0], v[0]];
    const lp = p.pop()!, lv = v.pop()!;
    const n = p.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = -1;
        let mp = lp;
        if (l < n && p[l] < mp) { m = l; mp = p[l]; }
        if (r < n && p[r] < mp) { m = r; mp = p[r]; }
        if (m < 0) break;
        p[i] = p[m];
        v[i] = v[m];
        i = m;
      }
      p[i] = lp;
      v[i] = lv;
    }
    return top;
  }
}
