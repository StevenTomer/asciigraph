import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { Diagram, Id } from "../model/types";
import { readJson, writeJson } from "../storage/local";
import { type Peer, getState, load, onLiveHistory, replaceDiagram, useEditor } from "../editor/store";
import { notify } from "../editor/file";
import { applyDiff, diagramName, maps, toDiagram, tracked } from "./bridge";

/**
 * Live diagrams: shared on the server (server/), edited by several people at once.
 *
 * The editor works as always on its own `Diagram`; this keeps it and the shared Yjs document in
 * step:
 *  - out: whenever an edit is finished (no drag or typing under way), what changed since the
 *    diagram was last in step goes to the document (collab/bridge.ts `applyDiff`);
 *  - in: someone else's changes are read back (`toDiagram`) and put in, unless an edit is under
 *    way: then once it's finished (after sending it, so both are kept).
 * Undo and redo are of your own changes only. Who's there (and what they have selected) goes
 * by Yjs awareness.
 *
 * Links: #/live/<id>/<key>. Your name is asked for once and remembered in this browser.
 */

/** Marks our own changes in the document (the undo manager tracks only these). */
const LOCAL = { asciigraph: "local" };

/** People's colors (the app's Nord palette, dark enough to read on light and dark). */
const COLORS = ["#bf616a", "#d08770", "#b58900", "#6a8e3f", "#b48ead", "#5e81ac", "#2e8b8b", "#c45a2d"];
export const colorFor = (name: string) => {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
};

/** URLs next to the page (it may be served from a folder, like /graph/). */
const apiUrl = (path: string) => new URL(`api/${path}`, location.href).toString();
const wsUrl = () => {
  const u = new URL("ws", location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.hash = "";
  return u.toString();
};
export const liveLink = (id: string, key: string) => `${location.origin}${location.pathname}#/live/${id}/${key}`;

export const myName = () => readJson<string>("live-name", "");

interface Session {
  id: string;
  doc: Y.Doc;
  provider: HocuspocusProvider;
  history: Y.UndoManager;
  /** The diagram as last in step with the document (null until it has arrived). */
  synced: Diagram | null;
  /** Someone else's changes came in during an edit: put them in once it's finished. */
  waiting: boolean;
  unsubscribe: () => void;
}
let session: Session | null = null;

/** Whether this server has live diagrams (the static app alone doesn't). */
export async function probeLive() {
  try {
    const res = await fetch(apiUrl("health"), { cache: "no-store" });
    const ok = res.ok && (await res.json())?.ok === true;
    useEditor.setState({ liveAvailable: ok });
  } catch {
    useEditor.setState({ liveAvailable: false });
  }
}

/** Share the open diagram live: it's copied to the server, and opened there. */
export async function shareLive() {
  const { diagram, diagramName: name } = getState();
  const res = await fetch(apiUrl("diagrams"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name || "Untitled", diagram }),
  });
  if (!res.ok) throw new Error(`Couldn't share it (${res.status}).`);
  const { id, editKey, ownerSecret } = (await res.json()) as { id: string; editKey: string; ownerSecret: string };
  // Kept for the owner's controls (to come); only this browser has it.
  writeJson(`live-owner/${id}`, ownerSecret);
  location.hash = `#/live/${id}/${editKey}`;
}

/** Open a live diagram from its link (asking for your name first, the first time). */
export function joinLive(id: string, key: string) {
  if (session?.id === id) return;
  leaveLive();
  const name = myName();
  if (!name) {
    useEditor.setState({ liveAsk: { join: { id, key } } });
    return;
  }
  connect(id, key, name);
}

/** Your name, as others see it (and remembered for next time). */
export function setMyName(name: string) {
  writeJson("live-name", name);
  const live = getState().live;
  if (!live || !session) return;
  const me = { name, color: colorFor(name) };
  useEditor.setState({ live: { ...live, me } });
  session.provider.setAwarenessField("user", me);
}

