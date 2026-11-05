import { describe, expect, it } from "vitest";
import { emptyDiagram } from "../model/ops";
import { diagramToText } from "../render/rasterize";
import { detectKind } from "./detect";
import { parseGraph } from "./graph";
import { drawSource, setDirection } from "./sync";

/** Draw graph text as it would be drawn in the app. */
const draw = (text: string) => diagramToText(drawSource(emptyDiagram(), { kind: "graph", text, options: {} }, { x: 0, y: 0 }).diagram);

describe("Mermaid state diagrams", () => {
  it("reads states, transitions, start and end, composites, choices, forks and notes", () => {
    const g = parseGraph(`stateDiagram-v2
      direction LR
      [*] --> Idle
      state "Waiting for work" as Idle
      Idle --> Busy : job
      Busy : working hard
      state Busy {
        [*] --> Step1
        Step1 --> [*]
      }
      Busy --> Check
      state Check <<choice>>
      state Split <<fork>>
      Check --> [*]
      note right of Idle : quiet
      note left of Check
        two
        lines
      end note`);
    expect(g.warnings).toEqual([]);
    expect(g.direction).toBe("right");
    const node = (id: string) => g.nodes.find((n) => n.id === id);
    expect(node("Idle")).toMatchObject({ text: "Waiting for work", rounded: true });
    expect(node("__start")).toMatchObject({ text: "●", plain: true });
    expect(node("__end")).toMatchObject({ text: "◉", plain: true });
    // Each composite has its own start and end.
    expect(node("__start_Busy")).toBeDefined();
    expect(node("__end_Busy")).toBeDefined();
    expect(node("Check")).toMatchObject({ kind: "decision", text: "" });
    expect(node("Split")).toMatchObject({ plain: true, text: "┃\n┃\n┃\n┃\n┃" });
    expect(node("Busy")).toBeUndefined(); // drawn as its frame
    expect(g.subgraphs).toEqual([{ id: "Busy", title: "working hard", members: ["__start_Busy", "Step1", "__end_Busy"], parent: null }]);
    expect(g.edges.find((e) => e.from === "Idle")).toMatchObject({ to: "Busy", label: "job", arrows: { start: false, end: true } });
    const notes = g.nodes.filter((n) => n.kind === "note").map((n) => n.text);
    expect(notes).toEqual(["quiet", "two\nlines"]);
    expect(g.edges.filter((e) => e.line === "dotted").map((e) => e.to)).toEqual(["Idle", "Check"]);
  });

  it("draws them", () => {
    expect(draw("stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy : job\n  Busy --> Idle : done\n  Busy --> [*]")).toBe(
      [
        "    ●",
        "    │",
        "    │",
        "    │",
        "    ▼",
        " ╭──────╮",
        " │ Idle │",
        " ╰──┬───╯",
        "    │ ▲",
        "job │ │",
        "    │ │ done",
        "    ▼ │",
        " ╭────┴─╮",
        " │ Busy │",
        " ╰──┬───╯",
        "    │",
        "    │",
        "    │",
        "    ▼",
        "    ◉",
      ].join("\n")
    );
  });
});

