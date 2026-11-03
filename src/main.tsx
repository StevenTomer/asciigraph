import { createRoot } from "react-dom/client";
import "./ui/theme.css";
import "./ui/app.css";
import { exportText } from "./export/text";
import { loadPrefs } from "./editor/session";
import { getState } from "./editor/store";
import { cellCenter } from "./editor/view";
import { initFont, metrics } from "./render/font";
import { App } from "./ui/App";
import { paintCount } from "./ui/Canvas";

// For end-to-end tests: read state and convert cells to screen positions.
(window as unknown as { __asciigraph__: unknown }).__asciigraph__ = {
  text: () => exportText(getState().diagram),
  state: () => getState(),
  cellCenter: (x: number, y: number) => cellCenter({ x, y }),
  metrics: () => ({ ...metrics }),
  paints: () => paintCount,
};

loadPrefs();
void initFont().then(() => createRoot(document.getElementById("root")!).render(<App />));
