import type { Diagram } from "../model/types";
import { FORMATS, type FileFormat, drawingPart, formatOf, readFile, writeFile } from "../storage/diskFile";
import { type FileHandle, type FileLink, diagramForHandle, getLink, putLink, removeLink } from "../storage/fileLinks";
import { download, safeFilename } from "../storage/file";
import { writeJson } from "../storage/local";
import { forgetHistory, newDiagram, repo } from "./session";
import { apply, getState, load, useEditor } from "./store";

/**
 * Keeping a diagram in a file on disk: open one, save back to it (Ctrl+S), or save as a new one.
 * Where the browser can write files (the File System Access API: Chrome, Edge), saving writes to
 * the file itself; elsewhere opening works the same and saving downloads it again.
 * Formats: storage/diskFile.ts.
 */

type Picker = {
  showOpenFilePicker?(o?: object): Promise<FileHandle[]>;
  showSaveFilePicker?(o?: object): Promise<FileHandle>;
};
const picker = () => window as unknown as Picker;
export const canWriteFiles = () => typeof picker().showSaveFilePicker === "function";

const ACCEPT = { description: "Drawings", accept: { "text/markdown": [".md", ".markdown"], "text/plain": [".txt"], "application/json": [".json"] } };

/** The link for the open diagram, kept here as well as in IndexedDB. */
let current: { id: string; link: FileLink } | null = null;

let noticeTimer: ReturnType<typeof setTimeout> | undefined;
export function notify(message: string | null) {
  clearTimeout(noticeTimer);
  useEditor.setState({ notice: message });
  if (message) noticeTimer = setTimeout(() => useEditor.setState({ notice: null }), 6000);
}

const aborted = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

function linked(id: string, link0: FileLink, saved: Diagram | null) {
  const { diagramName } = getState();
  const link = { ...link0, ...(saved && { clean: writeFile(link0.name, link0.content, saved, diagramName) }) };
  current = { id, link };
  void putLink(id, link);
  useEditor.setState({ file: { name: link.name, saved, writable: !!link.handle }, fileConflict: null });
}

/** A file picked without the File System Access API: an <input type=file>. */
function pickWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.txt,.json,text/markdown,text/plain,application/json";
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Open a file: as a diagram of its own, kept in that file (one already kept there is reused). */
export async function openFile() {
  let handle: FileHandle | undefined;
  let file: File | null;
  try {
    if (picker().showOpenFilePicker) {
      [handle] = await picker().showOpenFilePicker!({ types: [ACCEPT], multiple: false });
      file = await handle.getFile();
    } else {
      file = await pickWithInput();
    }
  } catch (e) {
    if (!aborted(e)) notify(`Couldn't open it: ${e instanceof Error ? e.message : e}`);
    return;
  }
  if (!file) return;
  const content = await file.text();
  let r;
  try {
    r = readFile(file.name, content);
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e));
    return;
  }
  const existing = handle ? await diagramForHandle(handle) : null;
  let id: string;
  if (existing && (await repo.load(existing))) {
    id = existing;
    await repo.save(id, r.name, r.diagram);
    forgetHistory(id);
    load(r.diagram, id, r.name);
    writeJson("last", id);
    location.hash = `#/d/${encodeURIComponent(id)}`;
  } else {
    await newDiagram(r.name, r.diagram);
    id = getState().diagramId!;
  }
  linked(id, { handle, name: file.name, content }, getState().diagram);
  notify(r.note ? `Opened ${file.name}. ${r.note}` : `Opened ${file.name}.`);
}

async function writable(handle: FileHandle): Promise<boolean> {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await handle.requestPermission?.({ mode: "readwrite" })) === "granted";
}

async function write(handle: FileHandle, text: string) {
  const w = await handle.createWritable();
  await w.write(text);
  await w.close();
}

/** Save to the diagram's file (none yet: save as a new Markdown file). `force`: even if the file
 * changed on disk since. */
