import { deleteObjects, freeEndpoint, updateEdge, updateNode } from "../model/ops";
import { arrange } from "../editor/commands";
import type { BorderStyle, Edge, HAlign, LineStyle, Node, VAlign } from "../model/types";
import { apply, begin, commit, getState, select, set, useEditor } from "../editor/store";

const BORDERS: [BorderStyle, string][] = [
  ["single", "single"], ["double", "double"], ["rounded", "rounded"], ["heavy", "heavy"],
  ["dashed", "dashed"], ["dotted", "dotted"], ["ascii", "ascii"], ["none", "none"],
];
const LINES: [LineStyle, string][] = [
  ["single", "───"], ["double", "═══"], ["heavy", "━━━"], ["dashed", "┄┄┄"], ["dotted", "┈┈┈"], ["ascii", "---"],
];
const HALIGN: [HAlign, string][] = [["left", "left"], ["center", "centre"], ["right", "right"]];
const VALIGN: [VAlign, string][] = [["top", "top"], ["middle", "middle"], ["bottom", "bottom"]];

/** Properties of the selection. Changes apply to every selected node / edge. */
export function Inspector() {
  const selection = useEditor((s) => s.selection);
  const diagram = useEditor((s) => s.diagram);
  const nodes = selection.map((id) => diagram.nodes[id]).filter(Boolean) as Node[];
  const edges = selection.map((id) => diagram.edges[id]).filter(Boolean) as Edge[];
  if (!nodes.length && !edges.length) return null;

  const eachNode = (patch: (n: Node) => Partial<Node>) =>
    apply((d) => nodes.reduce((acc, n) => updateNode(acc, n.id, patch(n)), d));
  const eachEdge = (patch: (e: Edge) => Partial<Edge>) =>
    apply((d) => edges.reduce((acc, e) => updateEdge(acc, e.id, patch(e)), d));
  const n0 = nodes[0], e0 = edges[0];

  return (
    <aside className="inspector" aria-label="Properties">
      {n0 && (
        <section>
          <h3>{nodes.length > 1 ? `${nodes.length} boxes` : n0.border === "none" ? "text" : "box"}</h3>
          <Row label="border">
            {BORDERS.map(([v, sample]) => (
              <Choice key={v} active={n0.border === v} onClick={() => eachNode(() => ({ border: v }))} title={v}>
                {sample}
              </Choice>
            ))}
          </Row>
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
          {nodes.length === 1 && n0.border !== "none" && (
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
          <h3>{edges.length > 1 ? `${edges.length} connectors` : "connector"}</h3>
          <Row label="line">
            {LINES.map(([v, sample]) => (
              <Choice key={v} active={e0.line === v} onClick={() => eachEdge(() => ({ line: v }))} title={v} label={v}>{sample}</Choice>
            ))}
          </Row>
          <Row label="arrows">
            <Choice active={e0.arrows.start} onClick={() => eachEdge((e) => ({ arrows: { ...e.arrows, start: !e0.arrows.start } }))} title="arrow at start" label="arrow at start">◄─</Choice>
            <Choice active={e0.arrows.end} onClick={() => eachEdge((e) => ({ arrows: { ...e.arrows, end: !e0.arrows.end } }))} title="arrow at end" label="arrow at end">─►</Choice>
          </Row>
          {edges.length === 1 && (
            <Row label="label">
              <input
                className="field"
                value={e0.label ?? ""}
                placeholder="(none)"
                onFocus={begin}
                onBlur={commit}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                onChange={(e) => set(updateEdge(getState().diagram, e0.id, { label: e.target.value || undefined }))}
                aria-label="Label"
              />
            </Row>
          )}
          {edges.length === 1 && e0.via?.length ? (
            <Row label="bends">
              <span className="row-text">{e0.via.length}</span>
              <Choice active={false} onClick={() => apply((d) => updateEdge(d, e0.id, { via: undefined }))} title="Remove all bend points">straighten</Choice>
            </Row>
          ) : null}
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
      <section className="actions">

        <button className="tb danger" onClick={() => { apply((d) => deleteObjects(d, selection)); select([]); }}>delete</button>
      </section>
    </aside>
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
function Choice(props: { active: boolean; onClick: () => void; title?: string; label?: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      className={"choice" + (props.active ? " active" : "")}
      onClick={props.onClick}
      title={props.title}
      aria-label={props.label}
      disabled={props.disabled}
      aria-pressed={props.active}
    >
      {props.children}
    </button>
  );
}
