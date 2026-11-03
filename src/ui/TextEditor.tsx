import { type CSSProperties, useEffect, useRef } from "react";
import { deleteObjects, setNodeText, updateNode } from "../model/ops";
import { finishEditing, getState, onFinishEditing, set, useEditor } from "../editor/store";
import { rectToScreen } from "../editor/view";
import { FONT_FAMILY, FONT_SIZE, metrics } from "../render/font";
import { wrap } from "../render/textLayout";
import { shapeOf } from "../shapes/registry";

/**
 * Editing a node's text (or name) in place. A real textarea/input sits exactly over the node's
 * text area, in the canvas font at the canvas zoom, so typing, IME, selection and paste all work
 * natively; each change updates the diagram, so the box grows and connectors re-route live.
 */
export function TextEditor() {
  const editing = useEditor((s) => s.editing);
  const node = useEditor((s) => (s.editing ? s.diagram.nodes[s.editing.id] : undefined));
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

  if (!editing || !node) return null;

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
    if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey || editing.field === "name"))) {
      e.preventDefault();
      finishEditing();
    }
  };

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
  const lines = Math.min(content.h, wrap(node.text, content.w).length);
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
