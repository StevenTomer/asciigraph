import { useEditor } from "../editor/store";
import { ZOOM_STEPS, zoomReset, zoomStep, zoomToFit, zoomToSelection } from "../editor/view";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";

/** Zoom is rounded so rows are whole pixels (1.25 may become 1.238): show the step it came from. */
const label = (z: number) => Math.round(100 * (ZOOM_STEPS.find((s) => Math.abs(s - z) < 0.03) ?? z));

/** Bottom-right: zoom out / current zoom (click: back to 100%) / zoom in / fit the drawing. */
export function ZoomControls() {
  const zoom = useEditor((s) => s.view.zoom);
  const selected = useEditor((s) => s.selection.length > 0);
  return (
    <div className="zoom" role="group" aria-label="Zoom">
      <button className="tb" onClick={() => zoomStep(-1)} title={`Zoom out (${mod}−)`} aria-label="Zoom out">−</button>
      <button className="tb pct" onClick={zoomReset} title={`Reset to 100% (${mod}0)`} aria-label="Reset zoom" data-testid="zoom-level">
        {label(zoom)}%
      </button>
      <button className="tb" onClick={() => zoomStep(1)} title={`Zoom in (${mod}+)`} aria-label="Zoom in">+</button>
      <button className="tb" onClick={zoomToFit} title="Zoom to fit the drawing (Shift+1)">fit</button>
      {selected && <button className="tb" onClick={zoomToSelection} title="Zoom to the selection (Shift+2)">selection</button>}
    </div>
  );
}
