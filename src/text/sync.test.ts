import { describe, expect, it } from "vitest";
import { withContents } from "../model/containment";
import { moveWithLocks } from "../model/locks";
import { emptyDiagram, moveObjects, updateEdge, updateNode } from "../model/ops";
import type { Diagram } from "../model/types";
import { diagramToText, rasterize } from "../render/rasterize";
import { directionOf, drawSource, membersOf, setDirection, unlinkSource, updateSource } from "./sync";

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
     └────────┬───────┘
              │
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

describe("switching a drawn graph between TB and LR", () => {
  const text = "flowchart TD\n  A --> B --> C";
  it("re-lays it out the other way, header included, hand moves too", () => {
    const s = drawSource(emptyDiagram(), { kind: "graph", options: {}, text }, { x: 0, y: 0 });
    const x = (d: Diagram, k: string) => byKey(d, k).rect.x, y = (d: Diagram, k: string) => byKey(d, k).rect.y;
    expect(y(s.diagram, "n:A")).toBeLessThan(y(s.diagram, "n:B"));
    let d = moveObjects(s.diagram, [byKey(s.diagram, "n:B").id], { x: 9, y: 0 });
    d = setDirection(d, s.id, "right").diagram;
    expect(x(d, "n:A")).toBeLessThan(x(d, "n:B"));
    expect(x(d, "n:B")).toBeLessThan(x(d, "n:C"));
    expect(y(d, "n:A")).toBe(y(d, "n:C"));
    expect(d.sources![s.id].text).toBe("flowchart LR\n  A --> B --> C");
    expect(directionOf(d.sources![s.id])).toBe("right");
    d = setDirection(d, s.id, "down").diagram;
    expect(d.sources![s.id].text).toBe(text);
    expect(y(d, "n:A")).toBeLessThan(y(d, "n:B"));
  });

  it("lays folder trees drawn as boxes out left to right too", () => {
    const s = drawSource(emptyDiagram(), { kind: "tree", options: { treeStyle: "boxes" }, text: "app/\n  src/\n    main.ts\n  docs/" }, { x: 0, y: 0 });
    expect(show(setDirection(s.diagram, s.id, "right").diagram)).toBe(`
                  ┌──────┐
                 ┌┤ src/ ├──────────┐
┌──────┐         │└──────┘          │┌─────────┐
│ app/ ├─────────┤                  └┤ main.ts │
└──────┘         │                   └─────────┘
                 │┌───────┐
                 └┤ docs/ │
                  └───────┘
`);
  });
});

it("keeps labels on a shared trunk apart (the sample flowchart, left to right)", () => {
  const text = `flowchart TD
    A([Start]) --> B[Read order]
    B --> C{In stock?}
    C -->|yes| D[[Ship it]]
    C -->|no| E[(Backorders)]
    D --> F([Done])
    E --> F`;
  const s = drawSource(emptyDiagram(), { kind: "graph", options: {}, text }, { x: 0, y: 0 });
  expect(show(setDirection(s.diagram, s.id, "right").diagram)).toBe(`
                                                                    ┌─┬─────────┬─┐
                                                                 ┌─►│ │ Ship it │ ├────┐
                                                                 │  └─┴─────────┴─┘    │
╭───────╮          ┌────────────┐           ╱───────────╲        │ yes                 │     ╭──────╮
( Start )─────────►│ Read order ├─────────►<  In stock?  >───────┤                     ├────►( Done )
╰───────╯          └────────────┘           ╲───────────╱     no │  ╭────────────╮     │     ╰──────╯
                                                                 │  ├────────────┤     │
                                                                 └─►│ Backorders ├─────┘
                                                                    ╰────────────╯
`);
});

describe("graph connectors follow the flow direction", () => {
  const text = `flowchart LR
    A([Start]) --> C{In stock?}
    C -->|yes| D[[Ship it]]
    C -->|no| E[(Backorders)]
    D --> F([Done])
    E --> F`;
  const sides = (d: Diagram, key: string) => {
    const e = edgeByKey(d, key);
    const r = rasterize(d).edges.get(e.id)!;
    return [r.from.dir, r.to.dir];
  };

  it("keeps leaving right and arriving left when a box is dragged up", () => {
    const s = drawSource(emptyDiagram(), { kind: "graph", options: {}, text }, { x: 0, y: 0 });
    expect(sides(s.diagram, "e:C>D#1")).toEqual(["right", "left"]);
    const d = moveObjects(s.diagram, [byKey(s.diagram, "n:D").id], { x: 0, y: -6 });
    expect(sides(d, "e:C>D#1")).toEqual(["right", "left"]);
    expect(sides(d, "e:D>F#1")).toEqual(["right", "left"]);
  });

  it("uses the facing side when the target ends up behind", () => {
    const s = drawSource(emptyDiagram(), { kind: "graph", options: {}, text }, { x: 0, y: 0 });
    const c = byKey(s.diagram, "n:C").rect, dn = byKey(s.diagram, "n:D");
    // Ship it dragged to well left of the decision, and above it.
    const d = moveObjects(s.diagram, [dn.id], { x: c.x - dn.rect.x - 30, y: -8 });
    expect(sides(d, "e:C>D#1")).not.toEqual(["right", "left"]);
  });

  it("is top-to-bottom's bottom and top after switching direction", () => {
    const s = drawSource(emptyDiagram(), { kind: "graph", options: {}, text }, { x: 0, y: 0 });
    const d = setDirection(s.diagram, s.id, "down").diagram;
    expect(sides(moveObjects(d, [byKey(d, "n:D").id], { x: -12, y: 0 }), "e:C>D#1")).toEqual(["bottom", "top"]);
  });
});

