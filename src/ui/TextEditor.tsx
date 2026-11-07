import { type CSSProperties, useEffect, useRef, useState } from "react";
import { deleteObjects, setNodeText, updateEdge, updateNode } from "../model/ops";
import { editCell, finishEditing, getState, onFinishEditing, set, useEditor } from "../editor/store";
import { tableOp } from "../editor/tableCommands";
import { cellRect, cellText, insertRow, parseTable, withCell } from "../shapes/table";
import type { Node } from "../model/types";
import { rectToScreen, rendered } from "../editor/view";
import { FONT_FAMILY, FONT_SIZE, metrics } from "../render/font";
import { chars, textLines } from "../render/textLayout";
import { shapeOf } from "../shapes/registry";

/**
 * Editing a node's text (or name) in place. A real textarea/input sits exactly over the node's
 * text area, in the canvas font at the canvas zoom, so typing, IME, selection and paste all work
 * natively; each change updates the diagram, so the box grows and connectors re-route live.
 */
export function TextEditor() {
  const editing = useEditor((s) => s.editing);
  const node = useEditor((s) => (s.editing ? s.diagram.nodes[s.editing.id] : undefined));
  const edge = useEditor((s) => (s.editing ? s.diagram.edges[s.editing.id] : undefined));
  const diagram = useEditor((s) => s.diagram);
  const view = useEditor((s) => s.view);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  useEffect(() => {
    // When editing ends: drop labels left empty (they'd be invisible).
    onFinishEditing(() => {
      const { editing: e, diagram } = getState();
      const n = e && diagram.nodes[e.id];
      if (n && n.border === "none" && n.text.trim() === "") set(deleteObjects(diagram, [n.id]));
    });
    return () => onFinishEditing(null);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing?.id, editing?.field]);

  if (!editing || (!node && !edge)) return null;

  const { zoom } = view;
  const common: CSSProperties = {
    position: "absolute",
    fontFamily: FONT_FAMILY,
    fontSize: FONT_SIZE * zoom,
    lineHeight: `${metrics.ch * zoom}px`,
    letterSpacing: (metrics.cw - metrics.advance) * zoom,
  };
  const keyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    // Text: Enter adds a line. Labels: Enter finishes, Shift+Enter adds a line. Names: one line.
    const newline = editing.field === "text" ? !(e.ctrlKey || e.metaKey) : editing.field === "label" && e.shiftKey;
    if (e.key === "Escape" || (e.key === "Enter" && !newline)) {
      e.preventDefault();
      finishEditing();
    }
  };

  if (editing.field === "label" && edge) {
    const at = rendered(diagram).edges.get(edge.id)?.label;
    if (!at) return null;
    const lines = (edge.label ?? "").split("\n");
    const w = Math.max(...lines.map((l) => chars(l).length + 2), 10);
    const box = rectToScreen({ x: at.x - 1, y: at.y, w, h: Math.max(at.h, lines.length) });
    return (
      <textarea
        ref={ref}
        className="text-editor"
        aria-label="Connector label"
        title="Enter: done · Shift+Enter: new line"
        spellCheck={false}
        style={{ ...common, left: box.x, top: box.y, width: box.w, height: box.h, whiteSpace: "pre", textAlign: "center" }}
        value={edge.label ?? ""}
        placeholder="label"
        onChange={(e) => set(updateEdge(getState().diagram, edge.id, { label: e.target.value || undefined }))}
        onKeyDown={keyDown}
        onBlur={() => finishEditing()}
      />
    );
  }
  if (!node) return null;

  if (editing.field === "cell" && editing.cell) {
    const { row, col } = editing.cell;
    return <CellEditor key={`${node.id}:${editing.serial ?? 0}`} serial={editing.serial ?? 0} node={node} row={row} col={col} style={common} />;
  }

  if (editing.field === "name") {
    const r = node.rect;
    const box = rectToScreen({ x: r.x + 2, y: r.y, w: Math.max(4, r.w - 4), h: 1 });
    return (
      <input
        ref={ref}
        className="text-editor"
        aria-label="Box name"
        style={{ ...common, left: box.x, top: box.y, width: box.w, height: box.h }}
        value={node.name ?? ""}
        placeholder="name"
        onChange={(e) => set(updateNode(getState().diagram, node.id, { name: e.target.value || undefined }))}
        onKeyDown={keyDown}
        onBlur={() => finishEditing()}
      />
    );
  }

  const content = shapeOf(node).contentRect(node);
  // Labels grow as you type: leave a column for the caret.
  const area = node.autosize ? { ...content, w: content.w + 1 } : content;
  const box = rectToScreen(area);
  const lines = Math.min(content.h, textLines(node.text, content.w, node.lists === false).length);
  const free = content.h - lines;
  const topLines = node.align.v === "middle" ? Math.floor(free / 2) : node.align.v === "bottom" ? free : 0;
  return (
    <textarea
      ref={ref}
      className="text-editor"
      aria-label="Text"
      spellCheck={false}
      style={{
        ...common,
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        paddingTop: topLines * metrics.ch * zoom,
        textAlign: node.align.h,
      }}
      value={node.text}
      onChange={(e) => set(setNodeText(getState().diagram, node.id, e.target.value))}
      onKeyDown={keyDown}
      onBlur={() => finishEditing()}
    />
  );
}

