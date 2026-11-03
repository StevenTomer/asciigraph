import { emptyDiagram, isDiagram, newId } from "../model/ops";
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

// Undo history survives a reload: saved per diagram (this browser only, not part of the
// diagram itself), capped, and kept only for the few most recently edited diagrams.
const HISTORY_STEPS = 50;
const HISTORY_DIAGRAMS = 5;
const historyKey = (id: string) => `asciigraph/history/${id}`;

function saveHistory(id: string, past: Diagram[], future: Diagram[]) {
  const recent = [id, ...readJson<string[]>("history-index", []).filter((x) => x !== id)];
  for (const old of recent.slice(HISTORY_DIAGRAMS)) forgetHistory(old);
  writeJson("history-index", recent.slice(0, HISTORY_DIAGRAMS));
  // If storage is full, keep fewer steps rather than none.
  for (let n = HISTORY_STEPS; n >= 1; n = Math.floor(n / 2)) {
    try {
      localStorage.setItem(historyKey(id), JSON.stringify({ past: past.slice(-n), future: future.slice(0, n) }));
      return;
    } catch {
      // try smaller
    }
  }
}

function loadHistory(id: string): { past: Diagram[]; future: Diagram[] } | undefined {
  try {
    const h = JSON.parse(localStorage.getItem(historyKey(id)) ?? "null");
    if (h && Array.isArray(h.past) && Array.isArray(h.future) && [...h.past, ...h.future].every(isDiagram)) return h;
  } catch {
    // unreadable: start without history
  }
  return undefined;
}

export function forgetHistory(id: string) {
  try {
    localStorage.removeItem(historyKey(id));
  } catch {
    // ignore
  }
}

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
      load(d, id, meta?.name ?? "Untitled", loadHistory(id));
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
    const { diagramId, diagramName, diagram, past, future, pending } = getState();
    if (!diagramId) return;
    void repo.save(diagramId, diagramName, diagram);
    if (!pending) saveHistory(diagramId, past, future);
  };
  const unsub = useEditor.subscribe((s, prev) => {
    const changed = s.diagram !== prev.diagram || s.past !== prev.past || s.future !== prev.future;
    if (changed && s.diagramId && s.diagramId === prev.diagramId) {
      clearTimeout(timer);
      timer = setTimeout(flush, AUTOSAVE_MS);
    }
    if (s.dark !== prev.dark || s.grid !== prev.grid || s.snap !== prev.snap) writeJson("prefs", { dark: s.dark, grid: s.grid, snap: s.snap });
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
  const prefs = readJson<{ dark?: boolean; grid?: boolean; snap?: boolean }>("prefs", { dark: prefersDark, grid: true });
  setPrefs({ dark: !!prefs.dark, grid: prefs.grid !== false, snap: prefs.snap !== false });
}
