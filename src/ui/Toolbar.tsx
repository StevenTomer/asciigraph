import { openFind, openStampsDialog, openTextDialog, redo, setPrefs, setShape, setTableSize, setTool, undo, useEditor } from "../editor/store";
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
  const tableSize = useEditor((s) => s.tableSize);

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
        {TOOLS.map((t) => {
          const key = t.key ?? t.label[0];
          const at = t.label.indexOf(key);
          return (
            <button
              key={t.id}
              className={"tb" + (tool === t.id ? " active" : "")}
              onClick={() => setTool(t.id)}
              title={`${t.label} (${key.toUpperCase()})`}
              data-testid={`tool-${t.id}`}
              aria-pressed={tool === t.id}
            >
              {t.label.slice(0, at)}
              <u>{key}</u>
              {t.label.slice(at + 1)}
            </button>
          );
        })}
        <Sep />
        <button className="tb" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">undo</button>
        <button className="tb" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">redo</button>
        <Sep />
        <button className="tb" onClick={() => openTextDialog(null)} title="Draw a sequence, graph or folder tree from text">from text</button>
        <button className="tb" onClick={() => openStampsDialog()} title="Insert a saved group of objects">stamps</button>
        <button className="tb" onClick={openFind} title="Find text (Ctrl+F)">find</button>
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
          {SHAPE_KINDS.filter((k) => k !== "table").map((k) => (
            <button key={k} className={"tb" + (shape === k ? " active" : "")} aria-pressed={shape === k} onClick={() => setShape(k)}>
              {shapeFor(k).label}
            </button>
          ))}
        </div>
      )}
      {tool === "table" && (
        <div className="toolbar sub" role="toolbar" aria-label="Table size">
          <Stepper label="columns" value={tableSize.cols} max={12} onChange={(cols) => setTableSize({ ...tableSize, cols })} />
          <Stepper label="rows" value={tableSize.rows} max={30} onChange={(rows) => setTableSize({ ...tableSize, rows })} />
          <span className="muted">click to place it (the first row is its header), or drag for its width</span>
        </div>
      )}
    </div>
  );
}

function Stepper({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <span className="stepper">
      <span className="muted">{label}</span>
      <button className="tb" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} aria-label={`fewer ${label}`}>−</button>
      <span className="stepper-value" aria-label={label}>{value}</span>
      <button className="tb" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`more ${label}`}>+</button>
    </span>
  );
}

const Sep = () => <span className="sep">│</span>;

export const Kbd = ({ children }: { children: React.ReactNode }) => <kbd className="kbd">{children}</kbd>;
