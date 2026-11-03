import { useEffect, useMemo, useRef, useState } from "react";
import { exportText } from "../export/text";
import { newDiagram, renameCurrent, repo } from "../editor/session";
import { useEditor } from "../editor/store";
import type { DiagramMeta } from "../storage/repository";
import { download, downloadDiagram, readDiagramFile, safeFilename } from "../storage/file";
import { shareUrl } from "../storage/share";
import { Kbd } from "./Toolbar";

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [onClose]);
  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={title}>
        <div className="dialog-title">
          <span>{title}</span>
          <button className="tb" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const diagram = useEditor((s) => s.diagram);
  const name = useEditor((s) => s.diagramName);
  const [ascii, setAscii] = useState(false);
  const [markdown, setMarkdown] = useState(false);
  const [note, setNote] = useState("");
  const text = useMemo(() => exportText(diagram, { ascii, markdown }), [diagram, ascii, markdown]);

  const copy = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNote(`Copied ${what}.`);
    } catch {
      setNote("Couldn't copy; select the text and copy it yourself.");
    }
  };

  return (
    <Dialog title="export" onClose={onClose}>
      <div className="row">
        <label><input type="checkbox" checked={ascii} onChange={(e) => setAscii(e.target.checked)} /> ASCII only</label>
        <label><input type="checkbox" checked={markdown} onChange={(e) => setMarkdown(e.target.checked)} /> Markdown code block</label>
      </div>
      <pre className="preview" data-testid="export-text">{text || "(empty diagram)"}</pre>
      <div className="row buttons">
        <button className="tb accent" onClick={() => void copy(text, "the text")} data-testid="copy-text">copy text</button>
        <button className="tb" onClick={() => download(`${safeFilename(name)}.${markdown ? "md" : "txt"}`, text + "\n", "text/plain")}>download .{markdown ? "md" : "txt"}</button>
        <button className="tb" onClick={() => downloadDiagram(name, diagram)} title="Keeps the boxes and connectors, for importing later">download .json</button>
        <button className="tb" onClick={() => void copy(shareUrl(diagram, name), "a share link")}>copy share link</button>
      </div>
      {note && <p className="note" role="status">{note}</p>}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------

export function DiagramsDialog({ onClose }: { onClose: () => void }) {
  const currentId = useEditor((s) => s.diagramId);
  const currentName = useEditor((s) => s.diagramName);
  const [list, setList] = useState<DiagramMeta[]>([]);
  const [name, setName] = useState(currentName);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = () => void repo.list().then(setList);
  useEffect(refresh, [currentId]);

  const open = (id: string) => {
    location.hash = `#/d/${encodeURIComponent(id)}`;
    onClose();
  };
  const remove = async (id: string) => {
    await repo.remove(id);
    setConfirming(null);
    if (id === currentId) {
      const next = (await repo.list())[0];
      if (next) open(next.id);
      else await newDiagram();
    }
    refresh();
  };
  const importFile = async (file: File) => {
    try {
      const { name: n, diagram } = await readDiagramFile(file);
      await newDiagram(n, diagram);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog title="diagrams" onClose={onClose}>
      {currentId && (
        <div className="row">
          <span className="row-label">name</span>
          <input
            className="field grow"
            value={name}
            aria-label="Diagram name"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== currentName && void renameCurrent(name.trim()).then(refresh)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </div>
      )}
      <ul className="diagram-list">
        {list.map((m) => (
          <li key={m.id} className={m.id === currentId ? "current" : ""}>
            <button className="tb grow left" onClick={() => open(m.id)}>
              {m.name || "Untitled"} <span className="muted">{new Date(m.updated).toLocaleString()}</span>
            </button>
            {confirming === m.id ? (
              <>
                <button className="tb danger" onClick={() => void remove(m.id)}>delete it</button>
                <button className="tb" onClick={() => setConfirming(null)}>keep</button>
              </>
            ) : (
              <button className="tb" onClick={() => setConfirming(m.id)} aria-label={`Delete ${m.name}`}>delete</button>
            )}
          </li>
        ))}
      </ul>
      <div className="row buttons">
        <button className="tb accent" onClick={() => void newDiagram().then(onClose)}>new diagram</button>
        <button className="tb" onClick={() => fileRef.current?.click()}>import .json</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
      </div>
      {error && <p className="note error" role="alert">{error}</p>}
      <p className="note muted">Diagrams are saved in this browser.</p>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="help" onClose={onClose}>
      <p>Draw boxes, type in them, and connect them. Connectors attached to a box follow it when it moves. Export the result as plain text.</p>
      <p>Drawing tools stay on, so you can draw several boxes or connectors in a row; <Kbd>space</Kbd>, <Kbd>esc</Kbd> or <Kbd>s</Kbd> goes back to select.</p>
      <dl className="help">
        <dt><Kbd>s</Kbd> or <Kbd>space</Kbd> select</dt><dd>click or drag a rectangle to select; drag to move; handles resize; double-click edits text (on a box's top border: its name)</dd>
        <dt>boxes in boxes</dt><dd>a box entirely inside another is part of it: it's drawn in front, and moves when the outer box moves. <Kbd>alt</Kbd>+drag moves just the outer box; or set "inside: stays put" on the box</dd>
        <dt><Kbd>b</Kbd> box</dt><dd>drag corner to corner, or click empty space for a default box; then type. Clicking an existing box selects it (and switches to select); dragging from inside a box draws one inside it</dd>
        <dt><Kbd>a</Kbd> arrow, <Kbd>l</Kbd> line</dt><dd>drag from one box to another. Start or end inside a box to attach to whichever side faces; on a border (or just outside it) to pin that spot. Hold <Kbd>alt</Kbd> to leave an end free. Clicking (not dragging) a box or connector selects it and switches to select</dd>
        <dt><Kbd>t</Kbd> text</dt><dd>click to type a label without a border (double-click empty space does the same)</dd>
        <dt>connector ends</dt><dd>select a connector, then drag an end handle onto or off a box to attach or detach it</dd>
        <dt><Kbd>enter</Kbd></dt><dd>edit the selected box's text; <Kbd>esc</Kbd> or click outside to finish</dd>
        <dt><Kbd>delete</Kbd>, arrows</dt><dd>delete or nudge the selection (<Kbd>shift</Kbd>: by 5)</dd>
        <dt><Kbd>ctrl+z</Kbd> / <Kbd>ctrl+shift+z</Kbd></dt><dd>undo / redo</dd>
        <dt><Kbd>ctrl+c</Kbd> <Kbd>ctrl+x</Kbd> <Kbd>ctrl+v</Kbd></dt><dd>copy, cut, paste (copies as text for other apps too)</dd>
        <dt>scroll, <Kbd>space</Kbd>+drag, middle-drag</dt><dd>pan; <Kbd>ctrl</Kbd>+scroll or pinch to zoom</dd>
      </dl>
      <p className="muted">Text rendering, input handling and fonts are adapted from <a href="https://github.com/lewish/asciiflow" target="_blank" rel="noopener">ASCIIFlow</a> by Lewis Hemens (MIT).</p>
    </Dialog>
  );
}
