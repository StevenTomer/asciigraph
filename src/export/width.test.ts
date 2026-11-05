import { describe, expect, it } from "vitest";
import { emptyDiagram } from "../model/ops";
import { drawSource } from "../text/sync";
import { exportText } from "./text";
import { narrowerLayouts, textWidth } from "./width";

describe("export width", () => {
  it("counts columns, comment prefixes included", () => {
    expect(textWidth("ab\n┌──┐")).toBe(4);
    const d = drawSource(emptyDiagram(), { kind: "graph", text: "A --> B", options: {} }, { x: 0, y: 0 }).diagram;
    expect(textWidth(exportText(d, { wrap: { kind: "python" } }))).toBe(textWidth(exportText(d)) + 2);
  });

  it("finds a left-to-right graph that would be narrower top to bottom", () => {
    const { diagram, id } = drawSource(emptyDiagram(), { kind: "graph", text: "flowchart LR\n  A[Browser] --> B[API] --> C[Database]", options: {} }, { x: 0, y: 0 });
    const [n] = narrowerLayouts(diagram, {});
    expect(n).toMatchObject({ source: id, width: 12 });
    const td = drawSource(emptyDiagram(), { kind: "graph", text: "flowchart TD\n  A --> B", options: {} }, { x: 0, y: 0 }).diagram;
    expect(narrowerLayouts(td, {})).toEqual([]);
  });
});
