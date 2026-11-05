import { beforeEach, describe, expect, it } from "vitest";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode } from "../model/ops";
import { diagramToText } from "../render/rasterize";
import { deleteStamp, exportStamps, importStamps, listStamps, renameStamp, saveStamp, stampOf, suggestName } from "./stamps";

// The browser's storage, for Node.
beforeEach(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
});

function part() {
  let d = addNode(emptyDiagram(), makeNode({ x: 10, y: 5, w: 9, h: 3 }, { id: "a", text: "Service", border: "rounded", gen: { source: "s1", key: "n:A" } }));
  d = addNode(d, makeNode({ x: 30, y: 5, w: 6, h: 3 }, { id: "b", text: "DB" }));
  d = addEdge(d, makeEdge({ kind: "attached", node: "a", side: "auto" }, { kind: "attached", node: "b", side: "auto" }, { id: "e" }));
  return d;
}

describe("stamps", () => {
  it("keep their objects at (0, 0), not linked to any text, drawn as they were", () => {
    const s = stampOf(part());
    expect(s.nodes.a.rect).toMatchObject({ x: 0, y: 0 });
    expect(s.nodes.b.rect).toMatchObject({ x: 20, y: 0 });
    expect(s.nodes.a.gen).toBeUndefined();
    expect(diagramToText(s)).toBe(diagramToText(part()));
  });

  it("are saved, renamed and deleted", () => {
    const a = saveStamp("service + db", part());
    saveStamp("  ", part());
    expect(listStamps().map((s) => s.name)).toEqual(["service + db", "Stamp"]);
    renameStamp(a.id, "pair");
    expect(listStamps()[0].name).toBe("pair");
    deleteStamp(a.id);
    expect(listStamps().map((s) => s.name)).toEqual(["Stamp"]);
  });

  it("export to a file and import from one, alongside what's there", () => {
    saveStamp("pair", part());
    const file = exportStamps();
    expect(importStamps(file)).toBe(1);
    expect(listStamps().map((s) => s.name)).toEqual(["pair", "pair"]);
    expect(new Set(listStamps().map((s) => s.id)).size).toBe(2);
    expect(() => importStamps("{}")).toThrow(/no asciigraph stamps/);
    expect(() => importStamps("not json")).toThrow(/isn't JSON/);
  });

  it("suggest a name from their text", () => {
    expect(suggestName(part())).toBe("Service");
    expect(suggestName(emptyDiagram())).toBe("Stamp");
  });
});
