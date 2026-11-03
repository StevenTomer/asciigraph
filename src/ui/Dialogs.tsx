import { useEffect, useMemo, useRef, useState } from "react";
import { exportText } from "../export/text";
import { forgetHistory, newDiagram, renameCurrent, repo } from "../editor/session";
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
    forgetHistory(id);
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
        <dt>snapping</dt><dd>moving, resizing or drawing a box lines its edges and centre up with other boxes nearby, with guides; hold <Kbd>ctrl</Kbd> to place it freely</dd>
        <dt>boxes in boxes</dt><dd>a box entirely inside another is part of it: it's drawn in front, and moves when the outer box moves. <Kbd>alt</Kbd>+drag moves just the outer box; or set "inside: stays put" on the box</dd>
        <dt><Kbd>b</Kbd> box</dt><dd>drag corner to corner, or click empty space for a default box; then type. Pick the shape under the toolbar: box; flowchart decision, input/output, start/end, database, document or subroutine; a note; or for sequence diagrams, a lifeline or an activation bar (draw one on a lifeline and it centres on the line). Draw messages between lifelines and activation bars with the arrow tool: they stay horizontal.
         Clicking an existing box selects it (and switches to select); dragging from inside a box draws one inside it</dd>
        <dt><Kbd>a</Kbd> arrow, <Kbd>l</Kbd> line</dt><dd>drag from one box to another. Start or end inside a box to attach to whichever side faces; on a border (or just outside it) to pin that spot. Hold <Kbd>alt</Kbd> to leave an end free. Clicking (not dragging) a box or connector selects it and switches to select</dd>
        <dt><Kbd>t</Kbd> text</dt><dd>click empty space to type a label without a border (double-click empty space does the same). Clicking a box or connector selects it and switches to select; <Kbd>alt</Kbd>+click places a label there instead, e.g. inside a box</dd>
        <dt>connector ends</dt><dd>select a connector, then drag an end handle onto or off a box to attach or detach it</dd>
        <dt>bends</dt><dd>select a connector, then drag its line to add a bend point there; drag a bend point (square) to move it, double-click it to remove it. "Straighten" removes them all</dd>
        <dt>labels</dt><dd>double-click a connector (or select it and press <Kbd>enter</Kbd>) to label it; drag a label to move it along its connector</dd>
        <dt><Kbd>enter</Kbd></dt><dd>edit the selected box's text; <Kbd>esc</Kbd> or click outside to finish</dd>
        <dt><Kbd>delete</Kbd>, arrows</dt><dd>delete or nudge the selection (<Kbd>shift</Kbd>: by 5)</dd>
        <dt>from text</dt><dd>draw a message sequence, graph or folder tree from text (toolbar "from text", or right-click empty space). Accepts Mermaid (<code>sequenceDiagram</code>: <code>A-&gt;&gt;B: msg</code>, <code>--&gt;&gt;</code> replies, <code>+</code>/<code>-</code> activation, <code>Note right of A: …</code>, <code>loop</code>/<code>alt</code>/<code>else</code>/<code>end</code>; <code>flowchart TD</code>/<code>LR</code>: <code>A[box] --&gt;|label| B{{decision}}</code>, <code>([start])</code>, <code>[(database)]</code>, <code>[[subroutine]]</code>, <code>[/in-out/]</code>, <code>subgraph … end</code>), a shorthand (<code>Client -&gt; API: GET /x</code>, <code>A -&gt; B -&gt; C</code>), and folder trees (<code>tree</code> output, indented names or paths). It stays linked: select it and "edit text" to change the text and redraw; things you've moved, resized or restyled stay put. "Unlink" makes it ordinary objects</dd>
        <dt>lists</dt><dd>in a box, lines starting <code>- </code>, <code>* </code> or <code>1. </code> become bullet and numbered lists; indent to nest</dd>
        <dt>right-click</dt><dd>menu for what's under the pointer: edit, cut/copy/paste/duplicate, stacking order, and with several boxes selected, Align, Distribute and Auto Layout (arranges boxes in layers following their connectors; on empty space it lays out the whole diagram)</dd>
        <dt><Kbd>ctrl+]</Kbd> / <Kbd>ctrl+[</Kbd></dt><dd>bring forward / send backward (with <Kbd>shift</Kbd>: to front / to back)</dd>
        <dt><Kbd>ctrl+d</Kbd></dt><dd>duplicate</dd>
        <dt><Kbd>ctrl+z</Kbd> / <Kbd>ctrl+shift+z</Kbd></dt><dd>undo / redo</dd>
        <dt><Kbd>ctrl+c</Kbd> <Kbd>ctrl+x</Kbd> <Kbd>ctrl+v</Kbd></dt><dd>copy, cut, paste (copies as text for other apps too)</dd>
        <dt>scroll, <Kbd>space</Kbd>+drag, middle-drag</dt><dd>pan; <Kbd>ctrl</Kbd>+scroll or pinch to zoom</dd>
        <dt><Kbd>ctrl+=</Kbd> / <Kbd>ctrl+-</Kbd> / <Kbd>ctrl+0</Kbd> / <Kbd>shift+1</Kbd></dt><dd>zoom in / out / back to 100% / to fit the drawing (also the buttons at bottom right)</dd>
      </dl>
      <p className="muted">Text rendering, input handling and fonts are adapted from <a href="https://github.com/lewish/asciiflow" target="_blank" rel="noopener">ASCIIFlow</a> by Lewis Hemens (MIT).</p>
    </Dialog>
  );
}
