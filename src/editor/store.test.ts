import { beforeEach, describe, expect, it } from "vitest";
import { addNode, emptyDiagram, makeNode, moveObjects } from "../model/ops";
import { apply, begin, cancel, commit, getState, load, redo, select, set, undo } from "./store";

const n = makeNode({ x: 0, y: 0, w: 4, h: 3 }, { id: "n" });

describe("history", () => {
  beforeEach(() => load(emptyDiagram(), "test", "test"));

  it("undoes and redoes one-shot edits", () => {
    apply((d) => addNode(d, n));
    expect(getState().diagram.nodes.n).toBeDefined();
    undo();
    expect(getState().diagram.nodes.n).toBeUndefined();
    redo();
    expect(getState().diagram.nodes.n).toBeDefined();
  });

  it("makes a whole gesture one undo step", () => {
    apply((d) => addNode(d, n));
    begin();
    for (let i = 1; i <= 5; i++) set(moveObjects(getState().diagram, ["n"], { x: 1, y: 0 }));
    commit();
    expect(getState().diagram.nodes.n.rect.x).toBe(5);
    undo();
    expect(getState().diagram.nodes.n.rect.x).toBe(0);
    expect(getState().past).toHaveLength(1);
  });

  it("records nothing for a gesture that changed nothing, and cancel restores", () => {
    begin();
    commit();
    expect(getState().past).toHaveLength(0);
    apply((d) => addNode(d, n));
    begin();
    set(moveObjects(getState().diagram, ["n"], { x: 3, y: 3 }));
    cancel();
    expect(getState().diagram.nodes.n.rect).toMatchObject({ x: 0, y: 0 });
  });

  it("drops selected ids that undo removed", () => {
    apply((d) => addNode(d, n));
    select(["n"]);
    undo();
    expect(getState().selection).toEqual([]);
  });

  it("a new edit clears redo", () => {
    apply((d) => addNode(d, n));
    undo();
    apply((d) => addNode(d, { ...n, id: "m" }));
    expect(getState().future).toHaveLength(0);
  });
});
