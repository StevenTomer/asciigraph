import { useEffect, useMemo, useRef, useState } from "react";
import { apply, closeTextDialog, getState, select, useEditor } from "../editor/store";
import { screenToCell } from "../editor/view";
import { emptyDiagram } from "../model/ops";
import type { SourceKind, TextSource } from "../model/types";
import { diagramToText } from "../render/rasterize";
import { pasteInto } from "../editor/clipboard";
import { importAscii, looksLikeDrawing } from "../text/ascii";
import { detectKind } from "../text/detect";
import { describe } from "../text/fromDiagram";
import { adopt, drawSource, membersOf, updateSource } from "../text/sync";

const EXAMPLE_TEXT = {
  sequence: `sequenceDiagram
    participant C as Client
    participant A as API
    participant D as Database
    C->>+A: GET /orders
    A->>+D: SELECT * FROM orders
    D-->>-A: rows
    Note right of A: cached for 1h
    A-->>-C: 200 OK
    loop every minute
      C->>A: ping
    end`,
  graph: `flowchart TD
    A([Start]) --> B[Read order]
    B --> C{In stock?}
    C -->|yes| D[[Ship it]]
    C -->|no| E[(Backorders)]
    D --> F([Done])
    E --> F`,
  tree: `project/
  src/
    main.ts
    util/
      format.ts
  tests/
    main.test.ts
  README.md`,
  state: `stateDiagram-v2
    [*] --> Idle
    Idle --> Working : job arrives
    Working --> Idle : done
    Working --> Failed : error
    Failed --> Idle : retry
    Failed --> [*]`,
  class: `classDiagram
    class Shape {
      <<abstract>>
      +String name
      +area() float
    }
    class Circle {
      +float radius
    }
    class Square {
      +float side
    }
    Shape <|-- Circle
    Shape <|-- Square
    Canvas "1" o-- "*" Shape : draws`,
  er: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    CUSTOMER {
      string name
      string email PK
    }
    ORDER {
      int number PK
      date placed
    }`,
};

/** The examples buttons, in order. */
const EXAMPLES: { label: string; text: string }[] = [
  { label: "message sequence", text: EXAMPLE_TEXT.sequence },
  { label: "flowchart", text: EXAMPLE_TEXT.graph },
  { label: "state", text: EXAMPLE_TEXT.state },
  { label: "class", text: EXAMPLE_TEXT.class },
  { label: "ER", text: EXAMPLE_TEXT.er },
  { label: "folder tree", text: EXAMPLE_TEXT.tree },
];

/** What the dialog can draw: a text source, or a drawing read back into objects (not linked). */
type Kind = SourceKind | "drawing";

const KIND_LABEL: Record<Kind, string> = {
  sequence: "message sequence", graph: "graph (flowchart, state, class, ER)", tree: "folder tree", drawing: "ASCII art",
};

/**
 * Draw a diagram from text (Mermaid, a looser shorthand, or a folder tree), or edit the text of
 * one already drawn: it redraws in place, keeping what you've moved or restyled.
 */
export function TextSourceDialog() {
  const dialog = useEditor((s) => s.textDialog);
  if (!dialog) return null;
  return <Body key={dialog.sourceId ?? dialog.adopt?.join() ?? "new"} sourceId={dialog.sourceId} adoptIds={dialog.adopt} />;
}

function Body({ sourceId, adoptIds }: { sourceId: string | null; adoptIds?: string[] }) {
  // Editing a hand-drawn selection as text: start from Mermaid written for it.
  const [described] = useState(() => (adoptIds ? describe(getState().diagram, adoptIds) : null));
  const existing = sourceId
    ? getState().diagram.sources?.[sourceId]
    : described ? { kind: described.kind, text: described.text, options: described.options } : undefined;
  const editing = !!sourceId || !!described;
  const [kind, setKind] = useState<Kind | "auto">(existing?.kind ?? "auto");
  const [text, setText] = useState(existing?.text ?? "");
  const [direction, setDirection] = useState<"auto" | "down" | "right">(existing?.options.direction ?? "auto");
  const [treeStyle, setTreeStyle] = useState<"text" | "boxes">(existing?.options.treeStyle ?? "text");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const actual: Kind = kind === "auto" ? (!editing && looksLikeDrawing(text) ? "drawing" : detectKind(text)) : kind;
  const options: TextSource["options"] = {
    ...((actual === "graph" || (actual === "tree" && treeStyle === "boxes")) && direction !== "auto" && { direction }),
    ...(actual === "tree" && { treeStyle }),
  };
  const preview = useMemo(() => {
    if (!text.trim()) return { text: "", warnings: [] as string[], drawing: null };
    if (actual === "drawing") {
      const r = importAscii(text);
      return { text: diagramToText(r.diagram), warnings: r.warnings, drawing: r.diagram };
    }
    const r = drawSource(emptyDiagram(), { kind: actual, text, options }, { x: 0, y: 0 });
    return { text: diagramToText(r.diagram), warnings: r.warnings, drawing: null };
  }, [text, actual, JSON.stringify(options)]);

  const draw = () => {
    if (!text.trim()) return;
    let ids: string[] = [];
    if (actual === "drawing") {
      // Ordinary objects, placed where the text was going to go.
      const part = preview.drawing!;
      const lines = preview.text.split("\n");
      const w = Math.max(...lines.map((l) => l.length)), h = lines.length;
      const c = screenToCell(window.innerWidth / 2, window.innerHeight / 2);
      const at = { x: c.x - Math.floor(w / 2), y: Math.max(c.y - Math.floor(h / 2), screenToCell(0, 70).y) };
      apply((d) => {
        const [out, added] = pasteInto(d, part, at);
        ids = added;
        return out;
      });
      select(ids);
      closeTextDialog();
      return;
    }
    if (sourceId && existing) {
      const k = actual as SourceKind;
      apply((d) => updateSource(d, sourceId, { kind: k, text, options: { ...existing.options, ...options } }).diagram);
      ids = membersOf(getState().diagram, sourceId);
    } else if (adoptIds && existing) {
      // Link the selection to the text, then redraw from the (possibly edited) text.
      let id = "";
      apply((d) => {
        const a = adopt(d, adoptIds);
        if (!a) return d;
        id = a.id;
        return updateSource(a.diagram, a.id, { kind: actual as SourceKind, text, options: { ...existing.options, ...options } }).diagram;
      });
      ids = id ? membersOf(getState().diagram, id) : [];
    } else {
      // Centered on screen.
      const lines = preview.text.split("\n");
      const w = Math.max(...lines.map((l) => l.length)), h = lines.length;
      const c = screenToCell(window.innerWidth / 2, window.innerHeight / 2);
      const origin = { x: c.x - Math.floor(w / 2), y: Math.max(c.y - Math.floor(h / 2), screenToCell(0, 70).y) };
      let id = "";
      apply((d) => {
        const r = drawSource(d, { kind: actual as SourceKind, text, options }, origin);
        id = r.id;
        return r.diagram;
      });
      ids = membersOf(getState().diagram, id);
    }
    select(ids);
    closeTextDialog();
  };

  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && closeTextDialog()}>
      <div
        className="dialog wide"
        role="dialog"
        aria-label={sourceId ? "Edit source text" : described ? "Edit as text" : "Draw from text"}
        onKeyDown={(e) => {
          if (e.key === "Escape") closeTextDialog();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) draw();
        }}
      >
        <div className="dialog-title">
          <span>{sourceId ? "edit source text" : described ? "edit as text" : "draw from text"}</span>
          <button className="tb" onClick={closeTextDialog} aria-label="Close">✕</button>
        </div>
        <div className="row">
          <span className="row-label">kind</span>
          <span className="row-items">
            {(editing ? (["auto", "sequence", "graph", "tree"] as const) : (["auto", "sequence", "graph", "tree", "drawing"] as const)).map((k) => (
              <button key={k} className={"choice" + (kind === k ? " active" : "")} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {k === "auto" ? `auto${text.trim() ? `: ${KIND_LABEL[actual]}` : ""}` : KIND_LABEL[k]}
              </button>
            ))}
          </span>
        </div>
        {actual === "graph" && (
          <div className="row">
            <span className="row-label">direction</span>
            <span className="row-items">
              {(["auto", "down", "right"] as const).map((v) => (
                <button key={v} className={"choice" + (direction === v ? " active" : "")} aria-pressed={direction === v} onClick={() => setDirection(v)}>
                  {v === "auto" ? "from text" : v === "down" ? "top to bottom (TB)" : "left to right (LR)"}
                </button>
              ))}
            </span>
          </div>
        )}
        {actual === "tree" && treeStyle === "boxes" && (
          <div className="row">
            <span className="row-label">direction</span>
            <span className="row-items">
              {(["down", "right"] as const).map((v) => (
                <button key={v} className={"choice" + ((direction === "auto" ? "down" : direction) === v ? " active" : "")} aria-pressed={(direction === "auto" ? "down" : direction) === v} onClick={() => setDirection(v)}>
                  {v === "down" ? "top to bottom (TB)" : "left to right (LR)"}
                </button>
              ))}
            </span>
          </div>
        )}
        {actual === "tree" && (
          <div className="row">
            <span className="row-label">style</span>
            <span className="row-items">
              {(["text", "boxes"] as const).map((v) => (
                <button key={v} className={"choice" + (treeStyle === v ? " active" : "")} aria-pressed={treeStyle === v} onClick={() => setTreeStyle(v)}>
                  {v === "text" ? "tree text" : "boxes"}
                </button>
              ))}
            </span>
          </div>
        )}
        <div className="text-source">
          <textarea
            ref={ref}
            className="field source"
            aria-label="Diagram text"
            spellCheck={false}
            value={text}
            placeholder={"Mermaid (sequenceDiagram / flowchart), shorthand like\n  Client -> API: GET /x\n  A -> B -> C\nor a folder tree."}
            onChange={(e) => setText(e.target.value)}
          />
          <pre className="preview" aria-label="Preview" data-testid="source-preview">{preview.text || "(preview)"}</pre>
        </div>
        {preview.warnings.length > 0 && (
          <ul className="note error" role="status">
            {preview.warnings.slice(0, 6).map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
        <div className="row buttons">
          <button className="tb accent" onClick={draw} disabled={!text.trim()} title="Ctrl+Enter">{editing ? "update" : "draw"}</button>
          <span className="muted">examples:</span>
          {EXAMPLES.map((x) => (
            <button key={x.label} className="tb" onClick={() => { setText(x.text); setKind("auto"); }}>{x.label}</button>
          ))}
        </div>
        {editing && <p className="note muted">Things you've moved, resized or restyled stay as they are; the rest is redrawn from the text. {described && "Connectors with a loose end, or to boxes outside the selection, aren't included and stay as they are."}</p>}
      </div>
    </div>
  );
}
