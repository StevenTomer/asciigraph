import { type CSSProperties, useEffect, useRef } from "react";
import { deleteObjects, setNodeText, updateEdge, updateNode } from "../model/ops";
import { finishEditing, getState, onFinishEditing, set, useEditor } from "../editor/store";
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
