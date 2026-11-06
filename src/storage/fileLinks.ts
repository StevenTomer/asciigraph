/**
 * Which file on disk each diagram is kept in (this browser only): IndexedDB, since a file handle
 * (File System Access API) can be kept there but not in localStorage. Where there are no handles
 * (Firefox, Safari), the file's name and contents are kept, so saving can download it again.
 */

/** The File System Access API's file handle, as far as it's used here. */
export interface FileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  queryPermission?(o: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  isSameEntry?(other: FileHandle): Promise<boolean>;
}

export interface FileLink {
  /** The file itself, where the browser can write to it. */
  handle?: FileHandle;
  name: string;
  /** What the file held when it was last read or written. */
  content: string;
  /** What saving the diagram as it was then would write (to tell later if it's been changed). */
  clean?: string;
}

const DB = "asciigraph-files";
const STORE = "links";

function db(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve) => {
    try {
      const req = fn(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export const getLink = (id: string) => run<FileLink | undefined>("readonly", (s) => s.get(id));
export const putLink = (id: string, link: FileLink) => run("readwrite", (s) => s.put(link, id));
export const removeLink = (id: string) => run("readwrite", (s) => s.delete(id));

/** The diagram already kept in this file, if any. */
export async function diagramForHandle(handle: FileHandle): Promise<string | null> {
  const d = await db();
  if (!d || !handle.isSameEntry) return null;
  const entries = await new Promise<[string, FileLink][]>((resolve) => {
    const out: [string, FileLink][] = [];
    try {
      const req = d.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve(out);
        out.push([String(c.key), c.value as FileLink]);
        c.continue();
      };
      req.onerror = () => resolve(out);
    } catch {
      resolve(out);
    }
  });
  for (const [id, link] of entries) {
    if (link.handle && (await handle.isSameEntry(link.handle).catch(() => false))) return id;
  }
  return null;
}
