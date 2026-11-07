import { describe, expect, it } from "vitest";
import { addNode, emptyDiagram, makeNode } from "../model/ops";
import { diagramToText } from "../render/rasterize";
import { importAscii } from "../text/ascii";
import { drawSource } from "../text/sync";
import type { Node, TableOptions } from "../model/types";
import {
  canIndent, cellRect, cellText, deleteRow, indentRow, insertColumn, insertRow, markdownTable, moveRow, parseTable, tableNode,
  treeMoveTarget, withCell, withTree, withTreeLook,
} from "./table";

const TREE = `| Name | About |
|------|-------|
| src/ | the source |
| ├── main.ts | where it starts, and a longer note |
| ├── ui/ | components |
| │   └── App.tsx | the app |
| └── util.ts | helpers |
| README.md | read me |`;

const node = (text: string, w?: number, options?: TableOptions): Node => {
  const { rect, ...f } = tableNode(text, { x: 0, y: 0 });
  return makeNode(w ? { ...rect, w } : rect, { ...f, ...(w && { autosize: false }), ...(options && { table: { ...f.table, ...options } }) });
};
const draw = (n: Node) => diagramToText(addNode(emptyDiagram(), n));
const edit = (n: Node, p: Partial<Node>) => ({ ...n, ...p });
const firstColumn = (n: Node) => parseTable(n.text).rows.map((r) => r[0]);

describe("tree tables", () => {
  it("draw the first column as a tree, its lines running down past rows that span lines", () => {
    expect(draw(node(TREE, 40))).toBe([
      "┌─────────────────┬────────────────────┐",
      "│ Name            │ About              │",
      "├─────────────────┼────────────────────┤",
      "│ src/            │ the source         │",
      "│ ├── main.ts     │ where it starts,   │",
      "│ │               │ and a longer note  │",
      "│ ├── ui/         │ components         │",
      "│ │   └── App.tsx │ the app            │",
      "│ └── util.ts     │ helpers            │",
      "│ README.md       │ read me            │",
      "└─────────────────┴────────────────────┘",
    ].join("\n"));
  });

  it("are tree tables when pasted with tree lines, the lines drawn afresh from the depths", () => {
    // (Wrong lines: ├── for a last child, └── for one with a sibling after it.)
    const n = node("| Name | About |\n|---|---|\n| a/ | top |\n| └── b | one |\n| ├── c | two |");
    expect(n.table?.tree).toBe(true);
    expect(firstColumn(n)).toEqual(["Name", "a/", "├── b", "└── c"]);
    // A plain table isn't one.
    expect(node("| a | b |\n|---|---|\n| 1 | 2 |").table).toBeUndefined();
  });

  it("can be drawn without the tree's lines, and folders without their /", () => {
    const n = node(TREE, undefined, { treeLines: false, treeSlashes: false });
    expect(draw(edit(n, withTreeLook(n, {})))).toBe([
      "┌─────────────┬────────────────────────────────────┐",
      "│ Name        │ About                              │",
      "├─────────────┼────────────────────────────────────┤",
      "│ src         │ the source                         │",
      "│   main.ts   │ where it starts, and a longer note │",
      "│   ui        │ components                         │",
      "│     App.tsx │ the app                            │",
      "│   util.ts   │ helpers                            │",
      "│ README.md   │ read me                            │",
      "└─────────────┴────────────────────────────────────┘",
    ].join("\n"));
  });

  it("indent and outdent a row with its children; move it past its siblings with them", () => {
    let n = node(TREE);
    // (Row 0 is the header.) util.ts can go under ui/, the entry before it at its depth; src/,
    // the first, can't go deeper, nor (at the top) shallower.
    expect(canIndent(n, 5, 1)).toBe(true);
    expect(canIndent(n, 1, 1)).toBe(false);
    expect(canIndent(n, 1, -1)).toBe(false);
    n = edit(n, indentRow(n, 5, 1));
    expect(firstColumn(n)).toEqual(["Name", "src/", "├── main.ts", "└── ui/", "    ├── App.tsx", "    └── util.ts", "README.md"]);
    // ui/ (with its two) outdented: a top-level entry, after src/.
    n = edit(n, indentRow(n, 3, -1));
    expect(firstColumn(n)).toEqual(["Name", "src/", "└── main.ts", "ui/", "├── App.tsx", "└── util.ts", "README.md"]);
    // ui/ moved up past src/ (and main.ts): its children go with it.
    expect(treeMoveTarget(n, 3, -1)).toBe(1);
    n = edit(n, moveRow(n, 3, -1));
    expect(firstColumn(n)).toEqual(["Name", "ui/", "├── App.tsx", "└── util.ts", "src/", "└── main.ts", "README.md"]);
    expect(parseTable(n.text).rows[2][1]).toBe("the app");
    // App.tsx is first of its parent's: it can't go up.
    expect(treeMoveTarget(n, 2, -1)).toBe(-1);
    // src/ moved down past README.md, main.ts with it.
    expect(treeMoveTarget(n, 4, 1)).toBe(5);
    expect(firstColumn(edit(n, moveRow(n, 4, 1)))).toEqual(["Name", "ui/", "├── App.tsx", "└── util.ts", "README.md", "src/", "└── main.ts"]);
  });

  it("put a new row beside the one it goes above, and lift a deleted row's children into its place", () => {
    let n = node(TREE);
    n = edit(n, insertRow(n, 3));
    expect(firstColumn(n)).toEqual(["Name", "src/", "├── main.ts", "├──", "├── ui/", "│   └── App.tsx", "└── util.ts", "README.md"]);
    n = edit(n, withCell(n, { row: 3, col: 0 }, "lib/"));
    expect(cellText(n.text, { row: 3, col: 0 })).toBe("lib/");
    expect(firstColumn(n)[3]).toBe("├── lib/");
    n = edit(n, deleteRow(n, 1));
    expect(firstColumn(n)).toEqual(["Name", "main.ts", "lib/", "ui/", "└── App.tsx", "util.ts", "README.md"]);
  });

  it("keep the tree in the first column when columns are added before it", () => {
    let n = node(TREE);
    n = edit(n, insertColumn(n, 0));
    const rows = parseTable(n.text).rows;
    expect(rows.map((r) => r[0])).toEqual(["", "", "├──", "├──", "│   └──", "└──", ""]);
    expect(rows.map((r) => r[1])).toEqual(["Name", "src/", "main.ts", "ui/", "App.tsx", "util.ts", "README.md"]);
  });

  it("type an entry's name after its lines", () => {
    const n = node(TREE);
    expect(cellRect(n, { row: 4, col: 0 }).text).toMatchObject({ x: 2 + 8, w: 7 });
    expect(cellText(n.text, { row: 4, col: 0 })).toBe("App.tsx");
  });

  it("turn on and off, keeping the text", () => {
    const plain = node("| Name | About |\n|---|---|\n| a | one |\n| b | two |");
    const on = edit(plain, withTree(plain, true));
    expect(on.table?.tree).toBe(true);
    const deeper = edit(on, indentRow(on, 2, 1));
    expect(firstColumn(deeper)).toEqual(["Name", "a", "└── b"]);
    expect(edit(deeper, withTree(deeper, false)).table?.tree).toBeUndefined();
  });

  it("copy as Markdown with the tree's spaces kept, and read that back", () => {
    const n = node(TREE);
    const md = markdownTable(n.text);
    expect(md.split("\n")[5]).toBe("| │   └── App.tsx | the app                            |");
    expect(firstColumn(node(md))).toEqual(firstColumn(n));
    // A row under a last child starts with spaces: they're kept too.
    const last = node("| N |\n|---|\n| a |\n| └── b |\n|     └── c |");
    expect(firstColumn(last)).toEqual(["N", "a", "└── b", "    └── c"]);
  });

  it("read back from a drawing", () => {
    const before = draw(node(TREE));
    const r = importAscii(before);
    expect(r.warnings).toEqual([]);
    expect(Object.keys(r.diagram.edges)).toEqual([]);
    const [t] = Object.values(r.diagram.nodes);
    expect(t.table?.tree).toBe(true);
    expect(diagramToText(r.diagram)).toBe(before);
  });
});

