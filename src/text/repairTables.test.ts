import { describe, expect, it } from "vitest";
import { repairTables } from "./repairTables";
import { importAscii, looksLikeDrawing } from "./ascii";

const lines = (s: string) => s.replace(/^\n/, "").split("\n");

describe("repairTables", () => {
  it("re-pads a row whose cell is a few characters short", () => {
    expect(repairTables(lines(`
┌─────┬──────┐
│ Key │ Note │
├─────┼──────┤
│ a   │ x │
│ b   │ yy   │
└─────┴──────┘`))).toEqual(lines(`
┌─────┬──────┐
│ Key │ Note │
├─────┼──────┤
│ a   │ x    │
│ b   │ yy   │
└─────┴──────┘`));
  });

  it("widens a column (and its borders) for a cell that's too long", () => {
    expect(repairTables(lines(`
  +-----+----+
  | Key | A  |
  +-----+----+
  | b   | long text |
  +-----+----+`))).toEqual(lines(`
  +-----+-----------+
  | Key | A         |
  +-----+-----------+
  | b   | long text |
  +-----+-----------+`));
  });

  it("leaves aligned tables and other lines as they were", () => {
    const text = lines(`
note
┌───┬───┐
│ a │ b │
└───┴───┘
│ x │`);
    expect(repairTables(text)).toEqual(text);
  });

  it("lets a misaligned table be read as one table", () => {
    const r = importAscii(`
┌───────┬──────────┐
│ Key   │ Meaning  │
├───────┼──────────┤
│  one  │ the first one │
│  two  │ second   │
└───────┴──────────┘`);
    const nodes = Object.values(r.diagram.nodes);
    expect(nodes.map((n) => n.kind)).toEqual(["table"]);
    expect(nodes[0].text).toContain("| one | the first one |");
  });
});

describe("repairTables: missing borders", () => {
  it("adds a missing top and bottom border, and re-pads a short row", () => {
    expect(repairTables(lines(`
│ Key   │ Note   │
├───────┼────────┤
│ a     │ short │
│ b     │ fine   │`))).toEqual(lines(`
┌───────┬────────┐
│ Key   │ Note   │
├───────┼────────┤
│ a     │ short  │
│ b     │ fine   │
└───────┴────────┘`));
  });

  it("reads rows with a line under the header as a table", () => {
    const text = `
│ Key                 │ Required │ Meaning                                                │
├─────────────────────┼──────────┼────────────────────────────────────────────────────────┤
│ <GCS name>          │ Yes      │ Must match a GCS name under root.gcs in topology      │
│ parameter_context   │ Yes      │ Context name for this GCS; normally matches topology  │
│ variables           │ No       │ Values substituted into {{token}} defaults            │`;
    expect(looksLikeDrawing(text)).toBe(true);
    const nodes = Object.values(importAscii(text).diagram.nodes);
    expect(nodes.map((n) => n.kind)).toEqual(["table"]);
    expect(nodes[0].text.split("\n")).toHaveLength(5);
    expect(nodes[0].text).toMatch(/\| variables +\| No +\| Values substituted into \{\{token\}\} defaults +\|$/);
  });

  it("leaves rows without a divider, and a lone box, alone", () => {
    const text = lines(`
│ a │ b │
│ c │ d │
┌───┐
│ x │
└───┘`);
    expect(repairTables(text)).toEqual(text);
  });
});
