import { useEffect, useMemo, useRef, useState } from "react";
import { insertCentered, selectedPart } from "../editor/clipboard";
import { apply, closeStampsDialog, getState, useEditor } from "../editor/store";
import { addNode, emptyDiagram, makeNode, updateNode } from "../model/ops";
import { diagramToText } from "../render/rasterize";
import { download } from "../storage/file";
import { STAMP_SETS } from "../storage/stampSets";
import { type Stamp, deleteStamp, exportStamps, importStamps, listStamps, renameStamp, saveStamp, suggestName } from "../storage/stamps";
import { Dialog } from "./Dialogs";

/**
 * Stamps: groups of objects to insert. Your own (saved from the right-click menu with something
 * selected), ready-made sets, and banner text. Opened from the toolbar.
 */
export function StampsDialog() {
  const dialog = useEditor((s) => s.stampsDialog);
  if (!dialog) return null;
  if (dialog.banner) return <Dialog title="banner text" onClose={closeStampsDialog}><BannerPane id={dialog.banner} /></Dialog>;
  return <Body save={dialog.save} tab0={dialog.tab} />;
}

const TABS = [{ id: "yours", label: "yours" }, ...STAMP_SETS.map((s) => ({ id: s.id, label: s.label })), { id: "banner", label: "banner text" }];

