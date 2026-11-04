import { openTextDialog, redo, setPrefs, setShape, setTool, undo, useEditor } from "../editor/store";
import { SHAPE_KINDS, shapeFor } from "../shapes/registry";
import { TOOLS } from "../editor/tools";
import { saveCopy } from "../editor/session";

export type DialogId = "diagrams" | "export" | "help" | null;

export function Toolbar({ openDialog }: { openDialog: (d: DialogId) => void }) {
  const tool = useEditor((s) => s.tool);
  const canUndo = useEditor((s) => s.past.length > 0 || s.pending !== null);
  const canRedo = useEditor((s) => s.future.length > 0);
  const dark = useEditor((s) => s.dark);
  const grid = useEditor((s) => s.grid);
  const snap = useEditor((s) => s.snap);
  const name = useEditor((s) => s.diagramName);
  const shared = useEditor((s) => s.diagramId === null);
  const shape = useEditor((s) => s.shape);

  return (
    <div className="toolbar-wrap">
      <div className="toolbar" role="toolbar">
        <span className="brand" title="asciigraph">
          <span style={{ color: "var(--color-cyan)" }}>a</span>
          <span style={{ color: "var(--color-purple)" }}>g</span>
        </span>
        <Sep />
        <button className="tb name" onClick={() => openDialog("diagrams")} title="Diagrams" data-testid="diagrams">
          {name || "Untitled"} ▾
        </button>
        {shared && (
          <button className="tb accent" onClick={() => void saveCopy()} title="This is a shared diagram; keep a copy">
            save a copy
          </button>
        )}
        <Sep />
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={"tb" + (tool === t.id ? " active" : "")}
            onClick={() => setTool(t.id)}
            title={`${t.label} (${t.label[0].toUpperCase()})`}
            data-testid={`tool-${t.id}`}
            aria-pressed={tool === t.id}
          >
            <u>{t.label[0]}</u>
            {t.label.slice(1)}
          </button>
        ))}
        <Sep />
        <button className="tb" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">undo</button>
        <button className="tb" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">redo</button>
        <Sep />
        <button className="tb" onClick={() => openTextDialog(null)} title="Draw a sequence, graph or folder tree from text">from text</button>
        <button className="tb" onClick={() => openDialog("export")} data-testid="export">export</button>
        <button className="tb" onClick={() => setPrefs({ grid: !grid })} aria-pressed={grid}>grid</button>
        <button
          className={"tb" + (snap ? "" : " off")}
          onClick={() => setPrefs({ snap: !snap })}
          aria-pressed={snap}
          title={snap ? "Snapping on: boxes line up with their neighbors (hold Alt or Ctrl while dragging to place freely)" : "Snapping off"}
        >
          snap
        </button>
        <button className="tb" onClick={() => setPrefs({ dark: !dark })} aria-pressed={dark}>{dark ? "light" : "dark"}</button>
        <button className="tb" onClick={() => openDialog("help")}>help</button>
      </div>
      {tool === "box" && (
        <div className="toolbar sub" role="toolbar" aria-label="Shape">
          <span className="muted">shape</span>
          {SHAPE_KINDS.map((k) => (
            <button key={k} className={"tb" + (shape === k ? " active" : "")} aria-pressed={shape === k} onClick={() => setShape(k)}>
              {shapeFor(k).label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const Sep = () => <span className="sep">│</span>;

export const Kbd = ({ children }: { children: React.ReactNode }) => <kbd className="kbd">{children}</kbd>;
