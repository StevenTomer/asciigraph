import { useEffect, useLayoutEffect, useRef } from "react";
import { reveal, whenIdle } from "../editor/view";
import { deleteObjects, freeEndpoint, headOf, updateEdge, updateNode, withHead } from "../model/ops";
import { HEAD_NAMES, arrowGlyph } from "../render/charsets";
import { arrange } from "../editor/commands";
import { locksOf, unlock } from "../model/locks";
import { SHAPE_KINDS, shapeFor } from "../shapes/registry";
import { type BorderStyle, type Edge, type HAlign, type LineStyle, type Node, type VAlign, HEADS } from "../model/types";
import { apply, begin, commit, getState, openBannerDialog, openTextDialog, select, set, setPrefs, startEditing, useEditor } from "../editor/store";
import { TABLE_OPS, canTableOp, columnAlign, tableOp } from "../editor/tableCommands";
import { directionOf, setDirection, unlinkSource } from "../text/sync";
import { canShrinkToText, sameSize, shrinkToText } from "../model/size";
import { withoutPoints } from "../shapes/timeline";
import { autoSized, columnRooms, markdownTable, parseTable, withColumnWidth, withOptions, withTitle } from "../shapes/table";

const BORDERS: [BorderStyle, string][] = [
  ["single", "single"], ["double", "double"], ["rounded", "rounded"], ["heavy", "heavy"],
  ["dashed", "dashed"], ["dotted", "dotted"], ["ascii", "ascii"], ["none", "none"],
];
const LINES: [LineStyle, string][] = [
  ["single", "───"], ["double", "═══"], ["heavy", "━━━"], ["dashed", "┄┄┄"], ["dotted", "┈┈┈"], ["ascii", "---"],
];
const HALIGN: [HAlign, string][] = [["left", "left"], ["center", "center"], ["right", "right"]];
const VALIGN: [VAlign, string][] = [["top", "top"], ["middle", "middle"], ["bottom", "bottom"]];

/**
 * Properties of the selection. Changes apply to every selected node / edge.
 *
 * Top right on wide screens; a sheet along the bottom on narrow ones (app.css). Either way its
 * title bar collapses it, remembered across visits. Its height is published as --panel-h so the
 * zoom controls can sit above the bottom sheet, and on a narrow screen the drawing scrolls to
 * keep the selection clear of the sheet.
 */
