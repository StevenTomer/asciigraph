import { useEffect, useMemo, useRef, useState } from "react";
import { type ImageTheme, exportPng, exportSvg, fontBase64 } from "../export/image";
import { type Wrap, WRAPS, exportText, subset, tablesMarkdown } from "../export/text";
import { withContents } from "../model/containment";
import { readJson, writeJson } from "../storage/local";
import { forgetHistory, newDiagram, renameCurrent, repo } from "../editor/session";
import { apply, useEditor } from "../editor/store";
import { narrowerLayouts, textWidth } from "../export/width";
import { setDirection } from "../text/sync";
import type { DiagramMeta } from "../storage/repository";
import { download, downloadDiagram, readDiagramFile, safeFilename } from "../storage/file";
import { shareUrl } from "../storage/share";
import { FORMATS } from "../storage/diskFile";
import { canWriteFiles, forgetFile, openFile, resolveConflict, saveFile, saveFileAs } from "../editor/file";
import { Kbd } from "./Toolbar";

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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
    maxWidth?: number;
  }>("export", {});
  const [maxWidth, setMaxWidth] = useState<number | undefined>(saved.maxWidth);
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
  useEffect(() => writeJson("export", { ascii, kind, ...custom, theme, transparent, maxWidth }), [ascii, kind, custom, theme, transparent, maxWidth]);
  const tables = useMemo(() => tablesMarkdown(diagram), [diagram]);
  const width = textWidth(text);
  const over = maxWidth !== undefined && width > maxWidth;
  // Too wide: a left-to-right graph in it might fit top to bottom.
  const narrower = useMemo(() => (over ? narrowerLayouts(whole, { ascii, wrap }, partial ? withContents(whole, selection) : undefined) : []), [over, whole, ascii, JSON.stringify(wrap), partial, selection]);
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
      <div className="row">
        <span className="row-label">width</span>
        <span className={over ? "error" : "muted"} data-testid="export-width">{width} columns{over ? `: ${width - maxWidth!} over the limit` : ""}</span>
        <label className="muted">
          limit{" "}
          <input
            className="field short" type="number" min={10} max={1000} value={maxWidth ?? ""} placeholder="none" aria-label="Width limit"
            onChange={(e) => setMaxWidth(e.target.value ? Math.max(1, Number(e.target.value)) : undefined)}
          />
        </label>
        {narrower.map((n) => (
          <button key={n.source} className="tb" onClick={() => apply((d) => setDirection(d, n.source, "down").diagram)} title="Lay the graph out top to bottom instead">
            lay out top to bottom: {n.width} columns
          </button>
        ))}
      </div>
      <div className="row buttons">
        <span className="row-label">text</span>
        <button className="tb accent" onClick={() => void copy(text, "the text")} data-testid="copy-text">copy text</button>
        <button className="tb" onClick={() => download(`${file}.${ext}`, text + "\n", "text/plain")}>download .{ext}</button>
      </div>
      {tables && (
        <div className="row buttons">
          <span className="row-label">tables</span>
          <button className="tb" onClick={() => void copy(tables, "the tables as Markdown")} title="As Markdown tables for a document: titles in bold, line breaks as <br>">copy as Markdown</button>
          <button className="tb" onClick={() => download(`${file}-tables.md`, tables + "\n", "text/markdown")}>download .md</button>
        </div>
      )}
      <div className="row buttons">
        <span className="row-label">picture</span>
        <span className="row-items" role="group" aria-label="Picture colors">
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
        <button className="tb" onClick={() => void openFile().then(onClose)} title="A .md, .txt or .json file: opened as a diagram kept in that file (Ctrl+O)">open file…</button>
        <button className="tb" onClick={() => fileRef.current?.click()} title="A copy of a downloaded .json diagram, not kept in the file">import .json</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
      </div>
      <FileRows onDone={onClose} />
      {error && <p className="note error" role="alert">{error}</p>}
      <p className="note muted">
        Diagrams are saved in this browser as you work. To keep one in a file too, save it as a file: a <b>.md</b> file
        holds the drawing in a <code>```text</code> block (and the diagram itself, hidden, so it opens again exactly),
        leaving the rest of the file as it is; a <b>.txt</b> file is just the drawing.
        {!canWriteFiles() && " This browser can't write to files, so saving downloads the file instead."}
      </p>
    </Dialog>
  );
}

/** The file the open diagram is kept in: save to it, save as another, or stop keeping it there. */
function FileRows({ onDone }: { onDone: () => void }) {
  const file = useEditor((s) => s.file);
  const unsaved = useEditor((s) => !!s.file && s.file.saved !== s.diagram);
  const verb = canWriteFiles() ? "save" : "download";
  return (
    <>
      {file && (
        <div className="row buttons">
          <span className="row-label">file</span>
          <span className="row-text">{file.name}{unsaved ? " (changed)" : ""}</span>
          <button className="tb accent" onClick={() => void saveFile().then(onDone)} title="Ctrl+S">{verb}</button>
          <button className="tb" onClick={forgetFile} title="Stop keeping this diagram in the file (the file stays as it is)">forget file</button>
        </div>
      )}
      <div className="row buttons">
        <span className="row-label">{verb} as</span>
        {FORMATS.map((f) => (
          <button key={f.format} className="tb" onClick={() => void saveFileAs(f.format).then(onDone)} title={`Keep this diagram in a ${f.label} file${f.format === "markdown" ? " (pick an existing one to add the drawing to it)" : ""}`}>
            {f.ext}
          </button>
        ))}
      </div>
    </>
  );
}

/** The diagram's file changed on disk since it was opened or saved here. */
export function FileConflictDialog() {
  const conflict = useEditor((s) => s.fileConflict);
  const file = useEditor((s) => s.file);
  if (!conflict) return null;
  return (
    <Dialog title="changed on disk" onClose={() => void resolveConflict("cancel")}>
      <p>The drawing in <b>{file?.name}</b> has changed since it was opened or saved here (in another editor, or another tab).</p>
      <div className="row buttons">
        <button className="tb accent" onClick={() => void resolveConflict("overwrite")}>save over it</button>
        <button className="tb" onClick={() => void resolveConflict("load")} title="Replace this drawing with the file's (undo comes back)">load the file's</button>
        <button className="tb" onClick={() => void resolveConflict("cancel")}>cancel</button>
      </div>
    </Dialog>
  );
}

/** A short message (opened, saved, couldn't save). */
export function Notice() {
  const notice = useEditor((s) => s.notice);
  if (!notice) return null;
  return <div className="notice" role="status">{notice}</div>;
}

// ---------------------------------------------------------------------------------------------

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="help" onClose={onClose}>
      <p>Draw boxes, type in them, and connect them. Connectors attached to a box follow it when it moves. Export the result as plain text.</p>
      <p>Drawing tools stay on, so you can draw several boxes or connectors in a row; <Kbd>space</Kbd>, <Kbd>esc</Kbd> or <Kbd>s</Kbd> goes back to select.</p>
      <dl className="help">
        <dt><Kbd>s</Kbd> or <Kbd>space</Kbd> select</dt><dd>click or drag a rectangle to select (inside a box or frame: hold <Kbd>ctrl</Kbd>/<Kbd>⌘</Kbd> as you start dragging, or it moves the box); drag to move; handles resize; double-click edits text (on a box's top border: its name)</dd>
        <dt>snapping</dt><dd>moving, resizing or drawing a box lines its edges and center up with neighboring boxes (beside it for rows, above or below it for columns), with guides. Hold <Kbd>alt</Kbd>, or press <Kbd>ctrl</Kbd> once dragging, to place it freely, or turn "snap" off in the toolbar</dd>
        <dt>properties panel</dt><dd>shows what's selected; click its title bar to collapse it (remembered). On a narrow screen it's a sheet along the bottom, and the drawing scrolls to keep the selection above it</dd>
        <dt>locking</dt><dd>select several things, right-click → Lock Together ▸ Horizontally (they move left–right together), Vertically (up–down) or Both. What a selected item is locked to shows with a dotted outline; Unlock (menu or properties panel) undoes it, and <Kbd>alt</Kbd>+drag moves one alone. Dragging, nudging, Align, Distribute and Auto Layout all bring lock-mates along; Auto Layout keeps boxes locked both ways together as one unit</dd>
        <dt>sequence diagrams</dt><dd>moving a lifeline up or down moves its header; messages and activation bars keep their rows. Loop/alt frames stretch with the lifelines at their edges. Notes drawn from text beside (or over) one lifeline are locked left–right to it</dd>
        <dt>boxes in boxes</dt><dd>a box entirely inside another is part of it: it's drawn in front, and moves when the outer box moves. <Kbd>alt</Kbd>+drag moves just the outer box; or set "inside: stays put" on the box</dd>
        <dt><Kbd>b</Kbd> box</dt><dd>drag corner to corner, or click empty space for a default box; then type. Click away when done to go back to select, or press <Kbd>esc</Kbd> to stay in box mode and draw another. Pick the shape under the toolbar: box; flowchart decision, input/output, start/end, database, document or subroutine; a note; or for sequence diagrams, a lifeline or an activation bar (draw one on a lifeline and it centers on the line). Draw messages between lifelines and activation bars with the arrow tool: they stay horizontal.
         Clicking an existing box selects it (and switches to select); dragging from inside a box draws one inside it</dd>
        <dt><Kbd>a</Kbd> arrow, <Kbd>l</Kbd> line</dt><dd>drag from one box to another. Start or end inside a box to attach to whichever side faces; on a border (or just outside it) to pin that spot. Hold <Kbd>alt</Kbd> to leave an end free. Afterwards it's back to select, with the new connector selected. Clicking (not dragging) switches to select too: on a box or connector, selecting it</dd>
        <dt><Kbd>t</Kbd> text</dt><dd>click empty space to type a label without a border (double-click empty space does the same); click away when done to go back to select. Clicking a box or connector selects it and switches to select; <Kbd>alt</Kbd>+click places a label there instead, e.g. inside a box</dd>
        <dt>connector ends</dt><dd>select a connector, then drag an end handle onto or off a box to attach or detach it. Each end can have a head (properties panel "start"/"end", or right-click → Start Head / End Head): arrow ►, hollow arrow ▷, diamond ◆, hollow diamond ◊, dot ●, circle ○, cross ×, bar ┤, or none. Reverse Direction moves the heads to the other ends</dd>
        <dt>where it turns</dt><dd>a connector that steps across (<code>─┐</code> … <code>└─</code>) turns halfway between its ends, or nearer the end when its label needs the room. Select it and drag the middle stretch to turn somewhere else; it keeps that fraction of the way as boxes move. "halfway" in the properties panel (or right-click → Reset Turn) puts it back</dd>
        <dt>bends</dt><dd>select a connector, then drag its line to add a bend point there; drag a bend point (square) to move it, double-click it to remove it. "Straighten" removes them all</dd>
        <dt>tables</dt><dd>the <b>table</b> tool (<kbd>E</kbd>): pick columns × rows, click to place, and type in the cells (<kbd>Tab</kbd>: next cell, in the last one a new row; double-click a cell to type in it). Click a cell, then in the panel or the right-click menu add, move or delete its row or column, or line its column up. Or type a Markdown table (<code>| a | b |</code>, then <code>|---|---|</code>, then rows; <code>--:</code> right-aligns a column), or paste one: it's drawn as a grid and grows as you type. A line before the table is its title (in its own row, or in the top border: properties panel). A row carries on over lines until one ends with <code>|</code>, for a cell on several lines (<code>&lt;br&gt;</code> works too). Drag a line between columns to set the width of the one on its left (double-click it: back to its text's width), or type widths in the panel; <b>auto-size</b> fits them all to their text. Text too long for its column wraps, or is cut off with …. <b>copy table</b> (panel) or export → tables writes Markdown, line breaks as <code>&lt;br&gt;</code></dd>
        <dt>end labels</dt><dd>short text by each end of a connector (1, 0..*, a role): select it and fill in "end labels" in the properties panel</dd>
        <dt>labels</dt><dd>double-click a connector (or select it and press <Kbd>enter</Kbd>) to label it; <Kbd>shift+enter</Kbd> starts a new line (lists work too); drag a label to move it along its connector</dd>
        <dt><Kbd>enter</Kbd> or <Kbd>F2</Kbd></dt><dd>edit the selected box's text (or connector's label); <Kbd>esc</Kbd> or click outside to finish</dd>
        <dt><Kbd>delete</Kbd>, arrows</dt><dd>delete or nudge the selection (<Kbd>shift</Kbd>: by 5)</dd>
        <dt>from text</dt><dd>draw a message sequence, graph or folder tree from text (toolbar "from text", or right-click empty space). Accepts Mermaid (<code>sequenceDiagram</code>: <code>A-&gt;&gt;B: msg</code>, <code>--&gt;&gt;</code> replies, <code>-x</code> lost (×), <code>-)</code> async (▷), <code>+</code>/<code>-</code> activation, <code>Note right of A: …</code>, <code>loop</code>/<code>alt</code>/<code>else</code>/<code>end</code>; <code>flowchart TD</code>/<code>LR</code>: <code>{"A[box] -->|label| B{decision}"}</code>, <code>--x</code> / <code>--o</code> ends, <code>([start])</code>, <code>[(database)]</code>, <code>[[subroutine]]</code>, <code>[/in-out/]</code>, <code>subgraph … end</code>; <code>stateDiagram-v2</code>: <code>[*] --&gt; A</code>, <code>A --&gt; B : label</code>, <code>state X {"{ … }"}</code>, <code>&lt;&lt;choice&gt;&gt;</code>; <code>classDiagram</code>: members in compartments, <code>&lt;|--</code> <code>*--</code> <code>o--</code> <code>..&gt;</code> <code>..|&gt;</code>; <code>erDiagram</code>: <code>||--o{"{"}</code> ends shown as end labels <code>1</code> … <code>0..*</code>, attribute blocks), Graphviz DOT (<code>digraph {"{ a -> b [label=x] }"}</code>, clusters, shapes, <code>rankdir=LR</code>), PlantUML sequence and class diagrams (<code>@startuml</code> … <code>@enduml</code>), a shorthand (<code>Client -&gt; API: GET /x</code>, <code>A -&gt; B -&gt; C</code>), and folder trees (<code>tree</code> output, indented names or paths). Graphs (and folder trees drawn as boxes) can be laid out top to bottom (TB) or left to right (LR): in the dialog, in the text (<code>flowchart TB</code> / <code>flowchart LR</code>), or afterwards with "layout" in the properties panel or right-click → Layout. Their connectors follow the flow (out of the bottom and into the top, or out of the right and into the left) however you drag the boxes, unless a target ends up behind its source. It stays linked: select it and "edit text" to change the text and redraw; things you've moved, resized or restyled stay put. "Unlink" makes it ordinary objects. Something you drew by hand can be edited as text too: select it and choose "Edit as Text…". Multi-line text (and lists) in a node: <code>A["line one&lt;br&gt;- item"]</code>, or a markdown string spanning lines: <code>A["`Todo:</code> … <code>- item`"]</code>. Mermaid's own documentation: <a href="https://mermaid.js.org/syntax/sequenceDiagram.html" target="_blank" rel="noopener">sequence diagrams</a>, <a href="https://mermaid.js.org/syntax/flowchart.html" target="_blank" rel="noopener">flowcharts</a>, <a href="https://mermaid.js.org/syntax/stateDiagram.html" target="_blank" rel="noopener">state</a>, <a href="https://mermaid.js.org/syntax/classDiagram.html" target="_blank" rel="noopener">class</a> and <a href="https://mermaid.js.org/syntax/entityRelationshipDiagram.html" target="_blank" rel="noopener">ER diagrams</a> (asciigraph draws the parts listed here).</dd>
        <dt><Kbd>ctrl+f</Kbd> find</dt><dd>search the text of boxes and connectors; Enter for the next match, Shift+Enter the one before, "all" to select every match</dd>
        <dt>stamps</dt><dd>select some objects, right-click → Save as Stamp… to keep them; "stamps" in the toolbar inserts one (in the middle of the screen, selected) into any diagram. Kept in this browser; "export all" / "import" move them as a file</dd>
        <dt>lists</dt><dd>in a box, lines starting <code>- </code>, <code>* </code> or <code>1. </code> become bullet and numbered lists; indent to nest. To keep a line as typed, put a backslash before the marker (<code>\- not a list</code>); to keep all of a box's text as typed, set "lists: off" in the properties panel</dd>
        <dt>offline</dt><dd>once it has loaded, asciigraph works without a connection (everything happens in the browser). Install it as an app for its own window: <b>install</b> in the toolbar, or the install icon in Chrome or Edge's address bar; Safari: File → Add to Dock, or on a phone Share → Add to Home Screen. Installed in Chrome or Edge, it can open .md and .txt files from your desktop (Open With)</dd>
        <dt>files</dt><dd>keep a diagram in a file too: <b>open file…</b> (<Kbd>Ctrl</Kbd>+<Kbd>O</Kbd>) a .md, .txt or .json file, or save as one from the diagrams dialog (the diagram's name); then <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd> saves to it (its name in the toolbar shows • when there are unsaved changes). A .md file keeps the drawing in a <code>```text</code> block and the diagram itself hidden after it, so it opens again exactly; the rest of the file is left as it is. Chrome and Edge write to the file; other browsers download it</dd>
        <dt>export</dt><dd>copy or download the drawing as text: plain, a Markdown code block, or a comment block for source code (C/C++ <code>//</code> or <code>/* */</code>, Python or Bash <code>#</code>, or your own first line, line prefix and last line), optionally ASCII only. Or as a picture: PNG (download or copy) or SVG (font included), light or dark, optionally transparent. Also as JSON (to import later) or a share link. With something selected, all of these can be just the selection</dd>
        <dt>right-click</dt><dd>menu for what's under the pointer: edit, cut/copy/paste/duplicate, stacking order, and with several boxes selected, Align, Distribute and Auto Layout (arranges boxes in layers following their connectors; on empty space it lays out the whole diagram)</dd>
        <dt>sizes</dt><dd>right-click (or the properties panel): Shrink to Text makes boxes the smallest size that shows their text unwrapped (boxes with boxes inside are left alone); with several selected, Normalize Size makes them all as wide and/or tall as the largest</dd>
        <dt><Kbd>ctrl+]</Kbd> / <Kbd>ctrl+[</Kbd></dt><dd>bring forward / send backward (with <Kbd>shift</Kbd>: to front / to back)</dd>
        <dt><Kbd>ctrl+d</Kbd></dt><dd>duplicate</dd>
        <dt><Kbd>ctrl+z</Kbd> / <Kbd>ctrl+shift+z</Kbd></dt><dd>undo / redo</dd>
        <dt><Kbd>ctrl+c</Kbd> <Kbd>ctrl+x</Kbd> <Kbd>ctrl+v</Kbd></dt><dd>copy, cut, paste (copies as text for other apps too). Pasting a drawing made of box characters or <code>+--+</code> ASCII (from a README, a comment…) turns it into boxes and connectors you can move</dd>
        <dt>scroll, <Kbd>space</Kbd>+drag, middle-drag</dt><dd>pan; <Kbd>ctrl</Kbd>+scroll or pinch to zoom</dd>
        <dt><Kbd>ctrl+=</Kbd> / <Kbd>ctrl+-</Kbd> / <Kbd>ctrl+0</Kbd> / <Kbd>shift+1</Kbd> / <Kbd>shift+2</Kbd></dt><dd>zoom in / out / back to 100% / to fit the drawing / to the selection (also the buttons at bottom right)</dd>
      </dl>
      <p className="muted">Text rendering, input handling and fonts are adapted from <a href="https://github.com/lewish/asciiflow" target="_blank" rel="noopener">ASCIIFlow</a> by Lewis Hemens (MIT).</p>
    </Dialog>
  );
}