function Body({ save, tab0 }: { save: string[] | null; tab0?: string }) {
  const [list, setList] = useState<Stamp[]>(listStamps);
  const refresh = () => setList(listStamps());
  const part = useMemo(() => (save ? selectedPart(save) : null), [save]);
  const [name, setName] = useState(() => (part ? suggestName(part) : ""));
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState(() => tab0 ?? (list.length ? "yours" : STAMP_SETS[0].id));
  const set = STAMP_SETS.find((x) => x.id === tab);
  const ready = useMemo(() => set?.stamps() ?? [], [set]);

  const insert = (s: Stamp) => {
    insertCentered(s.diagram);
    closeStampsDialog();
  };
  const saveIt = () => {
    if (!part) return;
    saveStamp(name, part);
    refresh();
    closeStampsDialog();
  };
  const importFile = async (file: File) => {
    try {
      const n = importStamps(await file.text());
      refresh();
      setNote(`Added ${n} stamp${n === 1 ? "" : "s"}.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog title={part ? "save as stamp" : "stamps"} onClose={closeStampsDialog}>
      {part && (
        <>
          <pre className="stamp-preview large" aria-label="Stamp preview">{diagramToText(part)}</pre>
          <div className="row">
            <span className="row-label">name</span>
            <input
              className="field grow"
              value={name}
              aria-label="Stamp name"
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveIt()}
            />
            <button className="tb accent" onClick={saveIt}>save</button>
          </div>
          <p className="note muted">Saved in this browser, to insert into any diagram from <b>stamps</b> in the toolbar.</p>
        </>
      )}
      {!part && (
        <div className="row tabs" role="tablist" aria-label="Stamp sets">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={"choice" + (tab === t.id ? " active" : "")} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {!part && tab === "banner" && <BannerPane id={null} />}
      {!part && set && (
        <ul className="stamp-list ready">
          {ready.map((s) => (
            <li key={s.name}>
              <button className="stamp-insert" onClick={() => { insertCentered(s.diagram); closeStampsDialog(); }} title={`Insert ${s.name}`} aria-label={`Insert ${s.name}`}>
                <pre className="stamp-preview">{diagramToText(s.diagram)}</pre>
              </button>
              <div className="stamp-row">
                <span className="grow stamp-name">{s.name}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {!part && tab === "yours" && (
        <>
          {list.length === 0 && (
            <p className="note muted">
              None of your own yet. Select some objects, right-click and choose <b>Save as Stamp…</b> to insert them again later, in any diagram. The other tabs have ready-made ones.
            </p>
          )}
          <ul className="stamp-list">
            {list.map((s) => (
              <li key={s.id}>
                <button className="stamp-insert" onClick={() => insert(s)} title={`Insert ${s.name}`} aria-label={`Insert ${s.name}`}>
                  <pre className="stamp-preview">{diagramToText(s.diagram)}</pre>
                </button>
                <div className="stamp-row">
                  {renaming?.id === s.id ? (
                    <input
                      className="field grow"
                      value={renaming.name}
                      aria-label="Stamp name"
                      autoFocus
                      onChange={(e) => setRenaming({ id: s.id, name: e.target.value })}
                      onBlur={() => {
                        renameStamp(s.id, renaming.name);
                        setRenaming(null);
                        refresh();
                      }}
                      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                    />
                  ) : (
                    <span className="grow stamp-name">{s.name}</span>
                  )}
                  <button className="tb" onClick={() => insert(s)}>insert</button>
                  <button className="tb" onClick={() => setRenaming({ id: s.id, name: s.name })} aria-label={`Rename ${s.name}`}>rename</button>
                  {confirming === s.id ? (
                    <>
                      <button className="tb danger" onClick={() => { deleteStamp(s.id); setConfirming(null); refresh(); }}>delete it</button>
                      <button className="tb" onClick={() => setConfirming(null)}>keep</button>
                    </>
                  ) : (
                    <button className="tb" onClick={() => setConfirming(s.id)} aria-label={`Delete ${s.name}`}>delete</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="row buttons">
            <button className="tb" onClick={() => download("asciigraph-stamps.json", exportStamps(), "application/json")} disabled={!list.length}>
              export all
            </button>
            <button className="tb" onClick={() => fileRef.current?.click()}>import</button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
          </div>
          {note && <p className="note muted" role="status">{note}</p>}
          <p className="note muted">Stamps are saved in this browser. <b>export all</b> makes a file to import them elsewhere, or to share.</p>
        </>
      )}
    </Dialog>
  );
}

/** Banner text: words in big lettering, as a text label (a new one, or changing banner `id`). The
 * fonts load with this. */
function BannerPane({ id }: { id: string | null }) {
  const node = id ? getState().diagram.nodes[id] : undefined;
  const [text, setText] = useState(node?.banner?.text ?? "");
  const [font, setFont] = useState(node?.banner?.font ?? "standard");
  const [mod, setMod] = useState<typeof import("../text/banner") | null>(null);
  useEffect(() => {
    void import("../text/banner").then(setMod);
  }, []);
  const art = mod && text.trim() ? mod.bannerArt(text, font) : "";

  const done = () => {
    if (!art) return;
    const lines = art.split("\n");
    const size = { w: Math.max(...lines.map((l) => Array.from(l).length)), h: lines.length };
    const fields = { text: art, banner: { text: text.trim(), font }, autosize: true };
    if (node) {
      apply((d) => (d.nodes[node.id] ? updateNode(d, node.id, { ...fields, rect: { ...d.nodes[node.id].rect, ...size } }) : d));
    } else {
      const n = makeNode({ x: 0, y: 0, ...size }, { border: "none", align: { h: "left", v: "top" }, lists: false, ...fields });
      insertCentered(addNode(emptyDiagram(), n));
    }
    closeStampsDialog();
  };

  return (
    <>
      <div className="row">
        <span className="row-label">text</span>
        <textarea
          className="field grow"
          rows={2}
          value={text}
          autoFocus
          aria-label="Banner text"
          placeholder="Words to show big (a line each)"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && done()}
        />
      </div>
      <div className="row">
        <span className="row-label">font</span>
        <span className="row-items">
          {(mod?.BANNER_FONTS ?? []).map((f) => (
            <button key={f.id} className={"choice" + (font === f.id ? " active" : "")} aria-pressed={font === f.id} onClick={() => setFont(f.id)}>
              {f.label}
            </button>
          ))}
        </span>
      </div>
      <pre className="stamp-preview large banner-preview" aria-label="Banner preview">{art || " "}</pre>
      <div className="row buttons">
        <button className="tb accent" onClick={done} disabled={!art} title="Ctrl+Enter">{node ? "update" : "insert"}</button>
      </div>
      <p className="note muted">
        Lettering in <a href="http://www.figlet.org/" target="_blank" rel="noreferrer">FIGlet</a> fonts. It's a text label: move it like one, and double-click it to change the words or the font.
      </p>
    </>
  );
}