export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const diagram = useEditor((s) => s.diagram);
  const open = useEditor((s) => s.panelOpen);
  const nodes = selection.map((id) => diagram.nodes[id]).filter(Boolean) as Node[];
  const edges = selection.map((id) => diagram.edges[id]).filter(Boolean) as Edge[];
  const shown = nodes.length > 0 || edges.length > 0;
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const root = document.documentElement.style;
    if (!el) return;
    const publish = () => root.setProperty("--panel-h", `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.removeProperty("--panel-h");
    };
  }, [shown]);
  // As a bottom sheet, keep what's selected in view: between the toolbar and the sheet.
  const selected = selection.join(",");
  useEffect(() => {
    if (!shown || !window.matchMedia("(max-width: 640px)").matches) return;
    whenIdle(() => {
      const el = ref.current;
      if (!el) return;
      const top = document.querySelector(".toolbar-wrap")?.getBoundingClientRect().bottom ?? 0;
      // Clear of the zoom controls too, which sit just above the sheet.
      const zoom = document.querySelector(".zoom")?.getBoundingClientRect().top ?? Infinity;
      reveal(top, Math.min(el.getBoundingClientRect().top, zoom));
    });
  }, [selected, open, shown]);
  if (!shown) return null;

  const eachNode = (patch: (n: Node) => Partial<Node>) =>
    apply((d) => nodes.reduce((acc, n) => updateNode(acc, n.id, patch(n)), d));
  const eachEdge = (patch: (e: Edge) => Partial<Edge>) =>
    apply((d) => edges.reduce((acc, e) => updateEdge(acc, e.id, patch(e)), d));
  const n0 = nodes[0], e0 = edges[0];
  // Drawn from text? (Offer to edit that text when the whole selection comes from one source.)
  const sources = new Set([...nodes, ...edges].map((o) => o.gen?.source));
  const sourceOf = sources.size === 1 ? [...sources][0] : undefined;
  // Locked to other things? Say with how many, and which way.
  const locks = [...new Map(nodes.flatMap((n) => locksOf(diagram, n.id)).map((l) => [l.id, l])).values()];
  const together = new Set(locks.flatMap((l) => l.members)).size;
  const ways = [...new Set(locks.map((l) => (l.x && l.y ? "both ways" : l.x ? "left–right" : "up–down")))];
  const lockInfo = locks.length ? `${together} together, ${ways.join(", ")}` : null;
  const source = sourceOf ? diagram.sources?.[sourceOf] : undefined;
  const direction = source ? directionOf(source) : null;
  const what = [
    nodes.length && (nodes.length > 1 ? `${nodes.length} boxes` : n0.border === "none" ? "text" : "box"),
    edges.length && (edges.length > 1 ? `${edges.length} connectors` : "connector"),
  ].filter(Boolean).join(", ");
  const toggle = () => setPrefs({ panelOpen: !open });

  return (
    <aside ref={ref} className={"inspector" + (open ? "" : " collapsed")} aria-label="Properties">
      <button className="panel-head" onClick={toggle} aria-expanded={open} title={open ? "Collapse the panel" : "Show the properties"}>
        <span className="panel-what">{what}</span>
        <span className="panel-toggle" aria-hidden="true">{open ? "▾ hide" : "▸ show"}</span>
      </button>
      {open && <div className="panel-body">
      {n0 && (
        <section>
          {e0 && <h3>{nodes.length > 1 ? `${nodes.length} boxes` : n0.border === "none" ? "text" : "box"}</h3>}
          <Row label="shape">
            {SHAPE_KINDS.map((k) => (
              <Choice key={k} active={n0.kind === k} onClick={() => eachNode(() => ({ kind: k }))}>{shapeFor(k).label}</Choice>
            ))}
          </Row>
          <Row label="border">
            {BORDERS.map(([v, sample]) => (
              <Choice key={v} active={n0.border === v} onClick={() => eachNode(() => ({ border: v }))} title={v}>
                {sample}
              </Choice>
            ))}
          </Row>
          {/* (A table lines up each column itself, and doesn't draw lists.) */}
          {!nodes.every((n) => n.kind === "table" || n.kind === "timeline") && (
            <>
          <Row label="text">
            {HALIGN.map(([v, l]) => (
              <Choice key={v} active={n0.align.h === v} onClick={() => eachNode((n) => ({ align: { ...n.align, h: v } }))}>{l}</Choice>
            ))}
          </Row>
          <Row label="">
            {VALIGN.map(([v, l]) => (
              <Choice key={v} active={n0.align.v === v} onClick={() => eachNode((n) => ({ align: { ...n.align, v } }))}>{l}</Choice>
            ))}
          </Row>
          <Row label="lists">
            <Choice active={n0.lists !== false} onClick={() => eachNode(() => ({ lists: undefined }))} title="Lines starting - * + or 1. are shown as lists, and - [ ] / - [x] as a checklist (a \ before the marker keeps one line as typed)">
              on
            </Choice>
            <Choice active={n0.lists === false} onClick={() => eachNode(() => ({ lists: false }))} title="Show the text exactly as typed">
              off (text as typed)
            </Choice>
          </Row>
            </>
          )}
          {n0.border !== "none" && (
            <Row label="inside">
              <Choice active={n0.carry !== false} onClick={() => eachNode(() => ({ carry: undefined }))} title="Moving this box moves what's inside it (Alt-drag moves just the box)">
                moves with it
              </Choice>
              <Choice active={n0.carry === false} onClick={() => eachNode(() => ({ carry: false }))} title="Moving this box leaves what's inside where it is">
                stays put
              </Choice>
            </Row>
          )}
          {nodes.length === 1 && (n0.kind === "box" || n0.kind === "frame") && n0.border !== "none" && (
            <>
              <Row label="name">
                <input
                  className="field"
                  value={n0.name ?? ""}
                  placeholder="(none)"
                  onFocus={begin}
                  onBlur={commit}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  onChange={(e) => set(updateNode(getState().diagram, n0.id, { name: e.target.value || undefined }))}
                  aria-label="Name"
                />
              </Row>
              {n0.name && (
                <Row label="">
                  {HALIGN.map(([v, l]) => (
                    <Choice key={v} active={(n0.nameAlign ?? "left") === v} onClick={() => eachNode(() => ({ nameAlign: v }))}>{l}</Choice>
                  ))}
                </Row>
              )}
            </>
          )}
          {nodes.length === 1 && n0.kind === "table" && <TableRows node={n0} />}
          {nodes.length === 1 && n0.kind === "timeline" && (
            <>
              <Row label="timeline">
                <Choice active={n0.timeline?.direction !== "down"} onClick={() => eachNode((n) => ({ timeline: undefined, ...refit(n, undefined) }))} title="Periods along a line across, events under each">across</Choice>
                <Choice active={n0.timeline?.direction === "down"} onClick={() => eachNode((n) => ({ timeline: { direction: "down" }, ...refit(n, { direction: "down" }) }))} title="Periods down a line, events beside each">down</Choice>
              </Row>
              <Row label="">
                <Choice active={false} onClick={() => startEditing(n0.id, "text")} title="Periods and events, as Mermaid timeline lines: 2024 : Plan : Design">edit events</Choice>
                <Choice active={false} disabled={!n0.timeline?.at} onClick={() => eachNode((n) => withoutPoints(n))} title="Points moved by hand (drag one along the line) go back where they go by themselves">space evenly</Choice>
              </Row>
            </>
          )}
          {nodes.length === 1 && n0.banner && (
            <Row label="banner">
              <Choice active={false} onClick={() => openBannerDialog(n0.id)} title={`"${n0.banner.text}" in ${n0.banner.font}: change the words or the font`}>change…</Choice>
            </Row>
          )}
          <Row label="size">
            <Choice
              active={false}
              disabled={!canShrinkToText(diagram, nodes.map((n) => n.id))}
              onClick={() => apply((d) => shrinkToText(d, nodes.map((n) => n.id)))}
              title="The smallest size that shows the text without wrapping"
            >
              shrink to text
            </Choice>
          </Row>
          {nodes.length > 1 && (
            <Row label="">
              <Choice active={false} onClick={() => apply((d) => sameSize(d, nodes.map((n) => n.id), { w: true, h: false }))} title="Normalize: all as wide as the widest">same width</Choice>
              <Choice active={false} onClick={() => apply((d) => sameSize(d, nodes.map((n) => n.id), { w: false, h: true }))} title="Normalize: all as tall as the tallest">same height</Choice>
            </Row>
          )}
          <Row label="order">
            <Choice active={false} onClick={arrange.sendToBack} title="Send to Back (Ctrl+Shift+[)">to back</Choice>
            <Choice active={false} onClick={arrange.bringToFront} title="Bring to Front (Ctrl+Shift+])">to front</Choice>
          </Row>
          <Row label="">
            <Choice active={false} onClick={arrange.sendBackward} title="Send Backward (Ctrl+[)">backward</Choice>
            <Choice active={false} onClick={arrange.bringForward} title="Bring Forward (Ctrl+])">forward</Choice>
          </Row>
        </section>
      )}
      {e0 && (
        <section>
          {n0 && <h3>{edges.length > 1 ? `${edges.length} connectors` : "connector"}</h3>}
          <Row label="line">
            {LINES.map(([v, sample]) => (
              <Choice key={v} active={e0.line === v} onClick={() => eachEdge(() => ({ line: v }))} title={v} label={v}>{sample}</Choice>
            ))}
          </Row>
          {(["start", "end"] as const).map((which) => (
            <Row key={which} label={which}>
              {[null, ...HEADS].map((h) => {
                const glyph = h ? arrowGlyph(which === "start" ? "left" : "right", "single", h) : "─";
                return (
                  <Choice
                    key={h ?? "none"}
                    active={headOf(e0, which) === h}
                    onClick={() => eachEdge((e) => withHead(e, which, h))}
                    title={`${HEAD_NAMES[h ?? "none"]} at ${which}`}
                    label={`${HEAD_NAMES[h ?? "none"]} at ${which}`}
                  >
                    {which === "start" ? glyph + "─" : "─" + glyph}
                  </Choice>
                );
              })}
            </Row>
          ))}
          {edges.length === 1 && (
            <Row label="label">
              <textarea
                className="field"
                rows={Math.min(6, (e0.label ?? "").split("\n").length)}
                value={e0.label ?? ""}
                placeholder="(none)"
                title="Enter: done · Shift+Enter: new line"
                onFocus={begin}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    (e.target as HTMLTextAreaElement).blur();
                  }
                }}
                onChange={(e) => set(updateEdge(getState().diagram, e0.id, { label: e.target.value || undefined }))}
                aria-label="Label"
              />
            </Row>
          )}
          {edges.length === 1 && e0.turnAt !== undefined ? (
            <Row label="turn">
              <span className="row-text">{Math.round(e0.turnAt * 100)}% of the way</span>
              <Choice active={false} onClick={() => apply((d) => updateEdge(d, e0.id, { turnAt: undefined }))} title="Turn halfway between the ends again">halfway</Choice>
            </Row>
          ) : null}
          {edges.length === 1 && e0.via?.length ? (
            <Row label="bends">
              <span className="row-text">{e0.via.length}</span>
              <Choice active={false} onClick={() => apply((d) => updateEdge(d, e0.id, { via: undefined }))} title="Remove all bend points">straighten</Choice>
            </Row>
          ) : null}
          {edges.length === 1 && (
            <Row label="end labels">
              {(["start", "end"] as const).map((which) => (
                <input
                  key={which}
                  className="field end-label"
                  value={e0.endLabels?.[which] ?? ""}
                  placeholder={`at ${which}`}
                  title={`Short text by the ${which} (how many: 1, 0..*; a role; a port)`}
                  aria-label={`End label at ${which}`}
                  onFocus={begin}
                  onBlur={commit}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  onChange={(e) => {
                    const v = e.target.value;
                    const cur = getState().diagram.edges[e0.id].endLabels ?? {};
                    const next = { ...cur, [which]: v || undefined };
                    if (!next.start) delete next.start;
                    if (!next.end) delete next.end;
                    set(updateEdge(getState().diagram, e0.id, { endLabels: Object.keys(next).length ? next : undefined }));
                  }}
                />
              ))}
            </Row>
          )}
          {edges.length === 1 && (
            <Row label="ends">
              {(["from", "to"] as const).map((which) => (
                <Choice
                  key={which}
                  active={false}
                  disabled={e0[which].kind === "free"}
                  onClick={() => apply((d) => updateEdge(d, e0.id, { [which]: freeEndpoint(d, d.edges[e0.id], which) }))}
                  title={e0[which].kind === "free" ? "not attached" : "detach this end"}
                >
                  {e0[which].kind === "free" ? `${which === "from" ? "start" : "end"} free` : `detach ${which === "from" ? "start" : "end"}`}
                </Choice>
              ))}
            </Row>
          )}
        </section>
      )}
      {lockInfo && (
        <section>
          <Row label="locked">
            <span className="row-text">{lockInfo}</span>
            <Choice active={false} onClick={() => apply((d) => unlock(d, nodes.map((n) => n.id)))} title="Stop moving together">unlock</Choice>
          </Row>
        </section>
      )}
      {!sourceOf && nodes.length > 0 && (
        <section>
          <Row label="as text">
            <Choice active={false} onClick={() => openTextDialog(null, selection)} title="Edit the selection as Mermaid text">edit as text</Choice>
          </Row>
        </section>
      )}
      {sourceOf && (
        <section>
          <Row label="from text">
            <Choice active={false} onClick={() => openTextDialog(sourceOf)} title="Edit the text this was drawn from">edit text</Choice>
            <Choice active={false} onClick={() => apply((d) => unlinkSource(d, sourceOf))} title="Keep the drawing, forget the text">unlink</Choice>
          </Row>
          {direction && (
            <Row label="layout">
              {(["down", "right"] as const).map((v) => (
                <Choice
                  key={v}
                  active={direction === v}
                  onClick={() => direction !== v && apply((d) => setDirection(d, sourceOf, v).diagram)}
                  title={v === "down" ? "Lay it out top to bottom (re-lays out everything)" : "Lay it out left to right (re-lays out everything)"}
                >
                  {v === "down" ? "top to bottom (TB)" : "left to right (LR)"}
                </Choice>
              ))}
            </Row>
          )}
        </section>
      )}
      <section className="actions">

        <button className="tb danger" onClick={() => { apply((d) => deleteObjects(d, selection)); select([]); }}>delete</button>
      </section>
      </div>}
    </aside>
  );
}

/** A timeline turned the other way: sized to fit again. */
function refit(n: Node, timeline: Node["timeline"]): Partial<Node> {
  const m = { ...n, timeline, autosize: true };
  return { autosize: true, rect: { ...n.rect, ...shapeFor("timeline").fitSize(m, n.text) } };
}

/** A table's title, column widths, wrapping, and copying it as Markdown. */
function TableRows({ node: n }: { node: Node }) {
  const t = parseTable(n.text);
  const rooms = columnRooms(n);
  const patch = (p: (n: Node) => Partial<Node>) => apply((d) => updateNode(d, n.id, p(d.nodes[n.id])));
  const copied = useRef<HTMLSpanElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdownTable(n.text));
      if (copied.current) copied.current.textContent = "copied";
    } catch {
      if (copied.current) copied.current.textContent = "couldn't copy here";
    }
  };
  return (
    <>
      <Row label="title">
        <input
          className="field"
          value={t.title ?? ""}
          placeholder="(none)"
          onFocus={begin}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          onChange={(e) => set(updateNode(getState().diagram, n.id, { text: withTitle(getState().diagram.nodes[n.id].text, e.target.value) }))}
          aria-label="Table title"
          title="The line before the table"
        />
      </Row>
      {t.title && (
        <>
          <Row label="">
            <Choice active={n.table?.title !== "border"} onClick={() => patch((m) => withOptions(m, { title: undefined }))} title="In a row of its own across the top">own row</Choice>
            <Choice active={n.table?.title === "border"} onClick={() => patch((m) => withOptions(m, { title: "border" }))} title="Set into the top border: ┌─ Title ─┐">in the border</Choice>
          </Row>
          <Row label="">
            {HALIGN.map(([v, l]) => (
              <Choice key={v} active={(n.table?.titleAlign ?? "center") === v} onClick={() => patch((m) => withOptions(m, { titleAlign: v === "center" ? undefined : v }))}>{l}</Choice>
            ))}
          </Row>
        </>
      )}
      <Row label="columns">
        {rooms.map((w, c) => {
          const set = n.table?.widths?.[c] ?? null;
          return (
            <input
              key={c}
              className="field tiny"
              type="number"
              min={1}
              max={200}
              value={set ?? ""}
              placeholder={`${w}`}
              title={set === null ? `Column ${c + 1}: sized to its text (${w}). Type a width, or drag its line on the table` : `Column ${c + 1}: ${set} wide. Clear it to size it to its text`}
              aria-label={`Column ${c + 1} width`}
              onChange={(e) => patch((m) => withColumnWidth(m, c, e.target.value ? Math.max(1, Number(e.target.value)) : null))}
            />
          );
        })}
        <Choice
          active={!n.table?.widths && !!n.autosize}
          onClick={() => patch(autoSized)}
          title="Every column as wide as its text, and the table just big enough"
        >
          auto-size
        </Choice>
      </Row>
      <CellRows node={n} />
      <Row label="long text">
        <Choice active={n.table?.wrap !== false} onClick={() => patch((m) => withOptions(m, { wrap: undefined }))} title="Text that doesn't fit its column carries on on the next line">wrap</Choice>
        <Choice active={n.table?.wrap === false} onClick={() => patch((m) => withOptions(m, { wrap: false }))} title="Text that doesn't fit its column is cut off with …">cut off …</Choice>
      </Row>
      <Row label="lists">
        <Choice active={n.table?.lists !== false} onClick={() => patch((m) => withOptions(m, { lists: undefined }))} title="Lines in a cell starting - * + or 1. are shown as lists, and - [ ] / - [x] as a checklist (indent two spaces to nest)">on</Choice>
        <Choice active={n.table?.lists === false} onClick={() => patch((m) => withOptions(m, { lists: false }))} title="Show cells exactly as typed">off (as typed)</Choice>
      </Row>
      <Row label="Markdown">
        <Choice active={false} onClick={() => void copy()} title="As a Markdown table for a document: the title in bold, line breaks as <br>">copy table</Choice>
        <span className="muted" ref={copied} aria-live="polite" />
      </Row>
      <Row label="">
        <Choice active={false} onClick={() => startEditing(n.id, "text")} title="Edit the whole table as Markdown text">edit as Markdown</Choice>
      </Row>
    </>
  );
}

/** Insert, move and delete the current cell's row and column; line up its column. */
function CellRows({ node: n }: { node: Node }) {
  const current = useEditor((s) => (s.tableCell?.node === n.id ? s.tableCell : null));
  const t = parseTable(n.text);
  if (!t.rows.length) return null;
  if (!current || current.row < 0) {
    return (
      <Row label="cells">
        <span className="row-text muted">click a cell to add, move or delete its row or column; double-click to type in it</span>
      </Row>
    );
  }
  const at = { row: Math.min(current.row, t.rows.length - 1), col: Math.min(current.col, t.cols - 1) };
  const ops = (which: "row" | "col") =>
    TABLE_OPS.filter((o) => o.op.startsWith(which)).map((o) => (
      <Choice key={o.op} active={false} keepFocus disabled={!canTableOp(n, o.op, at)} onClick={() => tableOp(n.id, o.op, at)} title={o.menu} label={o.menu}>
        {o.label}
      </Choice>
    ));
  const align = t.aligns[at.col] ?? "left";
  return (
    <>
      <Row label={`row ${at.row + 1}`}>{ops("row")}</Row>
      <Row label={`col ${at.col + 1}`}>{ops("col")}</Row>
      <Row label="">
        {HALIGN.map(([v, l]) => (
          <Choice key={v} active={align === v} keepFocus onClick={() => columnAlign(n.id, at, v)} title={`Column ${at.col + 1}: ${l}`}>{l}</Choice>
        ))}
      </Row>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className="row-items">{children}</span>
    </div>
  );
}

/** `label`: the accessible name, for buttons that show a picture (───) instead of words. */
/** `keepFocus`: clicking it doesn't take the focus (so typing in a table cell carries on). */
function Choice(props: { active: boolean; onClick: () => void; title?: string; label?: string; disabled?: boolean; keepFocus?: boolean; children: React.ReactNode }) {
  return (
    <button
      className={"choice" + (props.active ? " active" : "")}
      onClick={props.onClick}
      onMouseDown={props.keepFocus ? (e) => e.preventDefault() : undefined}
      title={props.title}
      aria-label={props.label}
      disabled={props.disabled}
      aria-pressed={props.active}
    >
      {props.children}
    </button>
  );
}
