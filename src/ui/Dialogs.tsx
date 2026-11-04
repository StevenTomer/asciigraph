import { useEffect, useMemo, useRef, useState } from "react";
import { type ImageTheme, exportPng, exportSvg, fontBase64 } from "../export/image";
import { type Wrap, WRAPS, exportText, subset } from "../export/text";
import { withContents } from "../model/containment";
import { readJson, writeJson } from "../storage/local";
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
  const whole = useEditor((s) => s.diagram);
  const selection = useEditor((s) => s.selection);
  const dark = useEditor((s) => s.dark);
  const name = useEditor((s) => s.diagramName);
  // The last choices are remembered (this browser).
  const saved = readJson<{
    ascii?: boolean; kind?: Wrap["kind"]; first?: string; prefix?: string; last?: string; theme?: ImageTheme; transparent?: boolean;
  }>("export", {});
  const [ascii, setAscii] = useState(!!saved.ascii);
  // With something selected, export just that (and what's inside it), unless unticked.
  const [onlySelection, setOnlySelection] = useState(selection.length > 0);
  const partial = onlySelection && selection.length > 0;
  const diagram = useMemo(() => (partial ? subset(whole, withContents(whole, selection)) : whole), [whole, selection, partial]);
  const [theme, setTheme] = useState<ImageTheme>(saved.theme ?? (dark ? "dark" : "light"));
  const [transparent, setTransparent] = useState(!!saved.transparent);
  const [kind, setKind] = useState<Wrap["kind"]>(WRAPS.some((w) => w.kind === saved.kind) ? saved.kind! : "plain");
  const [custom, setCustom] = useState({ first: saved.first ?? "", prefix: saved.prefix ?? "-- ", last: saved.last ?? "" });
  const [note, setNote] = useState("");
  const wrap: Wrap = kind === "custom" ? { kind, ...custom } : { kind };
  const text = useMemo(() => exportText(diagram, { ascii, wrap }), [diagram, ascii, JSON.stringify(wrap)]);
  useEffect(() => writeJson("export", { ascii, kind, ...custom, theme, transparent }), [ascii, kind, custom, theme, transparent]);
  const ext = WRAPS.find((w) => w.kind === kind)!.ext;
  const file = safeFilename(name) + (partial ? "-selection" : "");
  const image = { ascii, theme, transparent };

  const svg = async () => download(`${file}.svg`, exportSvg(diagram, image, (await fontBase64()) ?? undefined), "image/svg+xml");
  const png = async () => download(`${file}.png`, await exportPng(diagram, image), "image/png");
  const copyPng = async () => {
    try {
      // A promise for the blob keeps Safari's clipboard permission tied to the click.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": exportPng(diagram, image) })]);
      setNote("Copied the picture.");
    } catch {
      setNote("Couldn't copy the picture here; download the PNG instead.");
    }
  };

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
        <span className="row-label">format</span>
        <span className="row-items" role="group" aria-label="Format">
          {WRAPS.map((w) => (
            <button key={w.kind} className={"choice" + (kind === w.kind ? " active" : "")} aria-pressed={kind === w.kind} onClick={() => setKind(w.kind)}>
              {w.label}
            </button>
          ))}
        </span>
      </div>
      {kind === "custom" && (
        <div className="row">
          <span className="row-label" />
          <label className="muted">first line <input className="field short" value={custom.first} aria-label="First line" placeholder="(none)" onChange={(e) => setCustom({ ...custom, first: e.target.value })} /></label>
          <label className="muted">each line starts <input className="field short" value={custom.prefix} aria-label="Line prefix" onChange={(e) => setCustom({ ...custom, prefix: e.target.value })} /></label>
          <label className="muted">last line <input className="field short" value={custom.last} aria-label="Last line" placeholder="(none)" onChange={(e) => setCustom({ ...custom, last: e.target.value })} /></label>
        </div>
      )}
      <div className="row">
        <span className="row-label" />
        <label><input type="checkbox" checked={ascii} onChange={(e) => setAscii(e.target.checked)} /> ASCII only</label>
        {selection.length > 0 && (
          <label title="Only what's selected (and what's inside selected boxes)">
            <input type="checkbox" checked={onlySelection} onChange={(e) => setOnlySelection(e.target.checked)} aria-label="Selection only" />{" "}
            selection only ({selection.length} selected)
          </label>
        )}
      </div>
      <pre className="preview" data-testid="export-text">{text || "(empty diagram)"}</pre>
      <div className="row buttons">
        <span className="row-label">text</span>
        <button className="tb accent" onClick={() => void copy(text, "the text")} data-testid="copy-text">copy text</button>
        <button className="tb" onClick={() => download(`${file}.${ext}`, text + "\n", "text/plain")}>download .{ext}</button>
      </div>
      <div className="row buttons">
        <span className="row-label">picture</span>
        <span className="row-items" role="group" aria-label="Picture colours">
          {(["light", "dark"] as const).map((t) => (
            <button key={t} className={"choice" + (theme === t ? " active" : "")} aria-pressed={theme === t} onClick={() => setTheme(t)}>{t}</button>
          ))}
          <label className="muted"><input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> transparent</label>
        </span>
      </div>
      <div className="row buttons">
        <span className="row-label" />
        <button className="tb" onClick={() => void copyPng()}>copy picture</button>
        <button className="tb" onClick={() => void png()}>download .png</button>
        <button className="tb" onClick={() => void svg()} title="Scales without blurring; the font is included">download .svg</button>
      </div>
      <div className="row buttons">
        <span className="row-label">diagram</span>
        <button className="tb" onClick={() => downloadDiagram(partial ? `${name || "diagram"} (selection)` : name, diagram)} title="Keeps the boxes and connectors, for importing later">download .json</button>
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
        <dt><Kbd>s</Kbd> or <Kbd>space</Kbd> select</dt><dd>click or drag a rectangle to select (inside a box or frame: hold <Kbd>ctrl</Kbd>/<Kbd>⌘</Kbd> as you start dragging, or it moves the box); drag to move; handles resize; double-click edits text (on a box's top border: its name)</dd>
        <dt>snapping</dt><dd>moving, resizing or drawing a box lines its edges and centre up with neighbouring boxes (beside it for rows, above or below it for columns), with guides. Hold <Kbd>alt</Kbd>, or press <Kbd>ctrl</Kbd> once dragging, to place it freely, or turn "snap" off in the toolbar</dd>
        <dt>properties panel</dt><dd>shows what's selected; click its title bar to collapse it (remembered). On a narrow screen it's a sheet along the bottom, and the drawing scrolls to keep the selection above it</dd>
        <dt>locking</dt><dd>select several things, right-click → Lock Together ▸ Horizontally (they move left–right together), Vertically (up–down) or Both. What a selected item is locked to shows with a dotted outline; Unlock (menu or properties panel) undoes it, and <Kbd>alt</Kbd>+drag moves one alone. Dragging, nudging, Align, Distribute and Auto Layout all bring lock-mates along; Auto Layout keeps boxes locked both ways together as one unit</dd>
        <dt>sequence diagrams</dt><dd>moving a lifeline up or down moves its header; messages and activation bars keep their rows. Loop/alt frames stretch with the lifelines at their edges. Notes drawn from text beside (or over) one lifeline are locked left–right to it</dd>
        <dt>boxes in boxes</dt><dd>a box entirely inside another is part of it: it's drawn in front, and moves when the outer box moves. <Kbd>alt</Kbd>+drag moves just the outer box; or set "inside: stays put" on the box</dd>
        <dt><Kbd>b</Kbd> box</dt><dd>drag corner to corner, or click empty space for a default box; then type. Pick the shape under the toolbar: box; flowchart decision, input/output, start/end, database, document or subroutine; a note; or for sequence diagrams, a lifeline or an activation bar (draw one on a lifeline and it centres on the line). Draw messages between lifelines and activation bars with the arrow tool: they stay horizontal.
         Clicking an existing box selects it (and switches to select); dragging from inside a box draws one inside it</dd>
        <dt><Kbd>a</Kbd> arrow, <Kbd>l</Kbd> line</dt><dd>drag from one box to another. Start or end inside a box to attach to whichever side faces; on a border (or just outside it) to pin that spot. Hold <Kbd>alt</Kbd> to leave an end free. Clicking (not dragging) a box or connector selects it and switches to select</dd>
        <dt><Kbd>t</Kbd> text</dt><dd>click empty space to type a label without a border (double-click empty space does the same). Clicking a box or connector selects it and switches to select; <Kbd>alt</Kbd>+click places a label there instead, e.g. inside a box</dd>
        <dt>connector ends</dt><dd>select a connector, then drag an end handle onto or off a box to attach or detach it</dd>
        <dt>bends</dt><dd>select a connector, then drag its line to add a bend point there; drag a bend point (square) to move it, double-click it to remove it. "Straighten" removes them all</dd>
        <dt>labels</dt><dd>double-click a connector (or select it and press <Kbd>enter</Kbd>) to label it; <Kbd>shift+enter</Kbd> starts a new line (lists work too); drag a label to move it along its connector</dd>
        <dt><Kbd>enter</Kbd></dt><dd>edit the selected box's text; <Kbd>esc</Kbd> or click outside to finish</dd>
        <dt><Kbd>delete</Kbd>, arrows</dt><dd>delete or nudge the selection (<Kbd>shift</Kbd>: by 5)</dd>
        <dt>from text</dt><dd>draw a message sequence, graph or folder tree from text (toolbar "from text", or right-click empty space). Accepts Mermaid (<code>sequenceDiagram</code>: <code>A-&gt;&gt;B: msg</code>, <code>--&gt;&gt;</code> replies, <code>+</code>/<code>-</code> activation, <code>Note right of A: …</code>, <code>loop</code>/<code>alt</code>/<code>else</code>/<code>end</code>; <code>flowchart TD</code>/<code>LR</code>: <code>{"A[box] -->|label| B{decision}"}</code>, <code>([start])</code>, <code>[(database)]</code>, <code>[[subroutine]]</code>, <code>[/in-out/]</code>, <code>subgraph … end</code>), a shorthand (<code>Client -&gt; API: GET /x</code>, <code>A -&gt; B -&gt; C</code>), and folder trees (<code>tree</code> output, indented names or paths). Graphs (and folder trees drawn as boxes) can be laid out top to bottom (TB) or left to right (LR): in the dialog, in the text (<code>flowchart TB</code> / <code>flowchart LR</code>), or afterwards with "layout" in the properties panel or right-click → Layout. Their connectors follow the flow (out of the bottom and into the top, or out of the right and into the left) however you drag the boxes, unless a target ends up behind its source. It stays linked: select it and "edit text" to change the text and redraw; things you've moved, resized or restyled stay put. "Unlink" makes it ordinary objects. Something you drew by hand can be edited as text too: select it and choose "Edit as Text…". Multi-line text (and lists) in a node: <code>A["line one&lt;br&gt;- item"]</code>, or a markdown string spanning lines: <code>A["`Todo:</code> … <code>- item`"]</code></dd>
        <dt>lists</dt><dd>in a box, lines starting <code>- </code>, <code>* </code> or <code>1. </code> become bullet and numbered lists; indent to nest</dd>
        <dt>export</dt><dd>copy or download the drawing as text: plain, a Markdown code block, or a comment block for source code (C/C++ <code>//</code> or <code>/* */</code>, Python or Bash <code>#</code>, or your own first line, line prefix and last line), optionally ASCII only. Or as a picture: PNG (download or copy) or SVG (font included), light or dark, optionally transparent. Also as JSON (to import later) or a share link. With something selected, all of these can be just the selection</dd>
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
