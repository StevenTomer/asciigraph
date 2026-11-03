import type { Point } from "../geometry/geom";
import {
  type Alignment, align, bringForward, distribute, reverseEdge, sendBackward, sendToBack, topLevel,
} from "../model/arrange";
import { autoLayout } from "../model/layout";
import { bringToFront, updateEdge } from "../model/ops";
import type { Diagram, Id } from "../model/types";
import { copyCommand, cutCommand, deleteSelection, duplicateCommand, hasCopy, pasteCommand } from "./clipboard";
import { unlinkSource } from "../text/sync";
import { apply, getState, openTextDialog, select, startEditing } from "./store";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";
const shift = isMac ? "⇧" : "Shift+";

export interface MenuItem {
  label: string;
  shortcut?: string;
  run?: () => void;
  disabled?: boolean;
  /** Shown greyed out next to the label, e.g. why it's disabled. */
  hint?: string;
  submenu?: MenuEntry[];
}
export type MenuEntry = MenuItem | "separator";

const onSelection = (fn: (d: Diagram, ids: Id[]) => Diagram) => () => {
  const { selection } = getState();
  apply((d) => fn(d, selection));
};

export const arrange = {
  bringToFront: onSelection(bringToFront),
  bringForward: onSelection(bringForward),
  sendBackward: onSelection(sendBackward),
  sendToBack: onSelection(sendToBack),
};

const ALIGNMENTS: [Alignment, string][] = [
  ["left", "Align Left"], ["center", "Align Center"], ["right", "Align Right"],
  ["top", "Align Top"], ["middle", "Align Middle"], ["bottom", "Align Bottom"],
];

export function selectAll() {
  const d = getState().diagram;
  select([...d.order, ...Object.keys(d.edges)]);
}

/** The right-click menu for the current selection (`at`: the cell that was clicked). */
export function contextMenu(at: Point): MenuEntry[] {
  const { selection, diagram: d } = getState();
  const nodes = selection.filter((id) => d.nodes[id]);
  const edges = selection.filter((id) => d.edges[id]);
  const paste: MenuItem = { label: "Paste", shortcut: `${mod}V`, run: () => pasteCommand(at) };

  const layoutMenu = (ids: Id[]): MenuItem => ({
    label: "Auto Layout",
    submenu: [
      { label: "Top to Bottom", run: () => apply((dd) => autoLayout(dd, ids, "down")) },
      { label: "Left to Right", run: () => apply((dd) => autoLayout(dd, ids, "right")) },
    ],
  });

  if (!selection.length) {
    return [
      { label: "Draw from Text…", run: () => openTextDialog(null) },
      "separator",
      paste,
      ...(d.order.length >= 2 ? (["separator", layoutMenu([])] as MenuEntry[]) : []),
      "separator",
      { label: "Select All", shortcut: `${mod}A`, run: selectAll },
    ];
  }

  const arrangeable = topLevel(d, nodes).length;
  const entries: MenuEntry[] = [];
  if (nodes.length === 1 && !edges.length) {
    entries.push({ label: "Edit Text", shortcut: "Enter", run: () => startEditing(nodes[0]) }, "separator");
  }
  entries.push(
    { label: "Cut", shortcut: `${mod}X`, run: cutCommand },
    { label: "Copy", shortcut: `${mod}C`, run: copyCommand },
    { ...paste, disabled: !hasCopy() && !navigator.clipboard?.readText },
    { label: "Duplicate", shortcut: `${mod}D`, run: duplicateCommand },
    { label: "Delete", shortcut: "Del", run: deleteSelection },
  );
  if (nodes.length) {
    entries.push(
      "separator",
      { label: "Bring to Front", shortcut: `${mod}${shift}]`, run: arrange.bringToFront },
      { label: "Bring Forward", shortcut: `${mod}]`, run: arrange.bringForward },
      { label: "Send Backward", shortcut: `${mod}[`, run: arrange.sendBackward },
      { label: "Send to Back", shortcut: `${mod}${shift}[`, run: arrange.sendToBack },
    );
  }
  if (arrangeable >= 2) {
    entries.push(
      "separator",
      {
        label: "Align",
        submenu: ALIGNMENTS.flatMap(([how, label], i): MenuEntry[] => [
          ...(i === 3 ? ["separator" as const] : []),
          { label, run: onSelection((dd, ids) => align(dd, ids, how)) },
        ]),
      },
      {
        label: "Distribute",
        submenu: (["horizontal", "vertical"] as const).map((axis) => ({
          label: axis === "horizontal" ? "Distribute Horizontally" : "Distribute Vertically",
          run: onSelection((dd, ids) => distribute(dd, ids, axis)),
          disabled: arrangeable < 3,
          hint: arrangeable < 3 ? "3+ boxes" : undefined,
        })),
      },
      layoutMenu(nodes),
    );
  }
  if (edges.length === 1 && !nodes.length) {
    const e = d.edges[edges[0]];
    entries.unshift({ label: "Edit Label", shortcut: "Enter", run: () => startEditing(e.id, "label") }, "separator");
    entries.push("separator", { label: "Reverse Direction", run: () => apply((dd) => reverseEdge(dd, e.id)) });
    if (e.via?.length) {
      entries.push({ label: "Straighten", hint: "remove bends", run: () => apply((dd) => updateEdge(dd, e.id, { via: undefined })) });
    }
    if (e.label && e.labelAt !== undefined) {
      entries.push({ label: "Reset Label Position", run: () => apply((dd) => updateEdge(dd, e.id, { labelAt: undefined })) });
    }
  }
  const sourceIds = new Set(selection.map((id) => (d.nodes[id] ?? d.edges[id])?.gen?.source));
  const sourceId = sourceIds.size === 1 ? [...sourceIds][0] : undefined;
  if (!sourceId && nodes.length) {
    entries.push("separator", { label: "Edit as Text…", hint: "Mermaid", run: () => openTextDialog(null, selection) });
  }
  if (sourceId) {
    entries.push(
      "separator",
      { label: "Edit Source Text…", run: () => openTextDialog(sourceId) },
      { label: "Unlink from Text", hint: "keep the drawing", run: () => apply((dd) => unlinkSource(dd, sourceId)) },
    );
  }
  entries.push("separator", { label: "Select All", shortcut: `${mod}A`, run: selectAll });
  return entries;
}
