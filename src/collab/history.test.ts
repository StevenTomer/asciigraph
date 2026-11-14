import { describe, expect, it } from "vitest";
import { summarize } from "./history";

const box = (text: string, x = 0, w = 6) => ({ kind: "box", rect: { x, y: 0, w, h: 3 }, text });

describe("history summaries", () => {
  it("says what happened to boxes", () => {
    expect(summarize([{ map: "nodes", key: "a", old: undefined, now: box("API") }])).toBe("added 'API'");
    expect(summarize([{ map: "nodes", key: "a", old: undefined, now: box("") }])).toBe("added a box");
    expect(summarize([{ map: "nodes", key: "a", old: box("API"), now: box("API", 5) }])).toBe("moved 'API'");
    expect(summarize([{ map: "nodes", key: "a", old: box("API"), now: box("API", 0, 9) }])).toBe("resized 'API'");
    expect(summarize([{ map: "nodes", key: "a", old: box("API"), now: box("Gateway") }])).toBe("edited the text of 'Gateway'");
    expect(summarize([{ map: "nodes", key: "a", old: box("API"), now: { ...box("API"), border: "double" } }])).toBe("changed 'API'");
    expect(
      summarize([
        { map: "nodes", key: "a", old: box("A"), now: box("A", 3) },
        { map: "nodes", key: "b", old: box("B"), now: box("B", 3) },
      ]),
    ).toBe("moved 2 boxes");
  });

  it("leaves out connectors deleted along with their box", () => {
    expect(
      summarize([
        { map: "nodes", key: "a", old: box("A"), now: undefined },
        { map: "edges", key: "e", old: { label: "x" }, now: undefined },
        { map: "order", key: "a", old: "1", now: undefined },
      ]),
    ).toBe("deleted 'A'");
  });

  it("connectors, the name, and stacking", () => {
    expect(summarize([{ map: "edges", key: "e", old: { label: "" }, now: { label: "yes" } }])).toBe("relabeled the connector 'yes'");
    expect(summarize([{ map: "edges", key: "e", old: undefined, now: {} }])).toBe("added a connector");
    expect(summarize([{ map: "meta", key: "name", old: "a", now: "Plan" }])).toBe("renamed the diagram to 'Plan'");
    expect(summarize([{ map: "order", key: "a", old: "1", now: "0V" }])).toBe("changed the stacking order");
  });
});
