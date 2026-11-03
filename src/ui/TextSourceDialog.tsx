import { useEffect, useMemo, useRef, useState } from "react";
import { apply, closeTextDialog, getState, select, useEditor } from "../editor/store";
import { screenToCell } from "../editor/view";
import { emptyDiagram } from "../model/ops";
import type { SourceKind, TextSource } from "../model/types";
import { diagramToText } from "../render/rasterize";
import { detectKind } from "../text/detect";
import { describe } from "../text/fromDiagram";
import { adopt, drawSource, membersOf, updateSource } from "../text/sync";

const EXAMPLES: Record<SourceKind, string> = {
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
├── src/
│   ├── main.ts
│   └── util/
│       └── format.ts
├── tests/
│   └── main.test.ts
└── README.md`,
};

const KIND_LABEL: Record<SourceKind, string> = { sequence: "message sequence", graph: "graph", tree: "folder tree" };

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
  const [kind, setKind] = useState<SourceKind | "auto">(existing?.kind ?? "auto");
  const [text, setText] = useState(existing?.text ?? "");
  const [direction, setDirection] = useState<"auto" | "down" | "right">(existing?.options.direction ?? "auto");
  const [treeStyle, setTreeStyle] = useState<"text" | "boxes">(existing?.options.treeStyle ?? "text");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const actual: SourceKind = kind === "auto" ? detectKind(text) : kind;
  const options: TextSource["options"] = {
    ...(actual === "graph" && direction !== "auto" && { direction }),
    ...(actual === "tree" && { treeStyle }),
  };
  const preview = useMemo(() => {
    if (!text.trim()) return { text: "", warnings: [] as string[] };
    const r = drawSource(emptyDiagram(), { kind: actual, text, options }, { x: 0, y: 0 });
    return { text: diagramToText(r.diagram), warnings: r.warnings };
  }, [text, actual, JSON.stringify(options)]);

  const draw = () => {
    if (!text.trim()) return;
    let ids: string[] = [];
    if (sourceId && existing) {
      apply((d) => updateSource(d, sourceId, { kind: actual, text, options: { ...existing.options, ...options } }).diagram);
      ids = membersOf(getState().diagram, sourceId);
    } else if (adoptIds && existing) {
      // Link the selection to the text, then redraw from the (possibly edited) text.
      let id = "";
      apply((d) => {
        const a = adopt(d, adoptIds);
        if (!a) return d;
        id = a.id;
        return updateSource(a.diagram, a.id, { kind: actual, text, options: { ...existing.options, ...options } }).diagram;
      });
      ids = id ? membersOf(getState().diagram, id) : [];
    } else {
      // Centred on screen.
      const lines = preview.text.split("\n");
      const w = Math.max(...lines.map((l) => l.length)), h = lines.length;
      const c = screenToCell(window.innerWidth / 2, window.innerHeight / 2);
      const origin = { x: c.x - Math.floor(w / 2), y: Math.max(c.y - Math.floor(h / 2), screenToCell(0, 70).y) };
      let id = "";
      apply((d) => {
        const r = drawSource(d, { kind: actual, text, options }, origin);
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
            {(["auto", "sequence", "graph", "tree"] as const).map((k) => (
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
                  {v === "auto" ? "from text" : v === "down" ? "top to bottom" : "left to right"}
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
          {(["sequence", "graph", "tree"] as const).map((k) => (
            <button key={k} className="tb" onClick={() => { setText(EXAMPLES[k]); setKind("auto"); }}>{KIND_LABEL[k]}</button>
          ))}
        </div>
        {editing && <p className="note muted">Things you've moved, resized or restyled stay as they are; the rest is redrawn from the text. {described && "Connectors with a loose end, or to boxes outside the selection, aren't included and stay as they are."}</p>}
      </div>
    </div>
  );
}
