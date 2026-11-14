import { describe, expect, it } from "vitest";
import { addNode, emptyDiagram, makeNode } from "../model/ops";
import { diagramToText } from "../render/rasterize";
import { importAscii } from "../text/ascii";
import { ellipseOutline } from "./ellipse";
import { ellipse } from "./ellipse";

const drawn = (w: number, h: number, text: string, ascii = false) =>
  diagramToText(addNode(emptyDiagram(), makeNode({ x: 0, y: 0, w, h }, { kind: "ellipse", text })), ascii);

describe("circles", () => {
  it("draws a circle in steps, and in ASCII with . and '", () => {
    expect(drawn(21, 7, "a bigger circle")).toBe([
      "     ╭─────────╮",
      "  ╭──╯         ╰──╮",
      "╭─╯   a bigger    ╰─╮",
      "│      circle       │",
      "╰─╮               ╭─╯",
      "  ╰──╮         ╭──╯",
      "     ╰─────────╯",
    ].join("\n"));
    expect(drawn(11, 5, "circle", true)).toBe([
      "  .-----.",
      ".-'     '-.",
      "| circle  |",
      "'-.     .-'",
      "  '-----'",
    ].join("\n"));
  });

  it("fills its rect with one closed outline, at every size", () => {
    for (let h = 5; h <= 15; h += 2) {
      for (let w = 9; w <= 40; w++) {
        const cells = ellipseOutline({ x: 0, y: 0, w, h });
        const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
        expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([0, w - 1, 0, h - 1]);
        // Each cell next to the one before, all the way round.
        for (let i = 0; i < cells.length; i++) {
          const a = cells[i], b = cells[(i + 1) % cells.length];
          expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBe(1);
        }
      }
    }
  });

  it("reads back as a circle, at every size, in Unicode and ASCII", () => {
    for (let h = 5; h <= 11; h += 2) {
      for (let w = 9; w <= 30; w++) {
        for (const ascii of [false, true]) {
          const text = drawn(w, h, "hi", ascii);
          const d = importAscii(text).diagram;
          const nodes = Object.values(d.nodes);
          expect(nodes.map((n) => [n.kind, n.text, n.rect.w, n.rect.h])).toEqual([["ellipse", "hi", w, h]]);
          expect(diagramToText(d, ascii)).toBe(text);
        }
      }
    }
  });

  it("is only an odd number of rows tall", () => {
    expect(ellipse.normalize!({ x: 0, y: 0, w: 12, h: 6 }).h).toBe(7);
  });
});
