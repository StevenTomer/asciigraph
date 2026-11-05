import { describe, expect, it } from "vitest";
import { emptyDiagram } from "../model/ops";
import type { Diagram, Node } from "../model/types";
import { diagramToText } from "../render/rasterize";
import { importAscii, looksLikeDrawing } from "./ascii";
import { detectKind } from "./detect";
import { describe as toMermaid } from "./fromDiagram";
import { drawSource } from "./sync";

/** Text drawn as the app draws it. */
function drawn(text: string, direction?: "down" | "right", ascii = false): string {
  const kind = detectKind(text);
  const d = drawSource(emptyDiagram(), { kind, text, options: direction ? { direction } : {} }, { x: 0, y: 0 }).diagram;
  return diagramToText(d, ascii);
}
const nodes = (d: Diagram) => Object.values(d.nodes);
const edges = (d: Diagram) => Object.values(d.edges);
const byText = (d: Diagram, t: string) => nodes(d).find((n) => n.text === t) as Node;

describe("reading a drawing back into objects", () => {
  // Drawings the app makes: read back and drawn again, they come out the same.
  const cases: [string, string, ("down" | "right")?][] = [
    ["a flowchart with every shape", `flowchart TD
      A([Start]) --> B[/Read order/]
      B --> C{In stock?}
      C -->|yes| D[[Ship it]]
      C -- no --> E[(Backorders)]
      D --> F([Done])
      E --> F
      N@{ shape: comment, label: "a note" } -.- B`],
    ["a left-to-right graph with labels and a dotted branch", `flowchart LR
      A[Browser] -->|HTTPS| B[API]
      B --> C[(Database)]
      B -.->|events| D[[Worker]]`],
    ["a class diagram", `classDiagram
      class Animal {
        <<abstract>>
        +String name
        +eat(food) bool
      }
      Animal <|-- Duck
      Zoo "1" o-- "*" Animal : houses
      Duck ..> Pond : uses`],
    ["an ER diagram", `erDiagram
      CUSTOMER ||--o{ ORDER : places
      ORDER ||--|{ LINE-ITEM : contains
      CUSTOMER }|..|{ ADDRESS : uses
      CUSTOMER {
        string name PK
      }`, "right"],
    ["a sequence with activations, a note, a loop and a self-message", `sequenceDiagram
      participant C as Client
      participant A as API
      participant D as Database
      C->>+A: GET /orders
      A->>+D: SELECT
      D-->>-A: rows
      Note right of A: cached
      A-->>-C: 200 OK
      loop every minute
        C->>A: ping
      end
      A->>A: tidy up`],
    ["a folder tree as boxes", "src/\n  main.ts\n  ui/\n    App.tsx\nREADME.md"],
  ];
  for (const [name, text, dir] of cases) {
    it(`round-trips ${name}`, () => {
      const before = name.includes("folder tree")
        ? diagramToText(drawSource(emptyDiagram(), { kind: "tree", text, options: { treeStyle: "boxes" } }, { x: 0, y: 0 }).diagram)
        : drawn(text, dir);
      const r = importAscii(before);
      expect(r.warnings).toEqual([]);
      expect(diagramToText(r.diagram)).toBe(before);
    });
  }

  it("reads shapes, styles, names, frames and a connector crossing a frame's border", () => {
    const text = [
      "╔═══════════╗     ┏━━━━━━━━━┓",
      "║  Double   ╟────►┃  Heavy  ┃",
      "╚═══════════╝     ┗━━━━┯━━━━┛",
      "                       │",
      "   ┌─ Group ───────────┼────────┐",
      "   │                   ▼        │",
      "   │  ╭─────────╮  ┌───────┐    │",
      "   │  │ rounded │◄┄┤ plain │    │",
      "   │  ╰─────────╯  └───────┘    │",
      "   └────────────────────────────┘",
    ].join("\n");
    const r = importAscii(text);
    const d = r.diagram;
    expect(byText(d, "Double").border).toBe("double");
    expect(byText(d, "Heavy").border).toBe("heavy");
    expect(byText(d, "rounded").border).toBe("rounded");
    expect(nodes(d).find((n) => n.name === "Group")).toMatchObject({ kind: "frame", text: "" });
    const into = (t: string) => edges(d).find((e) => e.to.kind === "attached" && e.to.node === byText(d, t).id)!;
    expect(into("plain").from).toMatchObject({ kind: "attached", node: byText(d, "Heavy").id, side: "bottom" });
    expect(into("rounded")).toMatchObject({ line: "dashed", arrows: { start: false, end: true } });
    expect(into("Heavy").from).toMatchObject({ node: byText(d, "Double").id, side: "right" });
    expect(diagramToText(d)).toBe(text.split("\n").map((l) => l.trimEnd()).join("\n"));
  });

  it("reads hand-drawn ASCII, with arrows a space short of the boxes", () => {
    const r = importAscii(`
      +--------+      +---------+
      | Client | ---> | Server  |
      +--------+      +---------+
           |               |
           v               v
      +--------+      +---------+
      |  Cache |<-----|   DB    |
      +--------+      +---------+`);
    const d = r.diagram;
    expect(nodes(d).map((n) => [n.text, n.border]).sort()).toEqual([["Cache", "ascii"], ["Client", "ascii"], ["DB", "ascii"], ["Server", "ascii"]]);
    const link = (a: string, b: string) => edges(d).some((e) =>
      e.from.kind === "attached" && e.from.node === byText(d, a).id && e.to.kind === "attached" && e.to.node === byText(d, b).id && e.arrows.end);
    expect(link("Client", "Server")).toBe(true);
    expect(link("Client", "Cache")).toBe(true);
    expect(link("Server", "DB")).toBe(true);
    expect(link("DB", "Cache")).toBe(true);
    expect(edges(d)).toHaveLength(4);
  });

  it("reads class compartments, alignment and labels in line gaps", () => {
    const d = importAscii([
      "┌──────────────┐",
      "│    Animal    │            ┌────────────┐",
      "├──────────────┤            │ left       │",
      "│ +name        ├── has ────►│ aligned    │",
      "├──────────────┤            └────────────┘",
      "│ +eat()       │",
      "└──────────────┘",
    ].join("\n")).diagram;
    expect(nodes(d).find((n) => n.kind === "class")?.text).toBe("Animal\n---\n+name\n---\n+eat()");
    expect(byText(d, "left\naligned").align.h).toBe("left");
    expect(edges(d)[0].label).toBe("has");
  });

  it("keeps plain text as text: words with hyphens, pipes, and free labels", () => {
    const r = importAscii("a well-known fact | another\n\n  two words");
    expect(r.boxes).toBe(0);
    expect(edges(r.diagram)).toEqual([]);
    expect(nodes(r.diagram).map((n) => n.text).sort()).toEqual(["a well-known fact | another", "two words"]);
  });

  it("writes Mermaid for an imported sequence diagram", () => {
    const d = importAscii(drawn("sequenceDiagram\n  A->>B: hi\n  B-->>A: yo")).diagram;
    expect(toMermaid(d, [...d.order, ...Object.keys(d.edges)])?.text).toBe(
      "sequenceDiagram\n  participant A\n  participant B\n  A->>B: hi\n  B-->>A: yo"
    );
  });

  it("tells a drawing from other text", () => {
    expect(looksLikeDrawing(drawn("A --> B"))).toBe(true);
    expect(looksLikeDrawing("+---+\n| a |\n+---+")).toBe(true);
    expect(looksLikeDrawing("project/\n├── src/\n└── README.md")).toBe(false);
    expect(looksLikeDrawing("A --> B")).toBe(false);
    expect(looksLikeDrawing("1 + 2 = 3")).toBe(false);
  });
});
