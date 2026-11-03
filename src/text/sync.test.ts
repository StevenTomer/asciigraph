import { describe, expect, it } from "vitest";
import { emptyDiagram, moveObjects, updateEdge, updateNode } from "../model/ops";
import type { Diagram } from "../model/types";
import { diagramToText } from "../render/rasterize";
import { drawSource, membersOf, unlinkSource, updateSource } from "./sync";

const show = (d: Diagram) => "\n" + diagramToText(d) + "\n";
const byKey = (d: Diagram, key: string) => Object.values(d.nodes).find((n) => n.gen?.key === key)!;
const edgeByKey = (d: Diagram, key: string) => Object.values(d.edges).find((e) => e.gen?.key === key)!;

describe("drawing from text", () => {
  it("draws a Mermaid sequence: activations, notes, alt/else, self-messages", () => {
    const { diagram } = drawSource(emptyDiagram(), { kind: "sequence", options: {}, text: `sequenceDiagram
      participant C as Client
      participant A as API
      C->>+A: GET /orders
      Note right of A: cached
      A-->>-C: 200 OK
      alt cached
        C->>A: HEAD
      else not cached
        C->>A: GET
      end
      A->>A: tidy` }, { x: 0, y: 0 });
    expect(show(diagram)).toBe(`
 ┌────────┐         ┌────────┐
 │ Client │         │  API   │
 └───┬────┘         └───┬────┘
     ┆                  ┆
     ┆                 ┌┴┐
     ├── GET /orders ─►│ │
     ┆                 │ │
     ┆                 │ │┌────────┬╮
     ┆                 │ ││ cached ╰┤
     ┆                 │ │└─────────┘
     ┆                 │ │
     ┆◄┄┄┄ 200 OK ┄┄┄┄┄┤ │
     ┆                 └┬┘
┌─ alt cached ────────────────────┐
│    ┆                  ┆         │
│    ├────── HEAD ─────►┆         │
│    ┆                  ┆         │
│┄ [else not cached] ┄┄┄┄┄┄┄┄┄┄┄┄┄│
│    ┆                  ┆         │
│    ├────── GET ──────►┆         │
└─────────────────────────────────┘
     ┆                  ┆
     ┆                  ┆
     ┆                  ├──┐
     ┆                  ┆  │ tidy
     ┆                  ┆◄─┘
     ┆                  ┆
     ┆                  ┆
`);
  });

  it("draws a Mermaid flowchart with its shapes", () => {
    const { diagram } = drawSource(emptyDiagram(), { kind: "graph", options: {}, text: `flowchart TD
      A([Start]) --> B[Read order]
      B --> C{In stock?}
      C -->|yes| D[[Ship]]
      C -->|no| E[(Backorders)]
      D --> F([End])
      E --> F` }, { x: 0, y: 0 });
    expect(show(diagram)).toBe(`
          ╭───────╮
          ( Start )
          ╰───┬───╯
              │
              │
              │
              ▼
        ┌────────────┐
        │ Read order │
        └─────┬──────┘
              │
              │
              │
              ▼
        ╱───────────╲
       <  In stock?  >
        ╲┬────────┬─╱
         │        │
         │ yes    │ no
         │        │
         ▼        ▼
┌─┬──────┬─┐    ╭────────────╮
│ │ Ship │ │    ├────────────┤
└─┴──┬───┴─┘    │ Backorders │
     │          ╰─────┬──────╯
     │                │
     │                │
     └────────┬───────┘
              ▼
           ╭─────╮
           ( End )
           ╰─────╯
`);
  });

  it("draws subgraphs as frames that connectors cross", () => {
    const { diagram } = drawSource(emptyDiagram(), { kind: "graph", options: {}, text: `flowchart LR
      U[User] --> W[Web]
      subgraph back [Back end]
        W2[API] --> DB[(Postgres)]
      end
      W --> W2` }, { x: 0, y: 0 });
    expect(show(diagram)).toContain("│ Web ├──────────┼─►│ API ├");
    expect(show(diagram)).toContain("┌─ Back end ─");
  });

  it("draws folder trees as text or as boxes", () => {
    const text = "project/src/main.ts\nproject/src/util.ts\nproject/README.md";
    expect(show(drawSource(emptyDiagram(), { kind: "tree", options: { treeStyle: "text" }, text }, { x: 0, y: 0 }).diagram)).toBe(`
project/
├── src/
│   ├── main.ts
│   └── util.ts
└── README.md
`);
    expect(show(drawSource(emptyDiagram(), { kind: "tree", options: { treeStyle: "boxes" }, text }, { x: 0, y: 0 }).diagram)).toBe(`
       ┌──────────┐
       │ project/ │
       └────┬─────┘
            │
            │
            │
   ┌────────┴──┐
┌──┴───┐    ┌──┴────────┐
│ src/ │    │ README.md │
└──┬───┘    └───────────┘
   │
   │
   │
   ├────────────────┐
┌──┴──────┐    ┌────┴────┐
│ main.ts │    │ util.ts │
└─────────┘    └─────────┘
`);
  });
});

