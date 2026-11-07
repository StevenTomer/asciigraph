import { describe, expect, it } from "vitest";
import { emptyDiagram } from "../model/ops";
import { diagramToText } from "../render/rasterize";
import { drawSource } from "./sync";

describe("folder trees from text", () => {
  const tree = (options: object) =>
    diagramToText(drawSource(emptyDiagram(), { kind: "tree", text: "src/\n  main.ts\n  ui/\n    App.tsx\nREADME.md", options }, { x: 0, y: 0 }).diagram);
  it("can be just indented, and folders without their /", () => {
    expect(tree({})).toBe("src/\n├── main.ts\n└── ui/\n    └── App.tsx\nREADME.md");
    expect(tree({ treeLines: false })).toBe("src/\n  main.ts\n  ui/\n    App.tsx\nREADME.md");
    expect(tree({ treeLines: false, slashes: false })).toBe("src\n  main.ts\n  ui\n    App.tsx\nREADME.md");
    expect(tree({ treeStyle: "boxes", slashes: false })).not.toContain("/");
  });
});