describe("tree tables drawn just indented", () => {
  it("read back as tree tables with their lines off", () => {
    for (const options of [{ treeLines: false }, { treeLines: false, treeSlashes: false }] as TableOptions[]) {
      const n = node(TREE, undefined, options);
      const before = draw(edit(n, withTreeLook(n, {})));
      const r = importAscii(before);
      expect(r.warnings).toEqual([]);
      const [t] = Object.values(r.diagram.nodes);
      expect(t.table).toMatchObject({ tree: true, treeLines: false });
      expect(diagramToText(r.diagram)).toBe(before);
    }
  });

  it("keep their rows that span lines, and their header", () => {
    const n = node(TREE, 40, { treeLines: false });
    const before = draw(n);
    expect(before).toContain("│   main.ts   │ where it starts, and a │");
    const [t] = Object.values(importAscii(before).diagram.nodes);
    expect(firstColumn(t)).toEqual(["Name", "src/", "├── main.ts", "├── ui/", "│   └── App.tsx", "└── util.ts", "README.md"]);
    expect(parseTable(t.text).rows[2][1]).toBe("where it starts, and a\nlonger note");
  });

  it("aren't mistaken for a column lined up right or centered, or a plain table", () => {
    const plain = (rows: string[]) => {
      const [t] = Object.values(importAscii(draw(node("| N | v |\n|---|---|\n" + rows.join("\n")))).diagram.nodes);
      return t.table?.tree;
    };
    expect(plain(["| a | 1 |", "| b | 2 |"])).toBeFalsy();
    // Right-aligned: 100 then 1, lined up on the right.
    const [right] = Object.values(importAscii(draw(node("| N | v |\n|--:|---|\n| 100 | a |\n| 1 | b |"))).diagram.nodes);
    expect(right.table?.tree).toBeFalsy();
    expect(parseTable(right.text).aligns[0]).toBe("right");
    // Centered.
    const [mid] = Object.values(importAscii(draw(node("| Name | v |\n|:-----:|---|\n| abcde | a |\n| a | b |"))).diagram.nodes);
    expect(mid.table?.tree).toBeFalsy();
  });
});

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
