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

  it("have a real timeline and a real checklist", () => {
    const timeline = all.find((t) => t.name === "Timeline")!;
    expect(Object.values(timeline.diagram.nodes).map((n) => n.kind)).toEqual(["timeline"]);
    const checklist = all.find((t) => t.name === "Checklist")!;
    expect(diagramToText(checklist.diagram)).toContain("│ [✓] Write it");
    expect(STAMP_SETS.map((s) => s.id)).toEqual(["flowchart", "architecture", "sequence", "notes"]);
  });
});
