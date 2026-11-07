import { withContents } from "../model/containment";
import { moveWithLocks } from "../model/locks";
import { deleteSelection, duplicateCommand } from "./clipboard";
import { arrange, selectAll } from "./commands";
import { keys } from "./input";
import {
  type ToolId, apply, editCell, getState, openFind, redo, select, setOverlay, setTool, startEditing, undo,
} from "./store";
import { TOOLS } from "./tools";
import { tableOp } from "./tableCommands";
import { parseTable } from "../shapes/table";
import { openFile, saveFile, saveFileAs } from "./file";
import { formatOf } from "../storage/diskFile";
import { zoomReset, zoomStep, zoomToFit, zoomToSelection } from "./view";

const SHORTCUTS = new Map<string, ToolId>(TOOLS.map((t) => [t.key ?? t.label[0], t.id]));

/** Keys typed into a field (text editor, inspector, dialogs) aren't shortcuts. */
function inField(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export function attachKeyboard(): () => void {
  const down = (e: KeyboardEvent) => {
    if (inField(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (mod) {
      if (k === "z") {
        e.shiftKey ? redo() : undo();
        e.preventDefault();
      } else if (k === "y") {
        redo();
        e.preventDefault();
      } else if (k === "a") {
        selectAll();
        e.preventDefault();
      } else if (k === "f") {
        openFind();
        e.preventDefault();
      } else if (k === "s") {
        // Ctrl+S: save to the diagram's file (none yet: save as Markdown); with Shift, as a new one.
        const f = getState().file;
        if (e.shiftKey) void saveFileAs(f ? formatOf(f.name) : "markdown");
        else void saveFile();
        e.preventDefault();
      } else if (k === "o") {
        void openFile();
        e.preventDefault();
      } else if (k === "=" || k === "+" || k === "-" || k === "0") {
        // Zoom the drawing, not the page.
        if (k === "0") zoomReset();
        else zoomStep(k === "-" ? -1 : 1);
        e.preventDefault();
      } else if (k === "d") {
        duplicateCommand();
        e.preventDefault();
      } else if (e.code === "BracketRight" || e.code === "BracketLeft") {
        // Ctrl+] / Ctrl+[ forward / backward; with Shift, all the way.
        const front = e.code === "BracketRight";
        (front ? (e.shiftKey ? arrange.bringToFront : arrange.bringForward)
               : (e.shiftKey ? arrange.sendToBack : arrange.sendBackward))();
        e.preventDefault();
      }
      return; // copy/cut/paste arrive as clipboard events (clipboard.ts)
    }

    if (e.shiftKey && (e.code === "Digit1" || e.code === "Digit2")) {
      (e.code === "Digit1" ? zoomToFit : zoomToSelection)();
      e.preventDefault();
      return;
    }

    // Tool shortcuts: plain letter or Alt+letter. Uses `code` so Alt+letter works on macOS too.
    const letter = e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : k;
    const tool = SHORTCUTS.get(letter);
    if (tool && !e.shiftKey) {
      setTool(tool);
      e.preventDefault();
      return;
    }

    const { selection, diagram } = getState();
    switch (k) {
      case " ":
        // Space: back to select (not mid-drag), and hold it to pan by dragging.
        keys.space = true;
        if (!e.repeat && !getState().pending) setTool("select");
        e.preventDefault();
        return;
      case "Escape":
        select([]);
        setOverlay({});
        setTool("select");
        return;
      case "Delete":
      case "Backspace":
        if (selection.length) {
          deleteSelection();
          e.preventDefault();
        }
        return;
      case "Enter":
      case "F2": // as in file managers and spreadsheets
        if (selection.length === 1 && diagram.nodes[selection[0]]?.kind === "table" && parseTable(diagram.nodes[selection[0]].text).rows.length) {
          // A table: the cell last clicked, or the first one.
          const { tableCell } = getState();
          editCell(selection[0], tableCell?.node === selection[0] ? tableCell : { row: 0, col: 0 });
          e.preventDefault();
        } else if (selection.length === 1 && (diagram.nodes[selection[0]] || diagram.edges[selection[0]])) {
          startEditing(selection[0], diagram.edges[selection[0]] ? "label" : "text");
          e.preventDefault();
        }
        return;
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight": {
        if (!selection.length) return;
        // A tree table's current row: Alt+Shift+→ / ← indents / outdents it.
        const tc = getState().tableCell;
        if (e.altKey && e.shiftKey && (k === "ArrowLeft" || k === "ArrowRight") && tc && selection.length === 1 && tc.node === selection[0] && diagram.nodes[tc.node]?.table?.tree) {
          tableOp(tc.node, k === "ArrowRight" ? "rowIndent" : "rowOutdent", tc);
          e.preventDefault();
          return;
        }
        const n = e.shiftKey ? 5 : 1;
        const delta = {
          x: k === "ArrowLeft" ? -n : k === "ArrowRight" ? n : 0,
          y: k === "ArrowUp" ? -n : k === "ArrowDown" ? n : 0,
        };
        apply((d) => moveWithLocks(d, withContents(d, selection), delta));
        e.preventDefault();
        return;
      }
    }
  };
  const up = (e: KeyboardEvent) => {
    if (e.key === " ") keys.space = false;
  };
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  return () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
  };
}
