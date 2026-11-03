import { describe, expect, it } from "vitest";
import { detectKind } from "./detect";
import { parseGraph } from "./graph";
import { parseSequence } from "./sequence";
import { parseTree, treeText } from "./tree";

describe("detect", () => {
  it("tells sequences, graphs and trees apart", () => {
    expect(detectKind("sequenceDiagram\nA->>B: hi")).toBe("sequence");
    expect(detectKind("flowchart LR\nA-->B")).toBe("graph");
    expect(detectKind("graph TD\nA-->B")).toBe("graph");
    expect(detectKind("Client -> API: GET /x\nAPI --> Client: 200")).toBe("sequence");
    expect(detectKind("A -> B -> C\nA -> D")).toBe("graph");
    expect(detectKind(".\n├── src\n└── README.md")).toBe("tree");
    expect(detectKind("src\n  main.ts\n  util.ts")).toBe("tree");
    expect(detectKind("src/main.ts\nsrc/util.ts")).toBe("tree");
  });
});

describe("sequence parser", () => {
  it("reads Mermaid participants, messages, activations, notes and frames", () => {
    const s = parseSequence(`sequenceDiagram
      autonumber
      participant C as Client
      actor U
      C->>+API: GET /x
      API-->>-C: 200 OK
      C->API: plain line
      Note right of API: cached<br>for 1h
      Note over C,API: handshake
      loop every minute
        C-)API: ping
      end
      activate C
      deactivate C`);
    expect(s.warnings).toEqual([]);
    expect(s.autonumber).toBe(true);
    expect(s.participants).toEqual([{ key: "C", label: "Client" }, { key: "U", label: "U" }, { key: "API", label: "API" }]);
    expect(s.events[0]).toEqual({ type: "message", from: "C", to: "API", label: "GET /x", dashed: false, arrow: true, activate: true, deactivate: false });
    expect(s.events[1]).toMatchObject({ dashed: true, arrow: true, deactivate: true });
    expect(s.events[2]).toMatchObject({ arrow: false, dashed: false });
    expect(s.events[3]).toEqual({ type: "note", side: "right", who: ["API"], text: "cached\nfor 1h" });
    expect(s.events[4]).toMatchObject({ type: "note", side: "over", who: ["C", "API"] });
    expect(s.events.slice(5).map((e) => e.type)).toEqual(["frame", "message", "end", "activate", "deactivate"]);
  });

  it("reads the shorthand, where -> is an arrow and names may have spaces", () => {
    const s = parseSequence("Web App -> API: GET\nAPI --> Web App: 200");
    expect(s.participants.map((p) => p.key)).toEqual(["Web App", "API"]);
    expect(s.events[0]).toMatchObject({ arrow: true, dashed: false });
    expect(s.events[1]).toMatchObject({ arrow: true, dashed: true });
  });

  it("warns about lines it can't read", () => {
    expect(parseSequence("A->>B: x\nwhat is this\nend").warnings).toEqual([
      'line 2: couldn\'t read "what is this"', 'line 3: "end" without a loop/alt/opt',
    ]);
  });
});

describe("graph parser", () => {
  it("reads Mermaid shapes, edge styles, labels, chains, groups and subgraphs", () => {
    const g = parseGraph(`flowchart LR
      A([Start]) --> B[Read input] -->|ok| C{Valid?}
      C -- no --> D[/Report/]
      C ==> E[(DB)] & F[[Save]]
      E -.-> G(rounded)
      F --- G
      subgraph back [Back end]
        E
        F
      end
      classDef x fill:#f9f
      %% a comment`);
    expect(g.warnings).toEqual([]);
    expect(g.direction).toBe("right");
    const kinds = Object.fromEntries(g.nodes.map((n) => [n.id, n.kind]));
    expect(kinds).toEqual({ A: "terminal", B: "box", C: "decision", D: "io", E: "database", F: "subroutine", G: "box" });
    expect(g.nodes.find((n) => n.id === "G")!.rounded).toBe(true);
    expect(g.edges.map((e) => `${e.from}>${e.to}:${e.label}:${e.line}:${e.arrows.end}`)).toEqual([
      "A>B::single:true", "B>C:ok:single:true", "C>D:no:single:true", "C>E::heavy:true", "C>F::heavy:true",
      "E>G::dotted:true", "F>G::single:false",
    ]);
    expect(g.subgraphs).toEqual([{ id: "back", title: "Back end", members: ["E", "F"], parent: null }]);
  });

  it("reads the shorthand", () => {
    const g = parseGraph("A -> B -> C\nA -> D: maybe");
    expect(g.nodes.map((n) => n.id)).toEqual(["A", "B", "C", "D"]);
    expect(g.edges.map((e) => `${e.from}>${e.to}:${e.label}`)).toEqual(["A>B:", "B>C:", "A>D:maybe"]);
  });
});

describe("tree parser", () => {
  const expected = `project/
├── src/
│   ├── main.ts
│   └── util/
│       └── fmt.ts
└── README.md`;

  it("reads tree output, indented lists and paths alike", () => {
    expect(treeText(parseTree(expected).roots)).toBe(expected);
    expect(treeText(parseTree("project/\n  src/\n    main.ts\n    util\n      fmt.ts\n  README.md").roots)).toBe(expected);
    expect(treeText(parseTree("- project\n  - src\n    - main.ts\n    - util\n      - fmt.ts\n  - README.md").roots)).toBe(expected);
    expect(treeText(parseTree("project/src/main.ts\nproject/src/util/fmt.ts\nproject/README.md").roots)).toBe(expected);
  });

  it("reads ASCII tree output and skips tree's summary line", () => {
    const t = parseTree(".\n|-- a\n|   `-- b\n`-- c\n\n2 directories, 1 file");
    expect(treeText(t.roots)).toBe(".\n├── a/\n│   └── b\n└── c");
  });
});
