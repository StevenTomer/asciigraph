/**
 * Live diagrams' history: a short description of each change ("moved 'API'", "added 2 boxes"),
 * made by the server from what a change did to the shared document (collab/bridge.ts maps).
 */

/** One entry of a map that changed: which map, which key, and its value before and after
 * (undefined: not there). */
export interface MapChange {
  map: string;
  key: string;
  old: unknown;
  now: unknown;
}

/** A change in a diagram's history, as the server keeps it and sends it. */
export interface HistoryEntry {
  id: number;
  at: number;
  name: string;
  summary: string;
  /** The same change made again soon after (moving a box a few times): counted, not repeated. */
  count: number;
}

type Obj = Record<string, any>;

const quoted = (s: string) => {
  const line = s.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line ? `'${line.length > 24 ? line.slice(0, 23) + "…" : line}'` : "";
};

const nodeName = (n: Obj | undefined) => (n ? quoted(String(n.name || n.text || "")) : "");
const edgeName = (e: Obj | undefined) => (e?.label ? `the connector ${quoted(String(e.label))}` : "");

/** "a box" / "'API'" / "3 boxes". */
function things(items: (Obj | undefined)[], noun: [string, string], name: (o: Obj | undefined) => string) {
  if (items.length === 1) return name(items[0]) || `a ${noun[0]}`;
  return `${items.length} ${noun[1]}`;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** How a node changed: moved, resized, its text, or something else (style). */
function nodeChange(old: Obj, now: Obj): "moved" | "resized" | "text" | "changed" {
  const { rect: r0, text: t0, ...rest0 } = old;
  const { rect: r1, text: t1, ...rest1 } = now;
  const restSame = same(rest0, rest1);
  if (t0 !== t1 && restSame && same(r0, r1)) return "text";
  if (restSame && t0 === t1 && r0 && r1) {
    if (r0.w === r1.w && r0.h === r1.h) return "moved";
    return "resized";
  }
  // Text that changed the size (an autosized label): still an edit of its text.
  if (t0 !== t1) return "text";
  return "changed";
}

/** What one change did, in a few words ("" if nothing worth saying). */
export function summarize(changes: MapChange[]): string {
  const parts: string[] = [];
  const of = (map: string) => changes.filter((c) => c.map === map);
  const nodes = of("nodes"), edges = of("edges");

  const added = nodes.filter((c) => c.old === undefined && c.now !== undefined);
  const deleted = nodes.filter((c) => c.now === undefined && c.old !== undefined);
  const updated = nodes.filter((c) => c.old !== undefined && c.now !== undefined);
  if (added.length) parts.push(`added ${things(added.map((c) => c.now as Obj), ["box", "boxes"], nodeName)}`);
  if (deleted.length) parts.push(`deleted ${things(deleted.map((c) => c.old as Obj), ["box", "boxes"], nodeName)}`);
  const byKind = new Map<string, Obj[]>();
  for (const c of updated) {
    const k = nodeChange(c.old as Obj, c.now as Obj);
    byKind.set(k, [...(byKind.get(k) ?? []), c.now as Obj]);
  }
  for (const [k, list] of byKind) {
    const what = things(list, ["box", "boxes"], nodeName);
    parts.push(k === "text" ? `edited the text of ${what}` : `${k} ${what}`);
  }

  const eAdded = edges.filter((c) => c.old === undefined && c.now !== undefined);
  const eDeleted = edges.filter((c) => c.now === undefined && c.old !== undefined);
  const eUpdated = edges.filter((c) => c.old !== undefined && c.now !== undefined);
  // A connector that follows a moved box isn't changed itself; one deleted with its box isn't
  // worth saying either.
  if (eAdded.length) parts.push(`added ${things(eAdded.map((c) => c.now as Obj), ["connector", "connectors"], edgeName)}`);
  if (eDeleted.length && !deleted.length) parts.push(`deleted ${things(eDeleted.map((c) => c.old as Obj), ["connector", "connectors"], edgeName)}`);
  if (eUpdated.length) {
    const labels = eUpdated.filter((c) => (c.old as Obj).label !== (c.now as Obj).label);
    if (labels.length === eUpdated.length) parts.push(`relabeled ${things(labels.map((c) => c.now as Obj), ["connector", "connectors"], edgeName)}`);
    else parts.push(`changed ${things(eUpdated.map((c) => c.now as Obj), ["connector", "connectors"], edgeName)}`);
  }

  const name = of("meta").find((c) => c.key === "name");
  if (name && typeof name.now === "string") parts.push(`renamed the diagram to ${quoted(name.now) || "''"}`);

  if (!parts.length && of("order").length) parts.push("changed the stacking order");
  if (!parts.length && (of("sources").length || of("locks").length)) parts.push("changed the diagram");

  if (parts.length > 2) return `made ${changes.length} changes`;
  return parts.join(", ");
}

/** "just now", "5 min ago", "3:41 PM", "Nov 12, 3:41 PM". */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date(now).toDateString() ? time : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}
