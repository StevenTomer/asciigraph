import { describe, expect, it } from "vitest";
import { lockMates, lockTogether, moveWithLocks, unlock } from "./locks";
import { addNode, deleteObjects, emptyDiagram, makeNode } from "./ops";
import type { Diagram } from "./types";

const at = (d: Diagram, id: string) => [d.nodes[id].rect.x, d.nodes[id].rect.y];
const base = () => ["a", "b", "c", "d"].reduce((d, id, i) => addNode(d, makeNode({ x: i * 10, y: 0, w: 5, h: 3 }, { id })), emptyDiagram());

describe("locks", () => {
  it("moves locked nodes together on the locked axes only", () => {
    let d = lockTogether(base(), ["a", "b"], { x: true, y: false });
    d = moveWithLocks(d, ["a"], { x: 3, y: 4 });
    expect(at(d, "a")).toEqual([3, 4]);
    expect(at(d, "b")).toEqual([13, 0]); // left–right only
    expect(at(d, "c")).toEqual([20, 0]);
  });

  it("chains through locks, passing on only shared axes", () => {
    let d = lockTogether(base(), ["a", "b"], { x: true, y: true });
    d = lockTogether(d, ["b", "c"], { x: false, y: true });
    expect([...lockMates(d, ["a"])].sort()).toEqual([["b", { x: true, y: true }], ["c", { x: false, y: true }]]);
    d = moveWithLocks(d, ["a"], { x: 2, y: 2 });
    expect(at(d, "b")).toEqual([12, 2]);
    expect(at(d, "c")).toEqual([20, 2]);
  });

  it("relocking the same nodes replaces their lock; unlocking and deleting take nodes out", () => {
    let d = lockTogether(base(), ["a", "b"], { x: true, y: false });
    d = lockTogether(d, ["a", "b"], { x: false, y: true });
    expect(Object.values(d.locks!).map((l) => [l.members, l.x, l.y])).toEqual([[["a", "b"], false, true]]);
    d = lockTogether(d, ["b", "c"], { x: true, y: false });
    expect(Object.keys(d.locks!)).toHaveLength(2);
    expect(Object.values(unlock(d, ["b"]).locks ?? {})).toEqual([]); // a and c alone aren't locks
    expect(Object.values(deleteObjects(d, ["a"]).locks!).map((l) => l.members)).toEqual([["b", "c"]]);
  });
});
