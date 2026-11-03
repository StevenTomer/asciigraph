import { emptyDiagram, newId } from "../model/ops";
import type { Diagram } from "../model/types";
import { localRepository, readJson, writeJson } from "../storage/local";
import type { DiagramRepository } from "../storage/repository";
import { decodeShare } from "../storage/share";
import { getState, load, setPrefs, useEditor } from "./store";

/**
 * Which diagram is open, and keeping it saved. URLs: #/d/<id> for a saved diagram, #/share/<data>
 * for a shared one (opened as an unsaved copy until "save a copy").
 */
export const repo: DiagramRepository = localRepository;

const AUTOSAVE_MS = 400;

export async function openFromHash() {
  const hash = location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("share/")) {
    const shared = decodeShare(hash.slice("share/".length));
    if (shared) {
      load(shared.diagram, null, shared.name);
      return;
    }
  }
  const id = hash.startsWith("d/") ? decodeURIComponent(hash.slice(2)) : readJson<string | null>("last", null);
  if (id && id !== getState().diagramId) {
    const d = await repo.load(id);
    if (d) {
      const meta = (await repo.list()).find((m) => m.id === id);
      load(d, id, meta?.name ?? "Untitled");
      writeJson("last", id);
      if (!hash.startsWith("d/")) history.replaceState(null, "", `#/d/${encodeURIComponent(id)}`);
      return;
    }
  }
  if (id && id === getState().diagramId) return;
  // Nothing to open: the most recent diagram, or a new one.
  const recent = (await repo.list())[0];
  if (recent) location.hash = `#/d/${encodeURIComponent(recent.id)}`;
  else await newDiagram();
}

export async function newDiagram(name = "Untitled", diagram: Diagram = emptyDiagram()) {
  const id = newId("n").slice(1);
  await repo.save(id, name, diagram);
  load(diagram, id, name);
  writeJson("last", id);
  location.hash = `#/d/${encodeURIComponent(id)}`;
}

/** Keep a shared diagram: save it as a new diagram of your own. */
export async function saveCopy() {
  const { diagram, diagramName } = getState();
  await newDiagram(diagramName, diagram);
}

export async function renameCurrent(name: string) {
  const { diagramId } = getState();
  useEditor.setState({ diagramName: name });
  if (diagramId) await repo.rename(diagramId, name);
}

/** Save whenever the diagram changes (debounced); remember view preferences. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    const { diagramId, diagramName, diagram } = getState();
    if (diagramId) void repo.save(diagramId, diagramName, diagram);
  };
  const unsub = useEditor.subscribe((s, prev) => {
    if (s.diagram !== prev.diagram && s.diagramId && s.diagramId === prev.diagramId) {
      clearTimeout(timer);
      timer = setTimeout(flush, AUTOSAVE_MS);
    }
    if (s.dark !== prev.dark || s.grid !== prev.grid) writeJson("prefs", { dark: s.dark, grid: s.grid });
  });
  const onHide = () => {
    clearTimeout(timer);
    flush();
  };
  window.addEventListener("pagehide", onHide);
  return () => {
    unsub();
    window.removeEventListener("pagehide", onHide);
  };
}

export function loadPrefs() {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const prefs = readJson("prefs", { dark: prefersDark, grid: true });
  setPrefs({ dark: !!prefs.dark, grid: prefs.grid !== false });
}
