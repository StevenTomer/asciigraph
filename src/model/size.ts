import type { Rect } from "../geometry/geom";
import { chars, textLines } from "../render/textLayout";
import { shapeOf } from "../shapes/registry";
import { contents } from "./containment";
import { resizeNode } from "./ops";
import type { Diagram, Id, Node } from "./types";

/**
 * Sizing several boxes at once: "Same Width / Height" (to the largest of them), and "Shrink to
 * Text" (the smallest size that shows the text without wrapping). Both keep each box's top-left
 * corner where it is; connectors follow.
 */

/** Kinds whose size isn't about their text: frames surround things, lifelines span messages. */
const NOT_TEXT_SIZED = new Set<Node["kind"]>(["frame", "lifeline", "activation"]);

/** Give every node in `ids` the width and/or height of the largest of them. */
export function sameSize(d: Diagram, ids: Id[], axes: { w: boolean; h: boolean }): Diagram {
  const nodes = ids.map((id) => d.nodes[id]).filter(Boolean);
  if (nodes.length < 2) return d;
  const w = Math.max(...nodes.map((n) => n.rect.w));
  const h = Math.max(...nodes.map((n) => n.rect.h));
  return nodes.reduce(
    (out, n) => resizeNode(out, n.id, { ...n.rect, w: axes.w ? w : n.rect.w, h: axes.h ? h : n.rect.h }),
    d
  );
}

/**
 * The smallest rect (same top-left) in which `node`'s text shows unwrapped, and its name fits in
 * the top border. Null when there's nothing to fit (no text or name), or the kind isn't sized by
 * its text.
 */
export function textFit(node: Node): Rect | null {
  if (NOT_TEXT_SIZED.has(node.kind)) return null;
  // A table: its columns at their own widths (as set, or their widest line).
  if (node.kind === "table" || node.kind === "timeline") return { ...node.rect, ...shapeOf(node).fitSize({ ...node, autosize: true }, node.text) };
  const text = node.text;
  const name = node.border !== "none" ? node.name ?? "" : "";
  if (!text.trim() && !name) return null;
  const shape = shapeOf(node);
  const lines = text ? textLines(text, 100000, node.lists === false) : [];
  const tw = Math.max(0, ...lines.map((l) => chars(l).length));
  const th = lines.length;
  // A name is drawn as "┌─ name ─┐": a corner, a line and a space each side.
  const nameW = name ? chars(name.replace(/\n/g, " ")).length + 6 : 0;
  const min = shape.minSize(node);
  const at = (w: number, h: number): Rect => {
    const r = { ...node.rect, w, h };
    return shape.normalize ? shape.normalize(r) : r;
  };
  // Keep the padding the shape has when wide enough (small boxes drop it). Measured at the same
  // height: a diamond's side room depends on it.
  const pad = (h: number) => {
    const roomy = { ...node.rect, w: 60, h };
    return shape.contentRect({ ...node, rect: roomy }).x - roomy.x;
  };
  const fits = (r: Rect) => {
    const c = shape.contentRect({ ...node, rect: r });
    return c.w >= tw && c.h >= th && r.w >= nameW && c.x - r.x >= pad(r.h);
  };
  // Shortest first (a diamond's text room depends on its height), then narrowest.
  for (let h = min.h; h <= min.h + th + 20; h++) {
    for (let w = Math.max(min.w, nameW); w <= Math.max(min.w, nameW) + tw + 20; w++) {
      const r = at(w, h);
      if (fits(r)) return r;
    }
  }
  return null;
}

/**
 * Shrink (or grow) each node to fit its text. Boxes with other boxes inside are left alone, as
 * shrinking them would push their contents out.
 */
export function shrinkToText(d: Diagram, ids: Id[]): Diagram {
  let out = d;
  for (const id of ids) {
    const n = out.nodes[id];
    if (!n || contents(out, id).length) continue;
    const r = textFit(n);
    if (r && (r.w !== n.rect.w || r.h !== n.rect.h)) out = resizeNode(out, id, r);
  }
  return out;
}

/** Whether Shrink to Text would do anything for these. */
export const canShrinkToText = (d: Diagram, ids: Id[]) =>
  ids.some((id) => {
    const n = d.nodes[id];
    if (!n || contents(d, id).length) return false;
    const r = textFit(n);
    return !!r && (r.w !== n.rect.w || r.h !== n.rect.h);
  });
