import { describe, expect, it } from "vitest";
import { addNode, emptyDiagram, makeNode, setNodeText } from "../model/ops";
import { renderText } from "./markdown";
import { diagramToText } from "./rasterize";

describe("markdown lists", () => {
  it("renders bullets by level and renumbers ordered lists", () => {
    expect(renderText("- one\n- two\n  * nested\n    + deeper\n- three", 40).lines).toEqual([
      "• one", "• two", "  ◦ nested", "    ▪ deeper", "• three",
    ]);
    expect(renderText("1. a\n1. b\n1. c\n\ntext\n5) e\n9) f", 40).lines).toEqual([
      "1. a", "2. b", "3. c", "", "text", "5) e", "6) f",
    ]);
  });

  it("hangs wrapped item text under its first word, and keeps nested numbering separate", () => {
    expect(renderText("- a long point that wraps\n  1. sub\n  2. sub two\n- next", 14).lines).toEqual([
      "• a long point", "  that wraps", "  1. sub", "  2. sub two", "• next",
    ]);
  });

  it("leaves other text alone", () => {
    expect(renderText("plain - not a list\n-dash without space", 40)).toEqual({
      lines: ["plain - not a list", "-dash without space"], list: false,
    });
  });

  it("lays lists out left-aligned in a box, and maps bullets to ASCII", () => {
    // Setting the text grows the box to the rendered lines.
    const d = setNodeText(addNode(emptyDiagram(), makeNode({ x: 0, y: 0, w: 22, h: 3 }, { id: "n" })), "n", "Todo:\n- buy milk\n- call home\n  1. mum\n  2. dad");
    expect(diagramToText(d)).toBe([
      "┌────────────────────┐",
      "│ Todo:              │",
      "│ • buy milk         │",
      "│ • call home        │",
      "│   1. mum           │",
      "│   2. dad           │",
      "└────────────────────┘",
    ].join("\n"));
    expect(diagramToText(d, true).split("\n")[2]).toBe("| * buy milk         |");
  });
});

describe("literal text", () => {
  it("keeps a line as typed when its marker is escaped with a backslash", () => {
    expect(renderText("\\- not a list\n  \\* nor this\n\\1. nor this\n- a list", 40)).toEqual({
      lines: ["- not a list", "  * nor this", "1. nor this", "• a list"],
      list: true,
    });
    // Backslashes anywhere else stay.
    expect(renderText("a\\b\n\\-no space", 40).lines).toEqual(["a\\b", "\\-no space"]);
  });

  it("shows everything as typed in plain mode (a box with lists off)", () => {
    expect(renderText("- one\n\\- two\n1. three", 40, true)).toEqual({ lines: ["- one", "\\- two", "1. three"], list: false });
    const d = addNode(emptyDiagram(), makeNode({ x: 0, y: 0, w: 14, h: 4 }, { text: "- one\n- two", lists: false }));
    expect(diagramToText(d)).toBe(["┌────────────┐", "│   - one    │", "│   - two    │", "└────────────┘"].join("\n"));
  });
});
