import { type Point, type Side, OPPOSITE, STEP, add, key, stepSide } from "../geometry/geom";
import { headOf } from "../model/ops";
import type { ResolvedEdge } from "../routing/endpoints";
import { through } from "../shapes/more";
import { DIR_BITS, SIDE_INDEX } from "./charsets";
import type { CharGrid } from "./grid";

/**
 * A bus: a connector drawn as a band three cells wide, two heavy walls either side of its route
 * (which stays blank, so a label sits inside it). How each end looks:
 *  - an arrow (or hollow arrow) narrows to a point:  ━╲ ▶ ━╱
 *  - a bar is a crossbar across the end, apart from the walls:  ━┃ ┃ ━┃
 *  - other heads sit in a cap that closes the band:  ━┓ ◆ ━┛
 *  - no head on a box joins its border (┝); anywhere else the band is left open.
 * (No end closes the band right round, so it can't be mistaken for a box when read back.)
 *
 *   ┌─────┐                         ┃ ┃
 *   │     ┝━━━━━━━━━━━━╲            ┃ ┃
 *   │  A  │   data      ▶│ B │     ╲▼╱
 *   │     ┝━━━━━━━━━━━━╱          ┌─────┐
 *   └─────┘
 *
 * Corners turn as two concentric bends. The walls are ordinary heavy strokes, so they join
 * borders and other lines like any connector.
 */

const FLARES: [string, string] = ["╲", "╱"];

/** The unit vector for a side, and its left-hand normal (screen coordinates: y down). */
const vec = (s: Side): Point => STEP[s];
const normal = (s: Side): Point => ({ x: STEP[s].y, y: -STEP[s].x });
const scale = (p: Point, k: number): Point => ({ x: p.x * k, y: p.y * k });

export type EndKind = "wedge" | "bar" | "cap" | "join" | "open";

/**
 * Draw edge `r` as a bus. `hidden`: cells behind a node it passes behind (not drawn). Returns
 * every cell the bus covers (for clicking) and its two walls (for routing later connectors
 * clear of them).
 */
export function drawBus(grid: CharGrid, r: ResolvedEdge, hidden: (p: Point) => boolean): { cells: Point[]; walls: Point[][] } {
  const cells = r.cells;
  const covered: Point[] = [...cells];
  if (cells.length < 2) {
    const c = cells[0];
    if (!hidden(c)) grid.stroke(c, ["top", "bottom"], "heavy");
    return { cells: covered, walls: [] };
  }
  const n = cells.length;
  // The direction of each step, and the points where the route turns.
  const dirs: Side[] = [];
  for (let k = 1; k < n; k++) dirs.push(stepSide(cells[k - 1], cells[k]));
  const turns: number[] = [];
  for (let k = 1; k < n - 1; k++) if (dirs[k] !== dirs[k - 1]) turns.push(k);

  const edge = r.edge;
  const endKind = (which: "start" | "end"): EndKind => {
    const head = headOf(edge, which);
    if (head === "arrow" || head === "triangle") return "wedge";
    if (head === "bar") return "bar";
    if (head) return "cap";
    const a = which === "start" ? r.from : r.to;
    return a.dir && a.border ? "join" : "open";
  };
  const ends = {
    start: { cell: cells[0], next: cells[1], out: dirs[0], kind: endKind("start"), anchor: r.from, which: "start" as const },
    end: { cell: cells[n - 1], next: cells[n - 2], out: OPPOSITE[dirs[n - 2]], kind: endKind("end"), anchor: r.to, which: "end" as const },
  };

  const walls: Point[][] = [];
  for (const s of [1, -1]) {
    const pts: Point[] = [];
    // A wedge's (and a bar's) walls stop a cell short of the end.
    const short = (kind: EndKind) => kind === "wedge" || kind === "bar";
    const first = short(ends.start.kind) ? cells[1] : cells[0];
    pts.push(add(first, scale(normal(dirs[0]), s)));
    for (const k of turns) {
      const a = normal(dirs[k - 1]), b = normal(dirs[k]);
      pts.push(add(cells[k], { x: s * (a.x + b.x), y: s * (a.y + b.y) }));
    }
    const last = short(ends.end.kind) ? cells[n - 2] : cells[n - 1];
    pts.push(add(last, scale(normal(dirs[n - 2]), s)));
    const wall = through(pts);
    for (let k = 1; k < wall.length; k++) {
      const a = wall[k - 1], b = wall[k];
      if (a.x === b.x && a.y === b.y) continue;
      const dir = stepSide(a, b);
      if (!hidden(a)) grid.stroke(a, dir, "heavy");
      if (!hidden(b)) grid.stroke(b, OPPOSITE[dir], "heavy");
    }
    if (wall.length === 1 && !hidden(wall[0])) grid.stroke(wall[0], dirs[0], "heavy");
    walls.push(wall);
    covered.push(...wall);
  }

  for (const end of [ends.start, ends.end]) {
    const E = end.cell;
    // Which way the line points at this end, and the cells either side of it.
    const pointing = OPPOSITE[end.out];
    const side = normal(end.out);
    const besides = [add(E, side), add(E, scale(side, -1))];
    covered.push(...besides);
    if (end.kind === "wedge") {
      const head = headOf(edge, end.which)!;
      if (!hidden(E)) grid.setArrow(E, pointing, "heavy", head);
      const p = vec(pointing);
      for (const b of besides) {
        if (hidden(b)) continue;
        const o = { x: b.x - E.x, y: b.y - E.y };
        grid.setChar(b, (o.x + p.x) * (o.y + p.y) < 0 ? FLARES[0] : FLARES[1]);
      }
    } else if (end.kind === "bar") {
      // A crossbar three cells long, not joined to the walls.
      for (const b of besides) if (!hidden(b)) grid.stroke(b, stepSide(b, E), "heavy");
      if (!hidden(E)) grid.stroke(E, [stepSide(E, besides[0]), stepSide(E, besides[1])], "heavy");
    } else if (end.kind === "cap") {
      // The walls turn in toward the head in the middle.
      for (const b of besides) if (!hidden(b)) grid.stroke(b, stepSide(b, E), "heavy");
      if (!hidden(E)) grid.setArrow(E, pointing, "heavy", headOf(edge, end.which)!);
    } else if (end.kind === "join") {
      // Run both walls into the box's border and join it there.
      const into = OPPOSITE[end.anchor.dir!];
      const border = end.anchor.border!;
      for (const b of besides) {
        if (hidden(b)) continue;
        const bc = { x: border.x + (b.x - E.x), y: border.y + (b.y - E.y) };
        const c = grid.get(bc);
        // (Only along a straight stretch of border: a corner stays a corner.)
        const along = DIR_BITS[SIDE_INDEX[stepSide(E, besides[0])]] | DIR_BITS[SIDE_INDEX[stepSide(E, besides[1])]];
        if (c && (c.mask & along) === along && c.ch === undefined) {
          grid.stroke(b, into, "heavy");
          grid.stroke(bc, end.anchor.dir!, "heavy");
        }
      }
    }
  }
  const seen = new Set<string>();
  return { cells: covered.filter((p) => !seen.has(key(p)) && !!seen.add(key(p))), walls };
}
