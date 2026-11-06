import { describe, expect, it } from "vitest";
import { addNode, emptyDiagram, makeNode } from "../model/ops";
import { diagramToText } from "../render/rasterize";
import { BANNER_FONTS, bannerArt } from "./banner";

describe("banner text", () => {
  it("letters words in a FIGlet font, trimmed", () => {
    expect(bannerArt("Hi", "standard")).toBe(
      [
        " _   _ _",
        "| | | (_)",
        "| |_| | |",
        "|  _  | |",
        "|_| |_|_|",
      ].join("\n"),
    );
  });

  it("puts each line of text in a band of its own, with a blank line between", () => {
    const art = bannerArt("A\nB", "mini");
    const bands = art.split("\n\n");
    expect(bands).toHaveLength(2);
    expect(bands[0]).toBe(bannerArt("A", "mini"));
    expect(bands[1]).toBe(bannerArt("B", "mini"));
  });

  it("draws blocks in solid blocks", () => {
    const art = bannerArt("OK", "blocks");
    expect(art).toContain("█");
    expect(art).not.toContain("#");
  });

  it("has every font", () => {
    for (const f of BANNER_FONTS) expect(bannerArt("Abc 123", f.id).split("\n").length).toBeGreaterThan(2);
  });

  it("is drawn exactly as lettered, as a label (and in ASCII, blocks become #)", () => {
    for (const f of BANNER_FONTS) {
      const art = bannerArt("Ship it", f.id);
      const lines = art.split("\n");
      const n = makeNode({ x: 0, y: 0, w: Math.max(...lines.map((l) => l.length)), h: lines.length }, {
        border: "none", autosize: true, align: { h: "left", v: "top" }, lists: false, text: art, banner: { text: "Ship it", font: f.id },
      });
      const d = addNode(emptyDiagram(), n);
      expect(diagramToText(d)).toBe(art);
      if (f.id === "blocks") expect(diagramToText(d, true)).toBe(art.replace(/█/g, "#"));
    }
  });
});
