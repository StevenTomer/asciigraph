import { describe, expect, it } from "vitest";
import { addNode, emptyDiagram, makeNode } from "../model/ops";
import { exportText, wrapText } from "./text";

const d = addNode(emptyDiagram(), makeNode({ x: 0, y: 0, w: 5, h: 3 }, { text: "A" }));

describe("export wrapping", () => {
  it("wraps as Markdown and as comment blocks", () => {
    expect(exportText(d, { wrap: { kind: "markdown" } })).toBe("```\n┌───┐\n│ A │\n└───┘\n```");
    expect(exportText(d, { wrap: { kind: "c-line" } })).toBe("// ┌───┐\n// │ A │\n// └───┘");
    expect(exportText(d, { wrap: { kind: "c-block" } })).toBe("/*\n * ┌───┐\n * │ A │\n * └───┘\n */");
    expect(exportText(d, { wrap: { kind: "python" } })).toBe("# ┌───┐\n# │ A │\n# └───┘");
    expect(exportText(d, { wrap: { kind: "bash" }, ascii: true })).toBe("# +---+\n# | A |\n# +---+");
  });

  it("wraps with a custom first line, prefix and last line", () => {
    expect(exportText(d, { wrap: { kind: "custom", first: "<!--", prefix: "  ", last: "-->" } })).toBe("<!--\n  ┌───┐\n  │ A │\n  └───┘\n-->");
    expect(exportText(d, { wrap: { kind: "custom", first: "", prefix: "-- ", last: "" } })).toBe("-- ┌───┐\n-- │ A │\n-- └───┘");
  });

  it("leaves no trailing spaces on empty lines", () => {
    expect(wrapText("a\n\nb", { kind: "c-block" })).toBe("/*\n * a\n *\n * b\n */");
    expect(wrapText("a\n\nb", { kind: "python" })).toBe("# a\n#\n# b");
  });
});
