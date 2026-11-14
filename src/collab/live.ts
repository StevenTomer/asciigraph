import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { Diagram, Id } from "../model/types";
import { readJson, writeJson } from "../storage/local";
import { type LiveState, type Peer, getState, load, onLiveHistory, replaceDiagram, setViewOnly, useEditor } from "../editor/store";
import { notify } from "../editor/file";
import { applyDiff, diagramName, maps, toDiagram, tracked } from "./bridge";
import {
  type OwnerAction, type Role, type ServerMessage, type Stamp,
  DELETED, PASSWORD, REPLACED, WRONG_PASSWORD,
} from "./protocol";

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
 * Links: #/live/<id>/<key>, the key being the edit or view key or the owner's secret
 * (collab/protocol.ts). Your name is asked for once and remembered in this browser, and so are
 * a diagram's password and, in the owner's browser, the owner's secret: the owner's tab shows the
 * edit link in the address bar, not the owner link.
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
const ownerSecret = (id: string) => readJson<string>(`live-owner/${id}`, "");
const password = (id: string) => readJson<string>(`live-pass/${id}`, "");

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
  /** The key in the link opened (it may be the owner's secret). */
  key: string;
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
  session.provider.setAwarenessField("user", { ...me, role: live.role });
}

/** The password for a live diagram, then try again. */
export function givePassword(id: string, key: string, pw: string) {
  writeJson(`live-pass/${id}`, pw);
  leaveLive();
  joinLive(id, key);
}

export function renameLive(name: string) {
  if (session && !getState().live?.readOnly) session.doc.transact(() => maps(session!.doc).meta.set("name", name), LOCAL);
}

/** The owner's controls (the server ignores them from anyone else). */
export function ownerAction(a: OwnerAction) {
  session?.provider.sendStateless(JSON.stringify({ type: "owner", ...a }));
}

/** Stop editing together: the diagram stays shown, with why (a replaced link, deleted). */
function disconnect() {
  if (!session) return;
  session.unsubscribe();
  session.history.destroy();
  session.provider.destroy();
  session.doc.destroy();
  session = null;
  onLiveHistory(null);
}

export function leaveLive() {
  disconnect();
  setViewOnly(false);
  if (getState().live) useEditor.setState({ live: null });
}

