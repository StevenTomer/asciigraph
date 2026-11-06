import { describe, expect, it } from "vitest";
import { exportText } from "../export/text";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode } from "../model/ops";
import { drawingPart, readFile, writeFile } from "./diskFile";

const d0 = (() => {
  const a = makeNode({ x: 0, y: 0, w: 9, h: 3 }, { text: "api" });
  const b = makeNode({ x: 20, y: 0, w: 9, h: 3 }, { text: "db", border: "rounded" });
  let d = addNode(addNode(emptyDiagram(), a), b);
  d = addEdge(d, makeEdge({ kind: "attached", node: a.id, side: "auto" }, { kind: "attached", node: b.id, side: "auto" }, { arrows: { start: false, end: true } }));
  return d;
})();
const drawn = exportText(d0);

describe("diagrams in files", () => {
  it("Markdown: the drawing in a text block, and the diagram itself hidden after it, read back exactly", () => {
    const md = writeFile("notes.md", null, d0, "Services");
    const lines = md.split("\n");
    expect(lines[0]).toBe("```text");
    expect(lines.slice(1, 4).join("\n")).toBe(drawn);
    expect(lines[4]).toBe("```");
    expect(lines[5]).toMatch(/^<!-- asciigraph:v1 [\w-]+ -->$/);
    const r = readFile("notes.md", md);
    expect(r).toEqual({ name: "Services", diagram: d0 });
  });

  it("Markdown: the rest of the file is kept, and saving again replaces just the drawing", () => {
    const doc = "# Services\n\nHow they talk:\n\n```js\nconst x = 1;\n```\n\nMore words.\n";
    const first = writeFile("README.md", doc, d0, "Services");
    expect(first.startsWith(doc.trimEnd() + "\n\n```text\n")).toBe(true);
    const moved = { ...d0, nodes: { ...d0.nodes } };
    const id = d0.order[1];
    moved.nodes[id] = { ...moved.nodes[id], text: "store" };
    const second = writeFile("README.md", first.replace("More words.", "Other words."), moved, "Services");
    expect(second).toContain("Other words.");
    expect(second.match(/```text/g)).toHaveLength(1);
    expect(second.match(/asciigraph:v1/g)).toHaveLength(1);
    expect(readFile("README.md", second).diagram).toEqual(moved);
    // The drawing part changes; the words around it don't count.
    expect(drawingPart("README.md", second)).not.toBe(drawingPart("README.md", first));
    expect(drawingPart("README.md", first.replace("More words.", "Other words."))).toBe(drawingPart("README.md", first));
  });

  it("Markdown: a drawing changed by hand wins over the hidden copy", () => {
    const md = writeFile("a.md", null, d0, "A").replace("│  api  ├", "│ apis  ├");
    const r = readFile("a.md", md);
    expect(r.note).toMatch(/changed outside asciigraph/);
    expect(Object.values(r.diagram.nodes).map((n) => n.text).sort()).toEqual(["apis", "db"]);
    expect(exportText(r.diagram)).toBe(drawn.replace("│  api  ├", "│ apis  ├"));
  });

  it("Markdown: a file without our drawing: its first drawing, or none yet", () => {
    const doc = "Intro\n\n```\n" + drawn + "\n```\n\nand\n\n```text\n" + drawn + "\n```\n";
    const r = readFile("doc.md", doc);
    expect(exportText(r.diagram)).toBe(drawn);
    expect(r.note).toMatch(/2 drawings; this is the first/);
    // Saving puts ours where the first one was.
    const out = writeFile("doc.md", doc, r.diagram, "doc");
    expect(out.indexOf("asciigraph:v1")).toBeLessThan(out.indexOf("and"));
    expect(readFile("doc.md", "# Just words\n")).toMatchObject({ name: "doc", note: expect.stringMatching(/no drawing yet/) });
  });

  it("text: just the drawing, read back from its characters; JSON: the diagram", () => {
    const txt = writeFile("map.txt", "old", d0, "Map");
    expect(txt).toBe(drawn + "\n");
    const r = readFile("map.txt", txt);
    expect(r.name).toBe("map");
    expect(exportText(r.diagram)).toBe(drawn);
    expect(readFile("map.asciigraph.json", writeFile("map.asciigraph.json", null, d0, "Map"))).toEqual({ name: "Map", diagram: d0 });
    expect(() => readFile("x.json", "{}")).toThrow(/isn't an asciigraph diagram/);
  });
});
