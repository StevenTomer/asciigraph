import { type Point, add } from "../geometry/geom";
import { exportText, subset } from "../export/text";
import { addEdge, addNode, deleteObjects, makeNode, newId } from "../model/ops";
import type { Diagram, Endpoint, Id } from "../model/types";
import { apply, getState, select } from "./store";
import { screenToCell } from "./view";

/**
 * Copy puts the selection on the system clipboard as text (so it pastes as a diagram anywhere),
 * and remembers the objects. Pasting that same text back here pastes the objects; any other text
 * becomes a text label.
 */
let copied: { diagram: Diagram; text: string } | null = null;
let pastes = 0;

const inField = (e: Event) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
};

function copySelection(e: ClipboardEvent): boolean {
  const { selection, diagram, editing } = getState();
  if (editing || !selection.length || !e.clipboardData) return false;
  const part = subset(diagram, selection);
  const text = exportText(part);
  e.clipboardData.setData("text/plain", text);
  e.preventDefault();
  copied = { diagram: part, text };
  pastes = 0;
  return true;
}

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

export function attachClipboard(): () => void {
  const onCopy = (e: ClipboardEvent) => {
    if (!inField(e)) copySelection(e);
  };
  const onCut = (e: ClipboardEvent) => {
    if (inField(e) || !copySelection(e)) return;
    const { selection } = getState();
    apply((d) => deleteObjects(d, selection));
    select([]);
  };
  const onPaste = (e: ClipboardEvent) => {
    if (inField(e) || getState().editing) return;
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (copied && text === copied.text) {
      e.preventDefault();
      pastes++;
      const part = copied.diagram;
      let newIds: Id[] = [];
      apply((d) => {
        const [out, ids] = pasteInto(d, part, { x: 2 * pastes, y: pastes });
        newIds = ids;
        return out;
      });
      select(newIds);
    } else if (text.trim()) {
      e.preventDefault();
      const at = screenToCell(window.innerWidth / 3, window.innerHeight / 3);
      const node = makeNode({ ...at, w: 1, h: 1 }, {
        border: "none", autosize: true, align: { h: "left", v: "top" }, text: text.replace(/\r/g, "").replace(/\s+$/, ""),
      });
      apply((d) => addNode(d, node));
      select([node.id]);
    }
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