function connect(id: string, key: string, name: string) {
  const doc = new Y.Doc();
  const me = { name, color: colorFor(name) };
  const by = doc.getMap<Stamp>("by");
  const byType = by as unknown as Y.AbstractType<any>;
  const setLive = (patch: Partial<LiveState>) => {
    const live = getState().live;
    if (live && session?.id === id) {
      const next = { ...live, ...patch };
      useEditor.setState({ live: next });
      if (next.readOnly !== live.readOnly) setViewOnly(next.readOnly);
    }
  };
  const readOnlyFor = (role: Role | null, diagramReadOnly: boolean) => role === "view" || (role === "edit" && diagramReadOnly);

  /** What the server says: who you are, the settings and links, the history. */
  const told = (m: ServerMessage) => {
    const live = getState().live;
    if (!live) return;
    if (m.type === "hello" || m.type === "settings") {
      const role = m.type === "hello" ? m.role : live.role;
      let keys = live.keys;
      if (role === "owner" && m.keys) {
        // Opened from the owner link: remember the secret here, and show the edit link instead.
        if (!ownerSecret(id) && key !== m.keys.edit && key !== m.keys.view) writeJson(`live-owner/${id}`, key);
        keys = { ...m.keys, owner: ownerSecret(id) };
        if (m.keys.edit && location.hash !== `#/live/${id}/${m.keys.edit}`) {
          window.history.replaceState(null, "", `#/live/${id}/${m.keys.edit}`);
          if (session) session.key = m.keys.edit;
        }
      }
      setLive({
        role,
        settings: m.settings,
        keys,
        readOnly: readOnlyFor(role, m.settings.readOnly),
        ...(role === "owner" && keys?.edit && { link: liveLink(id, keys.edit) }),
        ...(m.type === "hello" && { history: m.history }),
      });
      if (m.type === "hello") provider.setAwarenessField("user", { ...getState().live!.me, role });
    } else if (m.type === "history") {
      const rest = live.history.filter((e) => e.id !== m.entry.id);
      setLive({ history: [...rest, m.entry].slice(-300) });
    } else if (m.type === "error") notify(m.message);
  };

  const provider = new HocuspocusProvider({
    url: wsUrl(),
    name: id,
    document: doc,
    // Asked again on every reconnect (your name or the password may have changed).
    token: () =>
      JSON.stringify({ key: session?.id === id ? session.key : key, name: myName() || name, owner: ownerSecret(id) || undefined, password: password(id) || undefined }),
    onSynced: () => arrived(),
    onStatus: ({ status }) => {
      if (session?.synced) setLive({ status: status === "connected" ? "live" : "offline" });
    },
    onAuthenticated: ({ scope }) => {
      if (scope === "readonly") setLive({ readOnly: true });
    },
    onAuthenticationFailed: ({ reason }) => {
      if (reason === PASSWORD || reason === WRONG_PASSWORD) {
        useEditor.setState({ liveAsk: { password: { id, key, wrong: reason === WRONG_PASSWORD } } });
        return;
      }
      setLive({ status: "denied" });
      notify("This live diagram's link doesn't work: it may have been replaced, or the diagram deleted.");
    },
    onClose: ({ event }) => {
      if (session?.id !== id) return;
      if (event.reason === PASSWORD) {
        // The owner set a password: give it to come back in.
        leaveLive();
        joinLive(id, key);
      } else if (event.reason === REPLACED || event.reason === DELETED) {
        const deleted = event.reason === DELETED;
        disconnect();
        if (deleted) writeJson(`live-owner/${id}`, null);
        const live = getState().live;
        if (live) useEditor.setState({ live: { ...live, status: deleted ? "deleted" : "denied", peers: [], readOnly: true } });
        setViewOnly(true);
        notify(
          deleted
            ? "The owner deleted this live diagram. To keep it, save a copy."
            : "The owner replaced this diagram's link: ask them for the new one. To keep what's here, save a copy.",
        );
      }
    },
    onStateless: ({ payload }) => {
      try {
        told(JSON.parse(payload) as ServerMessage);
      } catch {
        // not for us
      }
    },
    onAwarenessChange: ({ states }) => {
      const peers: Peer[] = states
        .filter((s) => s.clientId !== doc.clientID && s.user?.name)
        .map((s) => ({
          clientId: s.clientId,
          name: String(s.user.name),
          color: String(s.user.color ?? colorFor(String(s.user.name))),
          role: s.user.role === "owner" || s.user.role === "edit" || s.user.role === "view" ? s.user.role : null,
          selection: Array.isArray(s.selection) ? (s.selection as Id[]) : [],
          editing: typeof s.editing === "string" ? s.editing : null,
        }));
      setLive({ peers });
    },
  });
  provider.setAwarenessField("user", { ...me, role: null });

  const history = new Y.UndoManager(tracked(doc), { trackedOrigins: new Set([LOCAL]), captureTimeout: 0 });
  const stacks = () => setLive({ canUndo: history.canUndo(), canRedo: history.canRedo() });
  history.on("stack-item-added", stacks);
  history.on("stack-item-popped", stacks);
  history.on("stack-cleared", stacks);

  session = { id, doc, provider, history, synced: null, waiting: false, unsubscribe: () => {}, key };
  // Nothing to edit until it has arrived.
  load({ version: 1, nodes: {}, edges: {}, order: [] }, null, "…");
  useEditor.setState({
    live: {
      id, link: liveLink(id, key), status: "connecting", me, role: null, readOnly: false,
      settings: { readOnly: false, password: false }, peers: [], canUndo: false, canRedo: false, history: [], by: {},
    },
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
    setLive({ status: "live", by: by.toJSON() });
    doc.on("afterTransaction", (tr) => {
      if (tr.changed.has(byType)) setLive({ by: by.toJSON() });
      // Only who changed what (the server's stamps): nothing to put in.
      if (tr.origin === LOCAL || [...tr.changed.keys()].every((t) => t === byType)) return;
      receive();
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
      if (st.editing?.id !== prev.editing?.id) provider.setAwarenessField("editing", st.editing?.id ?? null);
    });
  }
}