describe("moving lifelines", () => {
  const text = `sequenceDiagram
    participant C as Client
    participant A as API
    participant D as DB
    C->>+A: GET
    A-->>-C: 200
    loop every minute
      C->>A: ping
    end`;
  const rows = (d: Diagram) => Object.values(d.edges).map((e) => rasterize(d).edges.get(e.id)!.from.cell.y).sort((a, b) => a - b);

  it("keeps messages and activation bars on their rows when a lifeline moves up or down", () => {
    const s = drawSource(emptyDiagram(), { kind: "sequence", options: {}, text }, { x: 0, y: 0 });
    const api = byKey(s.diagram, "p:A"), bar = byKey(s.diagram, "a:A#1");
    const d = moveObjects(s.diagram, withContents(s.diagram, [api.id]), { x: 3, y: 2 });
    expect(byKey(d, "p:A").rect).toMatchObject({ x: api.rect.x + 3, y: api.rect.y + 2 });
    expect(byKey(d, "a:A#1").rect).toMatchObject({ x: bar.rect.x + 3, y: bar.rect.y });
    expect(rows(d)).toEqual(rows(s.diagram));
    // And redrawn from edited text, they still do.
    const r = updateSource(d, s.id, { text: text + "\n    C->>D: later" }).diagram;
    expect(rows(r).slice(0, 3)).toEqual(rows(s.diagram));
  });

  it("stretches a loop frame with the lifelines at its edges", () => {
    const s = drawSource(emptyDiagram(), { kind: "sequence", options: {}, text }, { x: 0, y: 0 });
    const f = byKey(s.diagram, "f:0").rect;
    // API is the frame's right-hand lifeline: moving it right widens the frame.
    let d = moveObjects(s.diagram, [byKey(s.diagram, "p:A").id], { x: 6, y: 0 });
    expect(byKey(d, "f:0").rect).toMatchObject({ x: f.x, w: f.w + 6 });
    // Client is its left-hand one: moving it right moves the frame's left edge in.
    d = moveObjects(d, [byKey(d, "p:C").id], { x: 2, y: 0 });
    expect(byKey(d, "f:0").rect).toMatchObject({ x: f.x + 2, w: f.w + 4 });
    // DB isn't spanned: moving it leaves the frame alone.
    expect(byKey(moveObjects(d, [byKey(d, "p:D").id], { x: 5, y: 0 }), "f:0").rect).toEqual(byKey(d, "f:0").rect);
  });
});

describe("notes stay with their lifeline", () => {
  const text = `sequenceDiagram
    participant C as Client
    participant A as API
    C->>A: GET
    Note right of A: cached for 1h
    Note over C,A: both`;
  it("moves left–right with it, keeps its row when it moves up or down", () => {
    const s = drawSource(emptyDiagram(), { kind: "sequence", options: {}, text }, { x: 0, y: 0 });
    const note = byKey(s.diagram, "n:0").rect, over = byKey(s.diagram, "n:1").rect;
    const api = byKey(s.diagram, "p:A").id;
    let d = moveWithLocks(s.diagram, withContents(s.diagram, [api]), { x: 7, y: 0 });
    expect(byKey(d, "n:0").rect).toMatchObject({ x: note.x + 7, y: note.y });
    expect(byKey(d, "n:1").rect).toEqual(over); // over two lifelines: not locked to either
    d = moveWithLocks(d, withContents(d, [api]), { x: 0, y: 3 });
    expect(byKey(d, "n:0").rect).toMatchObject({ x: note.x + 7, y: note.y });
    // Redrawing keeps the lock, without duplicating it.
    d = updateSource(d, s.id, { text: text + "\n    A-->>C: 200" }).diagram;
    expect(Object.values(d.locks!)).toHaveLength(1);
  });
});

it("draws Mermaid's crosses and open arrows, and keeps them through edits", () => {
  const text = "sequenceDiagram\n  A-xB: lost\n  A-)B: ping";
  const s = drawSource(emptyDiagram(), { kind: "sequence", options: {}, text }, { x: 0, y: 0 });
  const rows = (d: Diagram) => diagramToText(d).split("\n").filter((l) => /lost|ping|[×▷]/.test(l));
  expect(rows(s.diagram).join("\n")).toMatch(/×[\s\S]*▷/);
  const again = updateSource(s.diagram, s.id, { text: text + "\n  B->>A: back" }).diagram;
  expect(edgeByKey(again, "m:A>B#1").heads).toEqual({ end: "cross" });
  expect(edgeByKey(again, "m:A>B#2").heads).toEqual({ end: "triangle" });
});
