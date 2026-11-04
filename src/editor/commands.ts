import type { Point } from "../geometry/geom";
import {
  type Alignment, align, bringForward, distribute, reverseEdge, sendBackward, sendToBack, topLevel,
} from "../model/arrange";
import { autoLayout } from "../model/layout";
import { lockTogether, locksOf, unlock } from "../model/locks";
import { canShrinkToText, sameSize, shrinkToText } from "../model/size";
import { bringToFront, updateEdge } from "../model/ops";
import type { Diagram, Id } from "../model/types";
import { copyCommand, cutCommand, deleteSelection, duplicateCommand, hasCopy, pasteCommand } from "./clipboard";
import { directionOf, setDirection, unlinkSource } from "../text/sync";
import { apply, getState, openTextDialog, select, startEditing } from "./store";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";
const shift = isMac ? "⇧" : "Shift+";

/** "Normalize Size": make the selected boxes as wide and/or tall as the largest of them. */
export const normalizeMenu = (ids: Id[]): MenuItem => ({
  label: "Normalize Size",
  submenu: [
    { label: "Width", hint: "as the widest", run: () => apply((dd) => sameSize(dd, ids, { w: true, h: false })) },
    { label: "Height", hint: "as the tallest", run: () => apply((dd) => sameSize(dd, ids, { w: false, h: true })) },
    { label: "Both", hint: "as the largest", run: () => apply((dd) => sameSize(dd, ids, { w: true, h: true })) },
  ],
});

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
      { label: "Top to Bottom (TB)", run: () => apply((dd) => autoLayout(dd, ids, "down")) },
      { label: "Left to Right (LR)", run: () => apply((dd) => autoLayout(dd, ids, "right")) },
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
  const linkedSources = new Set(selection.map((id) => (d.nodes[id] ?? d.edges[id])?.gen?.source));
  const linkedId = linkedSources.size === 1 ? [...linkedSources][0] : undefined;
  const linkedLayout = !!linkedId && !!d.sources?.[linkedId] && directionOf(d.sources[linkedId]) !== null;
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
      // A graph drawn from text gets "Layout" (below), which lays it out from its text instead.
      ...(linkedLayout ? [] : [layoutMenu(nodes)]),
    );
  }
  // Sizes: all the same (as the largest), or each fitted to its text.
  if (nodes.length) {
    entries.push("separator");
    if (nodes.length >= 2) entries.push(normalizeMenu(nodes));
    const fits = canShrinkToText(d, nodes);
    entries.push({
      label: "Shrink to Text", run: () => apply((dd) => shrinkToText(dd, nodes)),
      disabled: !fits, hint: fits ? undefined : "already fits",
    });
  }
  // Locks: move together left–right, up–down, or both.
  const locked = nodes.some((id) => locksOf(d, id).length);
  if (nodes.length >= 2 || locked) {
    entries.push("separator");
    if (nodes.length >= 2) {
      entries.push({
        label: "Lock Together",
        submenu: [
          { label: "Horizontally", hint: "move left–right together", run: () => apply((dd) => lockTogether(dd, nodes, { x: true, y: false })) },
          { label: "Vertically", hint: "move up–down together", run: () => apply((dd) => lockTogether(dd, nodes, { x: false, y: true })) },
          { label: "Both", hint: "move together", run: () => apply((dd) => lockTogether(dd, nodes, { x: true, y: true })) },
        ],
      });
    }
    if (locked) entries.push({ label: "Unlock", run: () => apply((dd) => unlock(dd, nodes)) });
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
    const src = d.sources?.[sourceId];
    const dir = src ? directionOf(src) : null;
    entries.push(
      "separator",
      { label: "Edit Source Text…", run: () => openTextDialog(sourceId) },
      ...(dir
        ? [{
            label: "Layout",
            submenu: (["down", "right"] as const).map((v) => ({
              label: v === "down" ? "Top to Bottom (TB)" : "Left to Right (LR)",
              hint: dir === v ? "current" : undefined,
              disabled: dir === v,
              run: () => apply((dd) => setDirection(dd, sourceId, v).diagram),
            })),
          }]
        : []),
      { label: "Unlink from Text", hint: "keep the drawing", run: () => apply((dd) => unlinkSource(dd, sourceId)) },
    );
  }
  entries.push("separator", { label: "Select All", shortcut: `${mod}A`, run: selectAll });
  return entries;
}
