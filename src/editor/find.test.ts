import { describe, expect, it } from "vitest";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode } from "../model/ops";
import { findMatches } from "./find";

describe("find", () => {
  it("matches text, names, labels and end labels, any case, in reading order", () => {
    let d = addNode(emptyDiagram(), makeNode({ x: 20, y: 0, w: 9, h: 3 }, { id: "b", text: "Order service" }));
    d = addNode(d, makeNode({ x: 0, y: 0, w: 9, h: 3 }, { id: "a", text: "Orders" }));
    d = addNode(d, makeNode({ x: 0, y: 10, w: 20, h: 6 }, { id: "f", kind: "frame", text: "", name: "Backend orders" }));
    d = addNode(d, makeNode({ x: 40, y: 20, w: 9, h: 3 }, { id: "c", text: "Billing" }));
    d = addEdge(d, makeEdge({ kind: "attached", node: "c", side: "auto" }, { kind: "attached", node: "a", side: "auto" }, { id: "e1", label: "sends ORDER" }));
    d = addEdge(d, makeEdge({ kind: "attached", node: "a", side: "auto" }, { kind: "attached", node: "b", side: "auto" }, { id: "e2", endLabels: { end: "0..*" } }));
    expect(findMatches(d, "order")).toEqual(["a", "b", "f", "e1"]);
    expect(findMatches(d, "0..")).toEqual(["e2"]);
    expect(findMatches(d, "  ")).toEqual([]);
    expect(findMatches(d, "nothing")).toEqual([]);
  });
});