export async function saveFile(force = false) {
  const { diagramId, diagram, diagramName } = getState();
  if (!diagramId) return;
  if (current?.id !== diagramId) {
    await saveFileAs("markdown");
    return;
  }
  const { link } = current;
  try {
    if (!link.handle) {
      const out = writeFile(link.name, link.content, diagram, diagramName);
      download(link.name, out, FORMATS.find((f) => f.format === formatOf(link.name))!.mime);
      linked(diagramId, { ...link, content: out }, diagram);
      notify(`Downloaded ${link.name}.`);
      return;
    }
    if (!(await writable(link.handle))) {
      notify(`asciigraph wasn't allowed to write to ${link.name}.`);
      return;
    }
    const disk = await (await link.handle.getFile()).text();
    if (!force && drawingPart(link.name, disk) !== drawingPart(link.name, link.content)) {
      useEditor.setState({ fileConflict: { disk } });
      return;
    }
    const out = writeFile(link.name, disk, diagram, diagramName);
    await write(link.handle, out);
    linked(diagramId, { ...link, content: out }, diagram);
    notify(`Saved ${link.name}.`);
  } catch (e) {
    notify(`Couldn't save ${link.name}: ${e instanceof Error ? e.message : e}`);
  }
}

/** Save to a new file (or one picked to add the drawing to, for Markdown), and keep it there. */
export async function saveFileAs(format: FileFormat) {
  const { diagramId, diagram, diagramName } = getState();
  if (!diagramId) return;
  const f = FORMATS.find((x) => x.format === format)!;
  const suggested = safeFilename(diagramName || "diagram") + (format === "json" ? ".asciigraph.json" : f.ext);
  try {
    if (!canWriteFiles()) {
      const out = writeFile(suggested, null, diagram, diagramName);
      download(suggested, out, f.mime);
      linked(diagramId, { name: suggested, content: out }, diagram);
      notify(`Downloaded ${suggested}. Ctrl+S downloads it again.`);
      return;
    }
    const handle = await picker().showSaveFilePicker!({
      suggestedName: suggested,
      types: [{ description: f.label, accept: { [f.mime]: [f.ext] } }],
    });
    // An existing Markdown file keeps what's in it; the drawing goes in (or replaces ours).
    const before = formatOf(handle.name) === "markdown" ? await (await handle.getFile()).text().catch(() => "") : null;
    const out = writeFile(handle.name, before, diagram, diagramName);
    await write(handle, out);
    linked(diagramId, { handle, name: handle.name, content: out }, diagram);
    notify(`Saved ${handle.name}.`);
  } catch (e) {
    if (!aborted(e)) notify(`Couldn't save: ${e instanceof Error ? e.message : e}`);
  }
}

/** The file changed on disk: keep this version (overwrite the drawing there), or load that one
 * (an undoable change), or neither for now. */
export async function resolveConflict(choice: "overwrite" | "load" | "cancel") {
  const conflict = getState().fileConflict;
  useEditor.setState({ fileConflict: null });
  if (!conflict || !current || choice === "cancel") return;
  if (choice === "overwrite") {
    await saveFile(true);
    return;
  }
  const r = readFile(current.link.name, conflict.disk);
  apply(() => r.diagram);
  linked(current.id, { ...current.link, content: conflict.disk }, getState().diagram);
  notify(r.note ? `Loaded ${current.link.name} from disk. ${r.note}` : `Loaded ${current.link.name} from disk (undo goes back).`);
}

/** Stop keeping this diagram in its file (the file is left as it is). */
export function forgetFile() {
  const { diagramId } = getState();
  if (diagramId) void removeLink(diagramId);
  current = null;
  useEditor.setState({ file: null, fileConflict: null });
}

/** After a diagram is opened: the file it's kept in, if any, and whether it has unsaved changes. */
export async function restoreFile(id: string) {
  if (current?.id === id) return; // just linked
  const link = await getLink(id);
  const { diagramId, diagram, diagramName } = getState();
  if (diagramId !== id || current?.id === id) return;
  if (!link) {
    current = null;
    return;
  }
  const same = writeFile(link.name, link.content, diagram, diagramName) === (link.clean ?? link.content);
  current = { id, link };
  useEditor.setState({ file: { name: link.name, saved: same ? diagram : null, writable: !!link.handle } });
}