describe("Mermaid class diagrams", () => {
  it("puts members in compartments: the name, attributes, then methods", () => {
    const g = parseGraph(`classDiagram
      class Animal {
        <<abstract>>
        +String name
        +eat(food) bool
      }
      Animal : +int age
      class List~T~
      class Dog["Good dog"]
      Animal <|-- Dog`);
    expect(g.warnings).toEqual([]);
    const text = (id: string) => g.nodes.find((n) => n.id === id)?.text;
    expect(text("Animal")).toBe("«abstract»\nAnimal\n---\n+String name\n+int age\n---\n+eat(food) bool");
    expect(text("List")).toBe("List<T>");
    expect(text("Dog")).toBe("Good dog");
    expect(g.nodes.every((n) => n.kind === "class")).toBe(true);
  });

  it("gives each kind of relation its heads and line", () => {
    const rel = (op: string) => {
      const e = parseGraph(`classDiagram\n  A ${op} B`).edges[0];
      return [e.line, e.arrows.start && (e.heads?.start ?? "arrow"), e.arrows.end && (e.heads?.end ?? "arrow")];
    };
    expect(rel("<|--")).toEqual(["single", "triangle", false]); // inheritance
    expect(rel("*--")).toEqual(["single", "diamond", false]); // composition
    expect(rel("o--")).toEqual(["single", "hollow-diamond", false]); // aggregation
    expect(rel("-->")).toEqual(["single", false, "arrow"]); // association
    expect(rel("..>")).toEqual(["dashed", false, "arrow"]); // dependency
    expect(rel("..|>")).toEqual(["dashed", false, "triangle"]); // realization
    expect(rel("--")).toEqual(["single", false, false]); // link
    expect(rel("..")).toEqual(["dashed", false, false]);
    expect(rel("<|--|>")).toEqual(["single", "triangle", "triangle"]);
  });

  it("labels relations with how many are at each end", () => {
    const label = (line: string) => parseGraph(`classDiagram\n  ${line}`).edges[0].label;
    expect(label(`Zoo "1" o-- "*" Animal : houses`)).toBe("houses (1 to *)");
    expect(label(`Zoo "1" o-- Animal`)).toBe("from 1");
    expect(label(`Zoo --> "many" Animal`)).toBe("to many");
  });

  it("draws namespaces as frames, and notes", () => {
    const g = parseGraph(`classDiagram
      namespace Shapes {
        class Circle
        class Square
      }
      note for Circle "round"
      note "loose"`);
    expect(g.subgraphs).toMatchObject([{ id: "Shapes", members: ["Circle", "Square"] }]);
    expect(g.nodes.filter((n) => n.kind === "note").map((n) => n.text)).toEqual(["round", "loose"]);
    expect(g.edges).toMatchObject([{ to: "Circle", line: "dotted" }]);
  });

  it("draws them", () => {
    expect(draw("classDiagram\n  class Shape {\n    <<interface>>\n    +area() float\n  }\n  Shape <|.. Circle\n  Circle : +float r\n  Circle *-- Point : center")).toBe(
      [
        "┌───────────────┐",
        "│  «interface»  │",
        "│     Shape     │",
        "├───────────────┤",
        "│               │",
        "├───────────────┤",
        "│ +area() float │",
        "└───────────────┘",
        "       △",
        "       ┆",
        "       ┆",
        "       ┆",
        "  ┌────┴─────┐",
        "  │  Circle  │",
        "  ├──────────┤",
        "  │ +float r │",
        "  └──────────┘",
        "        ◆",
        "        │ center",
        "        │",
        "        │",
        "    ┌───┴───┐",
        "    │ Point │",
        "    └───────┘",
      ].join("\n")
    );
  });
});

describe("Mermaid ER diagrams", () => {
  it("labels relationships with their cardinalities", () => {
    const rel = (op: string) => {
      const e = parseGraph(`erDiagram\n  A ${op} B : has`).edges[0];
      return [e.label, e.line];
    };
    expect(rel("||--o{")).toEqual(["has (1 to 0..*)", "single"]);
    expect(rel("|o--|{")).toEqual(["has (0..1 to 1..*)", "single"]);
    expect(rel("}|..o|")).toEqual(["has (1..* to 0..1)", "dashed"]);
    expect(rel("}o--||")).toEqual(["has (0..* to 1)", "single"]);
  });

  it("lists attributes in columns, and takes labels and hyphenated names", () => {
    const g = parseGraph(`erDiagram
      LINE-ITEM["Line item"] {
        int id PK
        string description "what it is"
        int order FK
      }
      ORDER ||--|{ LINE-ITEM : contains`);
    expect(g.warnings).toEqual([]);
    expect(g.nodes.find((n) => n.id === "LINE-ITEM")?.text).toBe(
      ["Line item", "---", "int     id           PK", "string  description      what it is", "int     order        FK"].join("\n")
    );
    expect(g.edges).toMatchObject([{ from: "ORDER", to: "LINE-ITEM", arrows: { start: false, end: false } }]);
  });

  it("draws them", () => {
    expect(draw("erDiagram\n  A ||--o{ B : has\n  B {\n    int id PK\n    string name\n  }")).toBe(
      [
        "       ┌───┐",
        "       │ A │",
        "       └─┬─┘",
        "         │",
        "         │ has (1 to 0..*)",
        "         │",
        "         │",
        "┌────────┴─────────┐",
        "│        B         │",
        "├──────────────────┤",
        "│ int     id    PK │",
        "│ string  name     │",
        "└──────────────────┘",
      ].join("\n")
    );
  });
});

describe("state, class and ER diagrams in the app", () => {
  it("are detected as graphs", () => {
    for (const h of ["stateDiagram-v2", "stateDiagram", "classDiagram", "erDiagram"]) expect(detectKind(`${h}\n  A --> B`)).toBe("graph");
  });

  it("switch direction with a direction line", () => {
    const { diagram, id } = drawSource(emptyDiagram(), { kind: "graph", text: "stateDiagram-v2\n  [*] --> A\n  A --> B", options: {} }, { x: 0, y: 0 });
    const lr = setDirection(diagram, id, "right").diagram;
    expect(lr.sources![id].text).toBe("stateDiagram-v2\n  direction LR\n  [*] --> A\n  A --> B");
    const back = setDirection(lr, id, "down").diagram;
    expect(back.sources![id].text).toBe("stateDiagram-v2\n  direction TB\n  [*] --> A\n  A --> B");
  });
});
