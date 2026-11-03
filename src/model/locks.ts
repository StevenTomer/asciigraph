import type { Point } from "../geometry/geom";
import { withContents } from "./containment";
import { moveObjects, newId } from "./ops";
import type { Diagram, Id } from "./types";

/**
 * Locking nodes together: moving one moves the others, left–right, up–down, or both. Locks chain
 * (A locked to B, B to C: moving A moves C), each link passing on only its own axes.
 */

export function lockTogether(d: Diagram, ids: Id[], axes: { x: boolean; y: boolean }): Diagram {
  const members = ids.filter((id) => d.nodes[id]);
  if (members.length < 2 || (!axes.x && !axes.y)) return d;
  // A lock whose members are all in the new one is replaced by it (to change its axes); others
  // stay, so a node can be in several locks, which chain.
  const set = new Set(members);
  const kept = Object.fromEntries(Object.entries(d.locks ?? {}).filter(([, l]) => !l.members.every((m) => set.has(m))));
  const id = newId("e").replace(/^e/, "l");
  return { ...d, locks: { ...kept, [id]: { id, members, ...axes } } };
}

/** Take nodes out of their locks (locks left with fewer than two members go). */
export function unlock(d: Diagram, ids: Iterable<Id>): Diagram {
  if (!d.locks) return d;
  const gone = new Set(ids);
  const locks = Object.fromEntries(
    Object.values(d.locks)
      .map((l) => ({ ...l, members: l.members.filter((m) => !gone.has(m) && d.nodes[m]) }))
      .filter((l) => l.members.length >= 2)
      .map((l) => [l.id, l])
  );
  return { ...d, locks: Object.keys(locks).length ? locks : undefined };
}

/** The locks a node is in. */
export const locksOf = (d: Diagram, id: Id) => Object.values(d.locks ?? {}).filter((l) => l.members.includes(id));

/** Everything that moves along with `ids` through locks, with the axes it moves on. */
export function lockMates(d: Diagram, ids: Id[]): Map<Id, { x: boolean; y: boolean }> {
  const reach = new Map<Id, { x: boolean; y: boolean }>(ids.map((id) => [id, { x: true, y: true }]));
  const queue = [...ids];
  while (queue.length) {
    const id = queue.shift()!;
    const via = reach.get(id)!;
    for (const lock of locksOf(d, id)) {
      const axes = { x: via.x && lock.x, y: via.y && lock.y };
      if (!axes.x && !axes.y) continue;
      for (const m of lock.members) {
        const had = reach.get(m) ?? { x: false, y: false };
        const now = { x: had.x || axes.x, y: had.y || axes.y };
        if (now.x !== had.x || now.y !== had.y) {
          reach.set(m, now);
          queue.push(m);
        }
      }
    }
  }
  for (const id of ids) reach.delete(id);
  return reach;
}

/** Move `ids` by `delta`, and what they're locked to along the locked axes (with its contents). */
export function moveWithLocks(d: Diagram, ids: Id[], delta: Point): Diagram {
  let out = moveObjects(d, ids, delta);
  const groups = new Map<string, Id[]>();
  for (const [id, axes] of lockMates(d, ids)) {
    const k = `${axes.x ? delta.x : 0},${axes.y ? delta.y : 0}`;
    groups.set(k, [...(groups.get(k) ?? []), id]);
  }
  const moving = new Set(ids);
  for (const [k, members] of groups) {
    const [x, y] = k.split(",").map(Number);
    if (!x && !y) continue;
    out = moveObjects(out, withContents(d, members).filter((id) => !moving.has(id)), { x, y });
  }
  return out;
}
