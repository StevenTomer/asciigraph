import { describe, expect, it } from "vitest";
import { repairTables } from "./repairTables";
import { importAscii } from "./ascii";

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
