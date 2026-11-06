import { describe, expect, it } from "vitest";
import { addNode, emptyDiagram, makeNode, setNodeText, updateNode } from "../model/ops";
import type { Node } from "../model/types";
import { diagramToText } from "../render/rasterize";
import { isTimelineText, parseTimeline, timelineMermaid, timelineNode, timelinePoints, withPoint, withoutPoints } from "./timeline";

const HISTORY = `timeline
    title Product history
    section Planning
      2024 : Plan
    section Delivery
      2025 : Build : Test
      2026 : Ship
           : Celebrate`;

const drawn = (text: string, patch: Partial<Node> = {}) => {
  const t = timelineNode(text, { x: 0, y: 0 });
  return diagramToText(addNode(emptyDiagram(), makeNode(t.rect, { ...t, ...patch, rect: { ...t.rect, ...patch.rect } })));
};

describe("timelines", () => {
  it("read Mermaid timeline text: title, sections, periods and their events", () => {
    expect(isTimelineText(HISTORY)).toBe(true);
    expect(isTimelineText("2024 : Plan")).toBe(false);
    expect(parseTimeline(HISTORY)).toEqual({
      title: "Product history",
      sections: ["Planning", "Delivery"],
      periods: [
        { when: "2024", events: ["Plan"], section: 0 },
        { when: "2025", events: ["Build", "Test"], section: 1 },
        { when: "2026", events: ["Ship", "Celebrate"], section: 1 },
      ],
    });
    // The text kept is the body; Mermaid gets the header back.
    const n = timelineNode(HISTORY, { x: 0, y: 0 });
    expect(n.text.startsWith("title Product history")).toBe(true);
    expect(parseTimeline(timelineMermaid(n.text))).toEqual(parseTimeline(HISTORY));
  });

  it("draw across: periods over the axis, events under them, sections over those with a line between", () => {
    expect(drawn(HISTORY)).toBe([
      "Product history",
      "   Planning │ Delivery",
      "   2024     │ 2025    2026",
      "───●────────┼─●───────●──────────►",
      "   Plan     │ Build   Ship",
      "            │ Test    Celebrate",
    ].join("\n"));
  });

  it("draw down: periods left of the axis, events right of it, a line between sections", () => {
    expect(drawn(HISTORY, { timeline: { direction: "down" }, rect: { x: 0, y: 0, w: 22, h: 12 }, autosize: false })).toBe([
      "Product history",
      "Planning │",
      "    2024 ● Plan",
      "─────────┼────────────",
      "Delivery │",
      "    2025 ● Build",
      "         │ Test",
      "         │",
      "    2026 ● Ship",
      "         │ Celebrate",
      "         ▼",
    ].join("\n"));
  });

  it("spread out when drawn wider, and wrap when narrower", () => {
    const four = "timeline\n 2024 : Plan\n 2025 : Build\n 2026 : Test\n 2027 : Ship";
    expect(drawn(four)).toBe([
      "   2024   2025    2026   2027",
      "───●──────●───────●──────●─────►",
      "   Plan   Build   Test   Ship",
    ].join("\n"));
    expect(drawn(four, { rect: { x: 0, y: 0, w: 44, h: 3 }, autosize: false })).toBe([
      "   2024       2025        2026       2027",
      "───●──────────●───────────●──────────●─────►",
      "   Plan       Build       Test       Ship",
    ].join("\n"));
    const long = "timeline\n Q1 : Requirements gathering\n Q2 : Delivery";
    expect(drawn(long, { rect: { x: 0, y: 0, w: 29, h: 4 }, autosize: false })).toBe([
      "   Q1             Q2",
      "───●──────────────●─────────►",
      "   Requirements   Delivery",
      "   gathering",
    ].join("\n"));
  });

  it("size themselves to their text as it's edited, in the line style set", () => {
    const t = timelineNode("timeline\n 1 : a", { x: 0, y: 0 });
    let d = addNode(emptyDiagram(), makeNode(t.rect, { ...t, id: "t" }));
    d = setNodeText(d, "t", "1 : a\n2 : b\n3 : c");
    expect(diagramToText(d)).toBe(["   1   2   3", "───●───●───●──►", "   a   b   c"].join("\n"));
    expect(diagramToText(updateNode(d, "t", { border: "double" }))).toBe(["   1   2   3", "═══●═══●═══●══►", "   a   b   c"].join("\n"));
    expect(diagramToText(d, true)).toBe(["   1   2   3", "---o---o---o-->", "   a   b   c"].join("\n"));
  });

  describe("points moved by hand", () => {
    const FOUR = "timeline\n 2024 : Plan\n 2025 : Build\n 2026 : Test\n 2027 : Ship";
    const node = (text = FOUR, patch: Partial<Node> = {}) => {
      const t = timelineNode(text, { x: 0, y: 0 });
      return makeNode(t.rect, { ...t, ...patch });
    };
    const move = (n: Node, i: number, x: number, y = 0) => ({ ...n, ...withPoint(n, i, { x, y }) }) as Node;
    const show = (n: Node) => diagramToText(addNode(emptyDiagram(), n));

    it("move along the line, pushing the ones after along, and the timeline grows", () => {
      const n = move(node(), 1, 14);
      expect(n.timeline?.at).toEqual({ 2025: 14 });
      expect(show(n)).toBe([
        "   2024       2025    2026   2027",
        "───●──────────●───────●──────●─────►",
        "   Plan       Build   Test   Ship",
      ].join("\n"));
      // Before the one before it: as close as it goes (its text clear of that one's).
      const back = move(n, 1, 2);
      expect(back.timeline?.at).toEqual({ 2025: 9 });
      expect(timelinePoints(back).map((p) => p.x)).toEqual([3, 9, 18, 25]);
    });

    it("keep their place when the events change, and go back with a double-click or space evenly", () => {
      let n = move(node(), 2, 30);
      n = { ...n, text: n.text.replace("2025 : Build", "2025 : Build : Review") };
      expect(timelinePoints(n)[2].x).toBe(30);
      const reset = { ...n, ...withPoint(n, 2, null) } as Node;
      expect(reset.timeline).toBeUndefined();
      expect({ ...n, ...withoutPoints(n) }.timeline).toBeUndefined();
    });

    it("move down the line when it runs down", () => {
      let n = node("timeline\n 1 : a\n 2 : b\n 3 : c", { timeline: { direction: "down" } });
      n = { ...n, rect: { ...n.rect, ...withoutPoints(n).rect } } as Node;
      n = move(n, 1, 0, 5);
      expect(show(n)).toBe(["1 ● a", "  │", "  │", "  │", "  │", "2 ● b", "  │", "3 ● c", "  ▼"].join("\n"));
    });
  });
});
