import type { Diagram, Id } from "../model/types";
import { chars } from "../render/textLayout";
import { directionOf, setDirection } from "../text/sync";
import { withContents } from "../model/containment";
import { type TextOptions, exportText, subset } from "./text";

/** How many columns wide some text is (its longest line). */
export const textWidth = (text: string) => Math.max(0, ...text.split("\n").map((l) => chars(l).length));

/**
 * The graphs drawn from text left to right that `d` shows (its objects' sources), with how wide
 * the export would be if each were laid out top to bottom instead: only those that come out
 * narrower.
 */
export function narrowerLayouts(d: Diagram, opts: TextOptions, ids?: Id[]): { source: Id; width: number }[] {
  // (Just the selection, if that's what's exported: ids stay the same when it's re-laid out.)
  const part = (x: Diagram) => (ids ? subset(x, withContents(x, ids)) : x);
  const current = textWidth(exportText(part(d), opts));
  const shown = new Set((ids ?? [...Object.keys(d.nodes), ...Object.keys(d.edges)]).map((id) => (d.nodes[id] ?? d.edges[id])?.gen?.source).filter(Boolean));
  const out: { source: Id; width: number }[] = [];
  for (const id of shown) {
    const src = d.sources?.[id!];
    if (!src || directionOf(src) !== "right") continue;
    const down = setDirection(d, id!, "down").diagram;
    const width = textWidth(exportText(part(down), opts));
    if (width < current) out.push({ source: id!, width });
  }
  return out;
}
