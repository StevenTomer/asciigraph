import { isDiagram } from "../model/ops";
import type { Diagram } from "../model/types";

export function download(filename: string, content: string | Blob, type: string) {
  const url = URL.createObjectURL(typeof content === "string" ? new Blob([content], { type }) : content);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeFilename = (name: string) => name.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "diagram";

export function downloadDiagram(name: string, d: Diagram) {
  download(`${safeFilename(name)}.asciigraph.json`, JSON.stringify({ name, diagram: d }, null, 1), "application/json");
}

/** Read a diagram exported by downloadDiagram (or a bare diagram object). */
export async function readDiagramFile(file: File): Promise<{ name: string; diagram: Diagram }> {
  const obj = JSON.parse(await file.text());
  if (isDiagram(obj?.diagram)) return { name: String(obj.name ?? file.name), diagram: obj.diagram };
  if (isDiagram(obj)) return { name: file.name.replace(/\..*$/, ""), diagram: obj };
  throw new Error("That file isn't an asciigraph diagram.");
}
