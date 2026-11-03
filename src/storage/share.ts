import { Base64 } from "js-base64";
import { deflate, inflate } from "pako";
import { isDiagram } from "../model/ops";
import type { Diagram } from "../model/types";

/** A diagram as a URL-safe string: JSON, deflated, base64 (as asciidraw/ASCIIFlow share links). */
export function encodeShare(d: Diagram, name: string): string {
  const bytes = deflate(new TextEncoder().encode(JSON.stringify({ name, diagram: d })));
  return Base64.fromUint8Array(bytes, true);
}

export function decodeShare(s: string): { name: string; diagram: Diagram } | null {
  try {
    const json = new TextDecoder().decode(inflate(Base64.toUint8Array(s)));
    const obj = JSON.parse(json);
    return isDiagram(obj?.diagram) ? { name: String(obj.name ?? "Shared diagram"), diagram: obj.diagram } : null;
  } catch {
    return null;
  }
}

export function shareUrl(d: Diagram, name: string): string {
  return `${location.origin}${location.pathname}#/share/${encodeShare(d, name)}`;
}
