import type { Rect } from "../geometry/geom";
import { addEdge, addNode, emptyDiagram, makeEdge, makeNode } from "../model/ops";
import type { Diagram, Edge, Endpoint, Node, SourceKind } from "../model/types";
import { tableNode } from "../shapes/table";
import { drawSource } from "../text/sync";
import { stampOf } from "./stamps";

/**
 * Ready-made stamps, in sets: flowchart and architecture patterns, sequence-diagram exchanges,
 * UI mockup pieces, and notes for documents. Each is drawn when the dialog first shows its set:
 * from Mermaid (by the same code as "from text", then unlinked), or built from objects.
 */
export interface ReadyStamp {
  name: string;
  diagram: Diagram;
}

export interface StampSet {
  id: string;
  label: string;
  stamps: () => ReadyStamp[];
}

/** Mermaid (or shorthand) drawn as plain objects. */
function fromText(kind: SourceKind, text: string, options: { direction?: "down" | "right" } = {}): Diagram {
  return stampOf(drawSource(emptyDiagram(), { kind, text, options }, { x: 0, y: 0 }).diagram);
}

/** Objects placed by hand: `box` and `label` add nodes, `line` a connector between two of them
 * (or free cells). */
function build(fn: (b: Builder) => void): Diagram {
  let d = emptyDiagram();
  const b: Builder = {
    box(rect, patch = {}) {
      const n = makeNode(rect, patch);
      d = addNode(d, n);
      return n;
    },
    label(x, y, text, patch = {}) {
      const lines = text.split("\n");
      const n = makeNode({ x, y, w: Math.max(...lines.map((l) => Array.from(l).length)), h: lines.length }, {
        border: "none", autosize: true, align: { h: "left", v: "top" }, lists: false, text, ...patch,
      });
      d = addNode(d, n);
      return n;
    },
    table(x, y, markdown) {
      const { rect, ...fields } = tableNode(markdown, { x, y });
      return b.box(rect, fields);
    },
    line(from, to, patch = {}) {
      const end = (e: Node | Endpoint): Endpoint => ("kind" in e && (e.kind === "free" || e.kind === "attached") ? e as Endpoint : { kind: "attached", node: (e as Node).id, side: "auto" });
      d = addEdge(d, makeEdge(end(from), end(to), patch));
    },
  };
  fn(b);
  return stampOf(d);
}

interface Builder {
  box(rect: Rect, patch?: Partial<Node>): Node;
  label(x: number, y: number, text: string, patch?: Partial<Node>): Node;
  table(x: number, y: number, markdown: string): Node;
  line(from: Node | Endpoint, to: Node | Endpoint, patch?: Partial<Edge>): void;
}

const free = (x: number, y: number): Endpoint => ({ kind: "free", at: { x, y } });
const button = (b: Builder, x: number, y: number, text: string) =>
  b.box({ x, y, w: Array.from(text).length + 4, h: 3 }, { border: "rounded", text });

