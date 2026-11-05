import { useMemo, useRef, useState } from "react";
import { insertCentered, selectedPart } from "../editor/clipboard";
import { closeStampsDialog, useEditor } from "../editor/store";
import { diagramToText } from "../render/rasterize";
import { download } from "../storage/file";
import { type Stamp, deleteStamp, exportStamps, importStamps, listStamps, renameStamp, saveStamp, suggestName } from "../storage/stamps";
import { Dialog } from "./Dialogs";

/**
 * Stamps: groups of objects saved to insert again. Opened from the toolbar (to insert one), or
 * from the right-click menu with something selected (to save it as one).
 */
export function StampsDialog() {
  const dialog = useEditor((s) => s.stampsDialog);
  if (!dialog) return null;
  return <Body save={dialog.save} />;
}

function Body({ save }: { save: string[] | null }) {
  const [list, setList] = useState<Stamp[]>(listStamps);
  const refresh = () => setList(listStamps());
  const part = useMemo(() => (save ? selectedPart(save) : null), [save]);
  const [name, setName] = useState(() => (part ? suggestName(part) : ""));
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

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
        <>
          {list.length === 0 && (
            <p className="note muted">
              No stamps yet. Select some objects, right-click and choose <b>Save as Stamp…</b> to insert them again later, in any diagram.
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
