import { type Point, add, sub, union } from "../geometry/geom";
import { exportText, subset } from "../export/text";
import { withContents } from "../model/containment";
import { addEdge, addNode, deleteObjects, makeNode, newId } from "../model/ops";
import type { Diagram, Endpoint, Id } from "../model/types";
import { middleClickRecently } from "./input";
import { apply, getState, select } from "./store";
import { screenToCell } from "./view";

/**
 * Copy puts the selection on the system clipboard as text (so it pastes as a diagram anywhere),
 * and remembers the objects. Pasting that same text back here pastes the objects; any other text
 * becomes a text label. Copying a box copies what's inside it too.
 */
let copied: { diagram: Diagram; text: string } | null = null;
let pastes = 0;

const inField = (e: Event) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
};

/** The selection (with what's inside selected boxes) as a diagram of its own, and as text. */
function selectionPart(): { diagram: Diagram; text: string } | null {
  const { selection, diagram, editing } = getState();
  if (editing || !selection.length) return null;
  const part = subset(diagram, withContents(diagram, selection));
  return { diagram: part, text: exportText(part) };
}

function remember(): string | null {
  const part = selectionPart();
  if (!part) return null;
  copied = part;
  pastes = 0;
  return part.text;
}

export const hasCopy = () => copied !== null;

/** A copy of `part` with fresh ids, moved by `delta`, added to `d`. Returns the new ids too. */
export function pasteInto(d: Diagram, part: Diagram, delta: Point): [Diagram, Id[]] {
  const ids = new Map<Id, Id>();
  let out = d;
  for (const id of part.order) {
    const n = part.nodes[id];
    const copy = { ...n, id: newId("n"), rect: { ...n.rect, x: n.rect.x + delta.x, y: n.rect.y + delta.y } };
    ids.set(id, copy.id);
    out = addNode(out, copy);
  }
  const end = (ep: Endpoint): Endpoint =>
    ep.kind === "free" ? { kind: "free", at: add(ep.at, delta) } : { ...ep, node: ids.get(ep.node) ?? ep.node };
  for (const e of Object.values(part.edges)) {
    const copy = { ...e, id: newId("e"), from: end(e.from), to: end(e.to) };
    ids.set(e.id, copy.id);
    out = addEdge(out, copy);
  }
  return [out, [...ids.values()]];
}

/** Add `part` and select it: at `at` (its top-left), or offset from where it was copied. */
function place(part: Diagram, at?: Point) {
  let delta: Point;
  if (at) {
    const bounds = union(part.order.map((id) => part.nodes[id].rect));
    delta = bounds ? sub(at, bounds) : { x: 0, y: 0 };
  } else {
    pastes++;
    delta = { x: 2 * pastes, y: pastes };
  }
  let newIds: Id[] = [];
  apply((d) => {
    const [out, ids] = pasteInto(d, part, delta);
    newIds = ids;
    return out;
  });
  select(newIds);
}

function pasteText(text: string, at?: Point) {
  if (copied && text === copied.text) {
    place(copied.diagram, at);
  } else if (text.trim()) {
    const cell = at ?? screenToCell(window.innerWidth / 3, window.innerHeight / 3);
    const node = makeNode({ ...cell, w: 1, h: 1 }, {
      border: "none", autosize: true, align: { h: "left", v: "top" }, text: text.replace(/\r/g, "").replace(/\s+$/, ""),
    });
    apply((d) => addNode(d, node));
    select([node.id]);
  }
}

// Commands (menus and shortcuts). The keyboard shortcuts arrive as clipboard events instead.

export function copyCommand() {
  const text = remember();
  if (text !== null) void navigator.clipboard?.writeText(text).catch(() => {});
}

export function cutCommand() {
  copyCommand();
  deleteSelection();
}

/** Paste what's on the clipboard (or, if it can't be read, what was last copied here). */
export function pasteCommand(at?: Point) {
  const fallback = () => copied && place(copied.diagram, at);
  if (!navigator.clipboard?.readText) return fallback();
  navigator.clipboard.readText().then((t) => (t ? pasteText(t, at) : fallback()), fallback);
}

export function duplicateCommand() {
  const part = selectionPart();
  if (!part) return;
  let newIds: Id[] = [];
  apply((d) => {
    const [out, ids] = pasteInto(d, part.diagram, { x: 2, y: 1 });
    newIds = ids;
    return out;
  });
  select(newIds);
}

export function deleteSelection() {
  const { selection } = getState();
  if (!selection.length) return;
  apply((d) => deleteObjects(d, selection));
  select([]);
}

export function attachClipboard(): () => void {
  const onCopy = (e: ClipboardEvent) => {
    if (inField(e) || !e.clipboardData) return;
    const text = remember();
    if (text === null) return;
    e.clipboardData.setData("text/plain", text);
    e.preventDefault();
  };
  const onCut = (e: ClipboardEvent) => {
    if (inField(e)) return;
    onCopy(e);
    if (e.defaultPrevented) deleteSelection();
  };
  const onPaste = (e: ClipboardEvent) => {
    if (inField(e) || getState().editing) return;
    e.preventDefault();
    if (middleClickRecently()) return; // Linux primary-selection paste: middle button pans here
    pasteText(e.clipboardData?.getData("text/plain") ?? "");
  };
  document.addEventListener("copy", onCopy);
  document.addEventListener("cut", onCut);
  document.addEventListener("paste", onPaste);
  return () => {
    document.removeEventListener("copy", onCopy);
    document.removeEventListener("cut", onCut);
    document.removeEventListener("paste", onPaste);
  };
}
