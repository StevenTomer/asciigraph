import { deleteObjects } from "../model/ops";
import type { Diagram, Id } from "../model/types";
import { rasterize } from "../render/rasterize";

export interface TextOptions {
  ascii?: boolean;
  markdown?: boolean;
}

/** The diagram as plain text (trimmed to what's drawn), optionally ASCII-only or in a code block. */
export function exportText(d: Diagram, opts: TextOptions = {}): string {
  const text = rasterize(d).grid.toText(null, !!opts.ascii);
  return opts.markdown ? "```\n" + text + "\n```" : text;
}

/** Just some objects: everything else is removed (their edges' ends left free where they were). */
export function subset(d: Diagram, ids: Id[]): Diagram {
  const keep = new Set(ids);
  const drop = [...d.order, ...Object.keys(d.edges)].filter((id) => !keep.has(id));
  return deleteObjects(d, drop);
}
