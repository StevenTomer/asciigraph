import { describe, expect, it } from "vitest";
import { diagramToText } from "../render/rasterize";
import { STAMP_SETS } from "./stampSets";

describe("ready-made stamps", () => {
  const all = STAMP_SETS.flatMap((s) => s.stamps().map((t) => ({ set: s.id, ...t })));

  it("are plain objects at the top left", () => {
    for (const { diagram: d } of all) {
      expect(d.order.length).toBeGreaterThan(0);
      for (const n of Object.values(d.nodes)) expect(n.gen).toBeUndefined();
      for (const e of Object.values(d.edges)) expect(e.gen).toBeUndefined();
      expect(Math.min(...Object.values(d.nodes).map((n) => n.rect.x))).toBe(0);
      expect(Math.min(...Object.values(d.nodes).map((n) => n.rect.y))).toBe(0);
    }
  });

  it("have every word showing (nothing cut off with …)", () => {
    for (const { name, diagram } of all) {
      const text = diagramToText(diagram);
      for (const n of Object.values(diagram.nodes)) {
        for (const word of n.text.split(/\s+/).filter((w) => /^[A-Za-z]{3,}$/.test(w))) expect(text, `${name}: ${word}`).toContain(word);
      }
    }
  });

  it("have names unique within their set", () => {
    for (const s of STAMP_SETS) {
      const names = s.stamps().map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("draw a window as a box in compartments", () => {
    const w = all.find((t) => t.name === "Window")!;
    expect(diagramToText(w.diagram).split("\n").slice(0, 4).join("\n")).toBe(
      [
        "┌──────────────────────────────────────┐",
        "│ ● ● ●   Window title                 │",
        "├──────────────────────────────────────┤",
        "│                                      │",
      ].join("\n"),
    );
  });
});
