import { describe, expect, it } from "vitest";
import { addNode, emptyDiagram, makeNode } from "../model/ops";
import { exportSvg } from "./image";

describe("SVG export", () => {
  const d = addNode(emptyDiagram(), makeNode({ x: 0, y: 0, w: 7, h: 3 }, { text: "a<b" }));

  it("places each character in its cell, in the canvas colours", () => {
    // ┌─────┐ / │ a<b │ / └─────┘, one blank cell of padding; cells are 9×18 px (font.ts defaults).
    const svg = exportSvg(d);
    expect(svg).toContain('width="81" height="90"');
    expect(svg).toContain('<rect width="100%" height="100%" fill="#eceff4"/>');
    expect(svg).toContain('fill="#2e3440"');
    expect(svg).toContain('<text x="9 18 27 36 45 54 63" y="32">┌─────┐</text>');
    // Runs split at spaces; markup in text is escaped.
    expect(svg).toContain('<text x="9" y="50">│</text>');
    expect(svg).toContain('<text x="27 36 45" y="50">a&lt;b</text>');
    expect(svg).toContain('<text x="63" y="50">│</text>');
  });

  it("does dark, transparent, ASCII and an embedded font", () => {
    const svg = exportSvg(d, { theme: "dark", transparent: true, ascii: true }, "AAAA");
    expect(svg).not.toContain("<rect");
    expect(svg).toContain('fill="#d8dee9"');
    expect(svg).toContain("+-----+");
    expect(svg).toContain("url(data:font/woff2;base64,AAAA)");
  });
});
