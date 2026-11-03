import type { Point } from "../geometry/geom";

/** Running along another connector, per cell. */
const OVERLAP_COST = 6;
/** Crossing another connector. */
const CROSS_COST = 2;

/** A cell as one number (for fast map keys); coordinates are well within ±32k. */
const cellKey = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768);

/**
 * Cells already used by connectors routed so far, so later ones keep off them: running along
 * another connector is costly, crossing one a little. Connectors that share an end cell (several
 * leaving the same spot on a box) may share cells freely: that's a trunk that fans out.
 */
export class Occupancy {
  /** cell → group keys of the connectors running horizontally / vertically through it. */
  private h = new Map<number, string[]>();
  private v = new Map<number, string[]>();
  readonly xs = new Set<number>();
  readonly ys = new Set<number>();

  add(cells: Point[], groups: string[]) {
    cells.forEach((c, i) => {
      const k = cellKey(c.x, c.y);
      for (const n of [cells[i - 1], cells[i + 1]]) {
        if (!n) continue;
        const horizontal = n.y === c.y;
        const map = horizontal ? this.h : this.v;
        const list = map.get(k);
        if (list) list.push(...groups);
        else map.set(k, [...groups]);
        // Tracks just beside this one, so the router can run parallel instead of on top.
        if (horizontal) this.ys.add(c.y - 1).add(c.y + 1);
        else this.xs.add(c.x - 1).add(c.x + 1);
      }
    });
  }

  /** Extra cost of the straight segment between a and b (both included) for a connector in
   * `groups`. */
  segmentCost(a: Point, b: Point, groups: string[]): number {
    const horizontal = a.y === b.y;
    const along = horizontal ? this.h : this.v;
    const across = horizontal ? this.v : this.h;
    if (!along.size && !across.size) return 0;
    const foreign = (list: string[] | undefined) => {
      if (!list) return false;
      for (const g of list) if (groups.includes(g)) return false;
      return true;
    };
    let cost = 0;
    if (horizontal) {
      for (let x = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x); x <= x1; x++) {
        const k = cellKey(x, a.y);
        if (foreign(along.get(k))) cost += OVERLAP_COST;
        if (foreign(across.get(k))) cost += CROSS_COST;
      }
    } else {
      for (let y = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y); y <= y1; y++) {
        const k = cellKey(a.x, y);
        if (foreign(along.get(k))) cost += OVERLAP_COST;
        if (foreign(across.get(k))) cost += CROSS_COST;
      }
    }
    return cost;
  }
}