describe("live redraw", () => {
  const first = "sequenceDiagram\nA->>B: one\nB->>C: two";
  const start = () => drawSource(emptyDiagram(), { kind: "sequence", options: {}, text: first }, { x: 10, y: 5 });

  it("keeps a lifeline the user moved, and moves untouched ones", () => {
    const s = start();
    let d = moveObjects(s.diagram, [byKey(s.diagram, "p:C").id], { x: 6, y: 0 });
    const movedC = byKey(d, "p:C").rect;
    // A longer label pushes B (and, untouched, it would push C) to the right.
    d = updateSource(d, s.id, { text: "sequenceDiagram\nA->>B: a much longer first message\nB->>C: two" }).diagram;
    expect(byKey(d, "p:B").rect.x).toBeGreaterThan(byKey(s.diagram, "p:B").rect.x);
    expect(byKey(d, "p:C").rect).toEqual({ ...movedC, h: byKey(d, "p:C").rect.h });
  });

  it("keeps the whole drawing where it was dragged", () => {
    const s = start();
    let d = moveObjects(s.diagram, membersOf(s.diagram, s.id), { x: 20, y: 3 });
    d = updateSource(d, s.id, { text: first + "\nC->>A: three" }).diagram;
    expect(byKey(d, "p:A").rect).toMatchObject({ x: byKey(s.diagram, "p:A").rect.x + 20, y: 8 });
    expect(edgeByKey(d, "m:C>A#1")).toBeDefined();
  });

  it("keeps the user's styling and bends, takes content from the text", () => {
    const s = start();
    let d = updateEdge(s.diagram, edgeByKey(s.diagram, "m:A>B#1").id, { line: "double", via: [{ x: 1, y: 1 }] });
    d = updateNode(d, byKey(d, "p:A").id, { border: "heavy" });
    d = updateSource(d, s.id, { text: "sequenceDiagram\nA->>B: renamed\nB->>C: two" }).diagram;
    const e = edgeByKey(d, "m:A>B#1");
    expect(e).toMatchObject({ line: "double", label: "renamed", via: [{ x: 1, y: 1 }] });
    expect(byKey(d, "p:A").border).toBe("heavy");
  });

  it("removes what the text no longer has, and adds what's new", () => {
    const s = start();
    const d = updateSource(s.diagram, s.id, { text: "sequenceDiagram\nA->>B: one\nB->>D: new" }).diagram;
    expect(byKey(d, "p:C")).toBeUndefined();
    expect(byKey(d, "p:D")).toBeDefined();
    expect(edgeByKey(d, "m:B>C#1")).toBeUndefined();
    expect(Object.keys(d.edges)).toHaveLength(2);
  });

  it("unlinks: the drawing stays, the text goes", () => {
    const s = start();
    const d = unlinkSource(s.diagram, s.id);
    expect(d.sources).toBeUndefined();
    expect(Object.values(d.nodes).every((n) => !n.gen)).toBe(true);
    expect(Object.keys(d.nodes)).toHaveLength(3);
  });
});

describe("folder trees from indentation, as drawn", () => {
  it("keeps the children of the last folder under it", () => {
    const text = "project/\n  src/\n    main.ts\n    util/\n      format.ts\n  tests/\n    main.test.ts\n    README.md";
    expect(show(drawSource(emptyDiagram(), { kind: "tree", options: { treeStyle: "text" }, text }, { x: 0, y: 0 }).diagram)).toBe(`
project/
├── src/
│   ├── main.ts
│   └── util/
│       └── format.ts
└── tests/
    ├── main.test.ts
    └── README.md
`);
  });
});