export function renameLive(name: string) {
  if (session) session.doc.transact(() => maps(session!.doc).meta.set("name", name), LOCAL);
}

export function leaveLive() {
  if (!session) return;
  session.unsubscribe();
  session.history.destroy();
  session.provider.destroy();
  session.doc.destroy();
  session = null;
  onLiveHistory(null);
  useEditor.setState({ live: null });
}

function connect(id: string, key: string, name: string) {
  const doc = new Y.Doc();
  const me = { name, color: colorFor(name) };
  const setLive = (patch: Partial<NonNullable<ReturnType<typeof getState>["live"]>>) => {
    const live = getState().live;
    if (live && session?.id === id) useEditor.setState({ live: { ...live, ...patch } });
  };

  const provider = new HocuspocusProvider({
    url: wsUrl(),
    name: id,
    document: doc,
    token: JSON.stringify({ key, name }),
    onSynced: () => arrived(),
    onStatus: ({ status }) => {
      if (session?.synced) setLive({ status: status === "connected" ? "live" : "offline" });
    },
    onAuthenticationFailed: () => {
      setLive({ status: "denied" });
      notify("This live diagram's link isn't valid (it may have been replaced).");
    },
    onAwarenessChange: ({ states }) => {
      const peers: Peer[] = states
        .filter((s) => s.clientId !== doc.clientID && s.user?.name)
        .map((s) => ({
          clientId: s.clientId,
          name: String(s.user.name),
          color: String(s.user.color ?? colorFor(String(s.user.name))),
          selection: Array.isArray(s.selection) ? (s.selection as Id[]) : [],
        }));
      setLive({ peers });
    },
  });
  provider.setAwarenessField("user", me);

  const history = new Y.UndoManager(tracked(doc), { trackedOrigins: new Set([LOCAL]), captureTimeout: 0 });
  const stacks = () => setLive({ canUndo: history.canUndo(), canRedo: history.canRedo() });
  history.on("stack-item-added", stacks);
  history.on("stack-item-popped", stacks);
  history.on("stack-cleared", stacks);

  session = { id, doc, provider, history, synced: null, waiting: false, unsubscribe: () => {} };
  // Nothing to edit until it has arrived.
  load({ version: 1, nodes: {}, edges: {}, order: [] }, null, "…");
  useEditor.setState({
    live: { id, link: liveLink(id, key), status: "connecting", me, peers: [], canUndo: false, canRedo: false },
  });

  /** Send what changed since the diagram was last in step. */
  const send = () => {
    const s = session!;
    const { diagram } = getState();
    if (!s.synced || diagram === s.synced) return;
    // In step before writing: writing updates the undo buttons (store), which runs this again.
    const before = s.synced;
    s.synced = diagram;
    applyDiff(doc, before, diagram, LOCAL);
  };
  /** Put in the document as it is now (after sending our own finished edit, if any). */
  const receive = () => {
    const s = session!;
    if (getState().pending) {
      s.waiting = true;
      return;
    }
    s.waiting = false;
    send();
    const d = toDiagram(doc);
    s.synced = d;
    replaceDiagram(d);
    const name = diagramName(doc);
    if (name !== getState().diagramName) useEditor.setState({ diagramName: name });
  };

  function arrived() {
    const s = session;
    if (!s || s.id !== id || s.synced) return;
    const d = toDiagram(doc);
    s.synced = d;
    load(d, null, diagramName(doc));
    setLive({ status: "live" });
    doc.on("afterTransaction", (tr) => {
      if (tr.origin !== LOCAL) receive();
    });
    onLiveHistory({
      undo: () => history.undo(),
      redo: () => history.redo(),
    });
    s.unsubscribe = useEditor.subscribe((st, prev) => {
      if (st.pending === null && (st.diagram !== s.synced || s.waiting)) {
        if (s.waiting) receive();
        else send();
      }
      if (st.selection !== prev.selection) provider.setAwarenessField("selection", st.selection);
    });
  }
}
