import { union } from "../geometry/geom";
import { isDiagram } from "../model/ops";
import type { Diagram } from "../model/types";
import { readJson, writeJson } from "./local";

/**
 * Stamps: saved groups of objects (a styled box, a database with its label, a whole little
 * pattern) to insert again, in any diagram. Kept in this browser, like diagrams; exported and
 * imported as a .json file to move them elsewhere or share them.
 */
export interface Stamp {
  id: string;
  name: string;
  /** The objects, moved so their top-left is (0, 0), with no link to any text. */
  diagram: Diagram;
  created: number;
}

const KEY = "stamps";

export function listStamps(): Stamp[] {
  const list = readJson<unknown>(KEY, []);
  return Array.isArray(list) ? list.filter((s): s is Stamp => !!s && typeof s.id === "string" && isDiagram(s.diagram)) : [];
}

const store = (list: Stamp[]) => writeJson(KEY, list);

/** A part of a diagram as a stamp's objects: at (0, 0), plain (not linked to text, not locked). */
export function stampOf(part: Diagram): Diagram {
  const bounds = union(part.order.map((id) => part.nodes[id].rect)) ?? { x: 0, y: 0, w: 0, h: 0 };
  const dx = -bounds.x, dy = -bounds.y;
  const move = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: p.x + dx, y: p.y + dy });
  return {
    version: 1,
    order: [...part.order],
    nodes: Object.fromEntries(Object.entries(part.nodes).map(([id, n]) => [id, { ...n, rect: move(n.rect), gen: undefined }])),
    edges: Object.fromEntries(Object.entries(part.edges).map(([id, e]) => [id, {
      ...e,
      gen: undefined,
      from: e.from.kind === "free" ? { kind: "free", at: move(e.from.at) } : e.from,
      to: e.to.kind === "free" ? { kind: "free", at: move(e.to.at) } : e.to,
      ...(e.via && { via: e.via.map(move) }),
    }])),
  };
}

const newStampId = () => "st" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function saveStamp(name: string, part: Diagram): Stamp {
  const stamp: Stamp = { id: newStampId(), name: name.trim() || "Stamp", diagram: stampOf(part), created: Date.now() };
  store([...listStamps(), stamp]);
  return stamp;
}

export function renameStamp(id: string, name: string) {
  store(listStamps().map((s) => (s.id === id ? { ...s, name: name.trim() || s.name } : s)));
}

export function deleteStamp(id: string) {
  store(listStamps().filter((s) => s.id !== id));
}

/** All stamps as a file's contents. */
export function exportStamps(list = listStamps()): string {
  return JSON.stringify({ asciigraphStamps: 1, stamps: list.map(({ name, diagram, created }) => ({ name, diagram, created })) }, null, 1);
}

/** Add the stamps in a file (exported by exportStamps); returns how many. */
export function importStamps(json: string): number {
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch {
    throw new Error("That file isn't JSON.");
  }
  const raw = (obj as { stamps?: unknown })?.stamps;
  if (!Array.isArray(raw)) throw new Error("That file has no asciigraph stamps in it.");
  const added = raw
    .filter((s) => s && isDiagram(s.diagram))
    .map((s): Stamp => ({ id: newStampId(), name: String(s.name ?? "Stamp"), diagram: stampOf(s.diagram), created: Number(s.created) || Date.now() }));
  if (!added.length) throw new Error("That file has no asciigraph stamps in it.");
  store([...listStamps(), ...added]);
  return added.length;
}

/** A name to suggest for a new stamp: the first line of text in it. */
export function suggestName(part: Diagram): string {
  for (const id of part.order) {
    const line = part.nodes[id].text.split("\n").find((l) => l.trim() && !/^\s*-{3,}\s*$/.test(l));
    if (line) return line.trim().slice(0, 40);
  }
  return "Stamp";
}
