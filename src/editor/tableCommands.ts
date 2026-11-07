import type { HAlign, Id, Node } from "../model/types";
import { updateNode } from "../model/ops";
import {
  type TableCell, canIndent, deleteColumn, deleteRow, indentRow, insertColumn, insertRow, moveColumn, moveRow, parseTable,
  treeMoveTarget, treeStart, withColumnAlign,
} from "../shapes/table";
import { apply, begin, commit, editCell, getState, setTableCell } from "./store";

/** The row and column commands on a table's current cell (`EditorState.tableCell`). */
export type TableOp =
  | "rowAbove" | "rowBelow" | "rowUp" | "rowDown" | "rowIndent" | "rowOutdent" | "rowDelete"
  | "colLeft" | "colRight" | "colMoveLeft" | "colMoveRight" | "colDelete";

/** `tree`: only in a tree table. */
export const TABLE_OPS: { op: TableOp; label: string; menu: string; hint?: string; tree?: true }[] = [
  { op: "rowAbove", label: "+ above", menu: "Insert Row Above" },
  { op: "rowBelow", label: "+ below", menu: "Insert Row Below" },
  { op: "rowUp", label: "↑", menu: "Move Row Up" },
  { op: "rowDown", label: "↓", menu: "Move Row Down" },
  { op: "rowOutdent", label: "⇤", menu: "Outdent Row", hint: "Alt+Shift+←", tree: true },
  { op: "rowIndent", label: "⇥", menu: "Indent Row", hint: "Alt+Shift+→", tree: true },
  { op: "rowDelete", label: "delete", menu: "Delete Row" },
  { op: "colLeft", label: "+ left", menu: "Insert Column Left" },
  { op: "colRight", label: "+ right", menu: "Insert Column Right" },
  { op: "colMoveLeft", label: "←", menu: "Move Column Left" },
  { op: "colMoveRight", label: "→", menu: "Move Column Right" },
  { op: "colDelete", label: "delete", menu: "Delete Column" },
];

/** The ops a table has (a tree table's indenting only in one). */
export const tableOpsOf = (n: Node, which: "row" | "col") => TABLE_OPS.filter((o) => o.op.startsWith(which) && (!o.tree || n.table?.tree));

/** Whether `op` can be done at `at` (a table keeps a row and a column; moves stay inside it, and
 * in a tree table, a row moves among its parent's). */
export function canTableOp(n: Node, op: TableOp, at: TableCell): boolean {
  const t = parseTable(n.text);
  if (at.row < 0 || !t.rows.length) return false;
  const tree = !!n.table?.tree;
  const head = treeStart(t);
  switch (op) {
    case "rowUp": return tree && at.row >= head ? treeMoveTarget(n, at.row, -1) >= 0 : at.row > 0 && (!tree || at.row < head);
    case "rowDown": return tree && at.row >= head ? treeMoveTarget(n, at.row, 1) >= 0 : at.row < t.rows.length - 1 && (!tree || at.row + 1 < head);
    case "rowIndent": return canIndent(n, at.row, 1);
    case "rowOutdent": return canIndent(n, at.row, -1);
    case "rowDelete": return t.rows.length > 1;
    case "colMoveLeft": return at.col > 0;
    case "colMoveRight": return at.col < t.cols - 1;
    case "colDelete": return t.cols > 1;
    default: return true;
  }
}

/** What `op` does to the table, and which cell is current afterwards. */
function change(n: Node, op: TableOp, { row, col }: TableCell): { patch: Partial<Node>; at: TableCell } {
  const t = parseTable(n.text);
  switch (op) {
    case "rowAbove": return { patch: insertRow(n, row), at: { row, col } };
    case "rowBelow": return { patch: insertRow(n, row + 1), at: { row: row + 1, col } };
    case "rowUp": return { patch: moveRow(n, row, -1), at: { row: n.table?.tree && row >= treeStart(t) ? treeMoveTarget(n, row, -1) : row - 1, col } };
    case "rowDown": return { patch: moveRow(n, row, 1), at: { row: n.table?.tree && row >= treeStart(t) ? treeMoveTarget(n, row, 1) : row + 1, col } };
    case "rowIndent": return { patch: indentRow(n, row, 1), at: { row, col } };
    case "rowOutdent": return { patch: indentRow(n, row, -1), at: { row, col } };
    case "rowDelete": return { patch: deleteRow(n, row), at: { row: Math.min(row, t.rows.length - 2), col } };
    case "colLeft": return { patch: insertColumn(n, col), at: { row, col } };
    case "colRight": return { patch: insertColumn(n, col + 1), at: { row, col: col + 1 } };
    case "colMoveLeft": return { patch: moveColumn(n, col, -1), at: { row, col: col - 1 } };
    case "colMoveRight": return { patch: moveColumn(n, col, 1), at: { row, col: col + 1 } };
    case "colDelete": return { patch: deleteColumn(n, col), at: { row, col: Math.min(col, t.cols - 2) } };
  }
}

/** Run a change on a table as its own undo step; if a cell is being typed in, typing carries on
 * in the cell that's current afterwards. */
function onTable(id: Id, fn: (n: Node) => { patch: Partial<Node>; at: TableCell }) {
  const { diagram, editing } = getState();
  const n = diagram.nodes[id];
  if (!n) return;
  const typing = editing?.field === "cell" && editing.id === id;
  if (typing) commit(); // what was typed so far: its own undo step
  const { patch, at } = fn(n);
  apply((d) => updateNode(d, id, patch));
  if (typing) {
    begin();
    editCell(id, at);
  } else {
    setTableCell({ node: id, ...at });
  }
}

export function tableOp(id: Id, op: TableOp, at: TableCell) {
  onTable(id, (n) => change(n, op, at));
}

export function columnAlign(id: Id, at: TableCell, align: HAlign) {
  onTable(id, (n) => ({ patch: withColumnAlign(n, at.col, align), at }));
}
