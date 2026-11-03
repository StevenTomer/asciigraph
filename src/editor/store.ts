import { create } from "zustand";
import type { Rect, Side } from "../geometry/geom";
import { emptyDiagram } from "../model/ops";
import type { Diagram, Id, NodeKind } from "../model/types";
import type { Guide } from "./snap";

export type ToolId = "select" | "box" | "arrow" | "line" | "text";

/** Transient things drawn over the diagram while a gesture is in progress. */
export interface Overlay {
  marquee?: Rect;
  /** A node an edge end would attach to, and the side if it's pinned. */
  attach?: { node: Id; side: Side | null };
  /** Show a w×h label for this rect (creating or resizing a box). */
  sizeOf?: Rect;
  /** Alignment guides while snapping (see snap.ts). */
  guides?: Guide[];
}

export interface View {
  zoom: number;
  /** Canvas pixel (at zoom 1) shown at the screen's top-left. */
  x: number;
  y: number;
}

export interface EditorState {
  diagram: Diagram;
  /** Undo/redo stacks of whole diagrams (they're immutable and share structure). */
  past: Diagram[];
  future: Diagram[];
  /** The diagram as it was when the current gesture began; committed to `past` when it ends. */
  pending: Diagram | null;
  selection: Id[];
  tool: ToolId;
  /** The shape the box tool draws. */
  shape: NodeKind;
  /** In-place editing: a node's text or name, or a connector's label. */
  editing: { id: Id; field: "text" | "name" | "label" } | null;
  overlay: Overlay;
  view: View;
  dark: boolean;
  grid: boolean;
  /** Which saved diagram is open, or null for a shared one that hasn't been saved. */
  diagramId: string | null;
  diagramName: string;
  /** The "draw from text" dialog: for a new drawing (sourceId null), to edit one, or to edit a
   * hand-drawn selection as text (`adopt`: its ids). */
  textDialog: { sourceId: Id | null; adopt?: Id[] } | null;
  /** The right-click menu: where it opened (screen px) and the cell under it. */
  menu: { x: number; y: number; cell: { x: number; y: number } } | null;
}

const MAX_HISTORY = 200;

export const useEditor = create<EditorState>(() => ({
  diagram: emptyDiagram(),
  past: [],
  future: [],
  pending: null,
  selection: [],
  tool: "select",
  shape: "box",
  editing: null,
  overlay: {},
  view: { zoom: 1, x: -40, y: -70 },
  dark: false,
  grid: true,
  diagramId: null,
  diagramName: "",
  menu: null,
  textDialog: null,
}));

export const getState = useEditor.getState;
const setState = useEditor.setState;

// ---------------------------------------------------------------------------------------------
// History. A gesture (drag, typing session) calls begin(), any number of set()s, then commit():
// one undo step. One-shot edits use apply().
// ---------------------------------------------------------------------------------------------

export function begin() {
  const s = getState();
  if (!s.pending) setState({ pending: s.diagram });
}

export function set(diagram: Diagram) {
  setState({ diagram });
}

export function commit() {
  const { pending, diagram, past } = getState();
  if (!pending) return;
  if (pending === diagram) {
    setState({ pending: null });
    return;
  }
  setState({ pending: null, past: [...past, pending].slice(-MAX_HISTORY), future: [] });
}

/** Abandon the current gesture, restoring the diagram from before it. */
export function cancel() {
  const { pending } = getState();
  if (pending) setState({ diagram: pending, pending: null });
}

export function apply(fn: (d: Diagram) => Diagram) {
  begin();
  set(fn(getState().diagram));
  commit();
}

export function undo() {
  finishEditing();
  commit();
  const { past, future, diagram } = getState();
  if (!past.length) return;
  const prev = past[past.length - 1];
  setState({ diagram: prev, past: past.slice(0, -1), future: [diagram, ...future] });
  pruneSelection();
}

export function redo() {
  finishEditing();
  commit();
  const { past, future, diagram } = getState();
  if (!future.length) return;
  setState({ diagram: future[0], future: future.slice(1), past: [...past, diagram] });
  pruneSelection();
}

/** Replace the whole diagram (opening a file), with its saved undo history if there is one. */
export function load(diagram: Diagram, id: string | null, name: string, history?: { past: Diagram[]; future: Diagram[] }) {
  setState({
    diagram, past: history?.past ?? [], future: history?.future ?? [], pending: null, selection: [],
    editing: null, overlay: {}, diagramId: id, diagramName: name,
  });
}

// ---------------------------------------------------------------------------------------------
// Selection, tools, editing
// ---------------------------------------------------------------------------------------------

export function select(ids: Id[]) {
  setState({ selection: ids });
}

function pruneSelection() {
  const { selection, diagram } = getState();
  const kept = selection.filter((id) => diagram.nodes[id] || diagram.edges[id]);
  if (kept.length !== selection.length) setState({ selection: kept });
}

export function setTool(tool: ToolId) {
  finishEditing();
  setState({ tool, overlay: {} });
}

export function setShape(shape: NodeKind) {
  setState({ shape });
}

export function setOverlay(overlay: Overlay) {
  setState({ overlay });
}

/** Hook for the text editor to finish (commit text, drop empty labels); set by the editor UI. */
let finishHook: (() => void) | null = null;
export function onFinishEditing(hook: (() => void) | null) {
  finishHook = hook;
}

export function startEditing(id: Id, field: "text" | "name" | "label" = "text") {
  finishEditing();
  begin();
  setState({ editing: { id, field }, selection: [id] });
}

export function finishEditing() {
  if (!getState().editing) return;
  finishHook?.();
  setState({ editing: null });
  commit();
}

export function setView(view: Partial<View>) {
  setState({ view: { ...getState().view, ...view } });
}

export function openTextDialog(sourceId: Id | null, adopt?: Id[]) {
  setState({ textDialog: { sourceId, ...(adopt && { adopt }) }, menu: null });
}

export function closeTextDialog() {
  setState({ textDialog: null });
}

export function setMenu(menu: EditorState["menu"]) {
  setState({ menu });
}

export function setPrefs(prefs: Partial<Pick<EditorState, "dark" | "grid">>) {
  setState(prefs);
}