/**
 * Editing one cell of a table (or its title, row -1). Tab / Shift+Tab go to the next / previous
 * cell (Tab in the last one adds a row); ↑ / ↓ on the first / last line go to the cell above /
 * below; Enter adds a line; Esc or Ctrl+Enter is done.
 */
function CellEditor({ node, row, col, serial, style }: { node: Node; row: number; col: number; serial: number; style: CSSProperties }) {
  // What's typed is kept as typed (the table's text trims cells, which would eat a space just typed).
  const [value, setValue] = useState(() => cellText(node.text, { row, col }));
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const t = parseTable(node.text);
  const { text: area } = cellRect(node, { row, col });
  // A column that grows as you type: room for the caret.
  const grows = node.autosize || node.table?.widths?.[col] == null;
  const box = rectToScreen(row >= 0 && grows ? { ...area, w: area.w + 1 } : area);
  const align = row < 0 ? node.table?.titleAlign ?? "center" : t.aligns[col] ?? "left";
  const go = (r: number, c: number) => editCell(node.id, { row: r, col: c });
  const keyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    const el = e.currentTarget;
    const before = el.value.slice(0, el.selectionStart);
    const after = el.value.slice(el.selectionEnd);
    if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey || (row < 0 && node.table?.title === "border")))) {
      e.preventDefault();
      finishEditing();
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) {
        if (row < 0) return;
        if (col > 0) go(row, col - 1);
        else if (row > 0) go(row - 1, t.cols - 1);
        else if (t.title) go(-1, 0);
      } else if (row < 0) {
        go(0, 0);
      } else if (col < t.cols - 1) {
        go(row, col + 1);
      } else {
        if (row === t.rows.length - 1) {
          const d = getState().diagram;
          set(updateNode(d, node.id, insertRow(d.nodes[node.id], t.rows.length)));
        }
        go(row + 1, 0);
      }
    } else if (e.altKey && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && node.table?.tree && row >= 0) {
      // A tree table: the row a level deeper or shallower (typing carries on).
      e.preventDefault();
      tableOp(node.id, e.key === "ArrowRight" ? "rowIndent" : "rowOutdent", { row, col });
    } else if (e.key === "ArrowUp" && !before.includes("\n") && !e.shiftKey && (row > 0 || (row === 0 && t.title))) {
      e.preventDefault();
      go(row - 1, row - 1 < 0 ? 0 : col);
    } else if (e.key === "ArrowDown" && !after.includes("\n") && !e.shiftKey && row < t.rows.length - 1) {
      e.preventDefault();
      go(row + 1, row < 0 ? 0 : col);
    }
  };
  return (
    <textarea
      ref={ref}
      className="text-editor"
      aria-label={row < 0 ? "Table title" : `Cell, row ${row + 1}, column ${col + 1}`}
      title={node.table?.tree ? "Tab: next cell · Alt+Shift+→ / ←: indent / outdent the row · Enter: new line · Esc: done" : "Tab: next cell · Enter: new line · Esc: done"}
      spellCheck={false}
      style={{ ...style, left: box.x, top: box.y, width: box.w, height: box.h, textAlign: align }}
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        const d = getState().diagram;
        const n = d.nodes[node.id];
        if (n) set(updateNode(d, n.id, withCell(n, { row, col }, e.target.value)));
      }}
      onKeyDown={keyDown}
      onBlur={() => {
        // Moving to another cell of the same table isn't the end of editing.
        setTimeout(() => {
          const e = getState().editing;
          if (e?.field === "cell" && e.id === node.id && e.serial === serial && document.activeElement !== ref.current) finishEditing();
        });
      }}
    />
  );
}