export const STAMP_SETS: StampSet[] = [
  {
    id: "flowchart",
    label: "flowchart",
    stamps: () => [
      { name: "Start, steps, end", diagram: fromText("graph", "flowchart TD\n  A([Start]) --> B[First step] --> C[Next step] --> D([End])") },
      { name: "Yes / no decision", diagram: fromText("graph", "flowchart TD\n  Q{Ready?} -->|yes| Y[Go ahead]\n  Q -->|no| N[Wait]") },
      { name: "Retry loop", diagram: fromText("graph", "flowchart TD\n  A[Try it] --> B{Worked?}\n  B -->|no| A\n  B -->|yes| C([Done])") },
      { name: "Input, process, output", diagram: fromText("graph", "flowchart LR\n  I[/Input/] --> P[Process] --> O[/Output/]") },
      { name: "Subprocess", diagram: fromText("graph", "flowchart LR\n  A[Before] --> S[[Subprocess]] --> B[After]") },
    ],
  },
  {
    id: "architecture",
    label: "architecture",
    stamps: () => [
      { name: "Client, server, database", diagram: fromText("graph", "flowchart LR\n  C[Browser] -->|HTTPS| S[Server] --> D[(Database)]") },
      { name: "Load balancer", diagram: fromText("graph", "flowchart LR\n  L[Load balancer] --> A[Server 1]\n  L --> B[Server 2]\n  L --> C[Server 3]") },
      { name: "Queue and workers", diagram: fromText("graph", "flowchart LR\n  P[Producer] --> Q[[Queue]]\n  Q --> A[Worker 1]\n  Q --> B[Worker 2]") },
      { name: "Cache in front of a database", diagram: fromText("graph", "flowchart LR\n  A[App] --> C[(Cache)]\n  A -.->|on a miss| D[(Database)]") },
      { name: "Layers", diagram: fromText("graph", "flowchart TD\n  U[User interface] --> L[Business logic] --> D[Data access] --> B[(Database)]") },
      {
        name: "Public and private networks",
        diagram: fromText("graph", "flowchart LR\n  U[Users] --> W\n  subgraph Private network\n    W[Web server] --> D[(Database)]\n  end"),
      },
    ],
  },
  {
    id: "sequence",
    label: "sequence",
    stamps: () => [
      { name: "Request and response", diagram: fromText("sequence", "sequenceDiagram\n  Client->>+Server: request\n  Server-->>-Client: response") },
      {
        name: "Sign in",
        diagram: fromText("sequence", "sequenceDiagram\n  participant U as User\n  participant A as App\n  participant I as Identity provider\n  U->>A: sign in\n  A->>I: redirect\n  I-->>A: token\n  A-->>U: signed in"),
      },
      { name: "Retry until it works", diagram: fromText("sequence", "sequenceDiagram\n  loop until it works\n    Client->>Server: try\n    Server-->>Client: busy\n  end") },
      {
        name: "Success or failure",
        diagram: fromText("sequence", "sequenceDiagram\n  Client->>Server: save\n  alt saved\n    Server-->>Client: 200 OK\n  else failed\n    Server-->>Client: 500 error\n  end"),
      },
      { name: "Callback later", diagram: fromText("sequence", "sequenceDiagram\n  Client-)Worker: start the job\n  Note over Worker: works on it\n  Worker--)Client: done") },
    ],
  },
  {
    id: "ui",
    label: "UI mockups",
    stamps: () => [
      {
        name: "Window",
        diagram: build((b) => {
          b.box({ x: 0, y: 0, w: 40, h: 14 }, { kind: "class", text: "● ● ●   Window title\n---\n", align: { h: "left", v: "top" } });
        }),
      },
      {
        name: "Browser",
        diagram: build((b) => {
          b.box({ x: 0, y: 0, w: 44, h: 16 }, { kind: "class", text: "● ● ●\n---\n◀ ▶ ↻  https://example.com\n---\n", align: { h: "left", v: "top" } });
        }),
      },
      {
        name: "Dialog",
        diagram: build((b) => {
          b.box({ x: 0, y: 0, w: 34, h: 9 }, { name: "Delete file?", text: "This can't be undone.", align: { h: "left", v: "top" } });
          button(b, 13, 5, "Cancel");
          button(b, 23, 5, "Delete");
        }),
      },
      {
        name: "Sign-in form",
        diagram: build((b) => {
          b.box({ x: 0, y: 0, w: 34, h: 15 }, { name: "Sign in" });
          b.label(3, 2, "Email");
          b.box({ x: 3, y: 3, w: 28, h: 3 }, { text: "you@example.com", align: { h: "left", v: "middle" } });
          b.label(3, 6, "Password");
          b.box({ x: 3, y: 7, w: 28, h: 3 }, { text: "••••••••", align: { h: "left", v: "middle" } });
          b.label(3, 11, "☐ Remember me");
          button(b, 21, 10, "Sign in");
        }),
      },
      {
        name: "Tabs",
        diagram: build((b) => {
          b.box({ x: 0, y: 0, w: 36, h: 10 }, { kind: "class", text: "General │ Account │ Privacy │\n---\n", align: { h: "left", v: "top" } });
        }),
      },
      {
        name: "Form controls",
        diagram: build((b) => {
          b.label(0, 0, "☑ Checked\n☐ Not checked\n\n◉ Chosen\n○ Not chosen");
          b.box({ x: 18, y: 0, w: 18, h: 3 }, { text: "Choose…     ▾", align: { h: "left", v: "middle" } });
          b.box({ x: 18, y: 3, w: 18, h: 3 }, { text: "Search…", align: { h: "left", v: "middle" } });
          button(b, 18, 6, "Button");
        }),
      },
      {
        name: "Phone",
        diagram: build((b) => {
          b.box({ x: 0, y: 0, w: 22, h: 16 }, {
            kind: "class", border: "rounded", align: { h: "left", v: "top" },
            text: "9:41          ●●●\n---\n" + "\n".repeat(10) + "---\n  ◀     ●     ■",
          });
        }),
      },
    ],
  },
  {
    id: "notes",
    label: "notes",
    stamps: () => [
      { name: "Note", diagram: build((b) => void b.box({ x: 0, y: 0, w: 28, h: 5 }, { kind: "note", text: "Something to remember", align: { h: "left", v: "top" } })) },
      {
        name: "Callout",
        diagram: build((b) => {
          const c = b.box({ x: 0, y: 0, w: 22, h: 3 }, { border: "rounded", text: "Look at this" });
          b.line(c, free(30, 6));
        }),
      },
      { name: "Table", diagram: build((b) => void b.table(0, 0, "| Name | Value |\n|------|-------|\n| one  | 1     |\n| two  | 2     |")) },
      {
        name: "Checklist",
        diagram: build((b) => void b.box({ x: 0, y: 0, w: 22, h: 6 }, { name: "To do", text: "☑ Write it\n☐ Test it\n☐ Ship it", align: { h: "left", v: "top" }, lists: false })),
      },
      {
        name: "Legend",
        diagram: build((b) => {
          b.box({ x: 0, y: 0, w: 30, h: 13 }, { kind: "frame", name: "Legend" });
          b.box({ x: 2, y: 2, w: 8, h: 3 });
          b.label(12, 3, "a service");
          b.box({ x: 2, y: 5, w: 8, h: 4 }, { kind: "database" });
          b.label(12, 6, "data");
          b.line(free(2, 10), free(9, 10));
          b.label(12, 10, "calls");
          b.line(free(2, 11), free(9, 11), { line: "dotted" });
          b.label(12, 11, "events");
        }),
      },
      {
        name: "Timeline",
        diagram: build((b) => {
          b.label(0, 0, " Plan      Build     Test      Ship\n──●─────────●─────────●─────────●──►");
        }),
      },
    ],
  },
];
