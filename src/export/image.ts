import type { Diagram } from "../model/types";
import { FONT_FAMILY, FONT_SIZE, metrics } from "../render/font";
import { exportText } from "./text";

/**
 * The diagram as a picture: SVG (text characters placed cell by cell, so it lines up in any
 * monospace font, and exactly when the font is embedded) or PNG (drawn the way the canvas is).
 * Both are the same characters as the text export, in the canvas's colors.
 */

export type ImageTheme = "light" | "dark";

export interface ImageOptions {
  ascii?: boolean;
  theme?: ImageTheme;
  /** No background fill. */
  transparent?: boolean;
  /** Blank cells around the drawing. */
  padding?: number;
}

/** The canvas colors (theme.css), so pictures look like the editor. */
export const THEMES: Record<ImageTheme, { bg: string; text: string }> = {
  light: { bg: "#eceff4", text: "#2e3440" },
  dark: { bg: "#2e3440", text: "#d8dee9" },
};

interface Layout {
  lines: string[][];
  width: number;
  height: number;
  pad: number;
  colors: { bg: string; text: string };
}

function layout(d: Diagram, opts: ImageOptions): Layout {
  const text = exportText(d, { ascii: opts.ascii });
  const lines = text ? text.split("\n").map((l) => Array.from(l)) : [];
  const cols = Math.max(0, ...lines.map((l) => l.length));
  const pad = opts.padding ?? 1;
  return {
    lines,
    width: (cols + 2 * pad) * metrics.cw,
    height: (lines.length + 2 * pad) * metrics.ch,
    pad,
    colors: THEMES[opts.theme ?? "light"],
  };
}

const escapeXml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const num = (n: number) => String(Math.round(n * 100) / 100);

/**
 * SVG text. Each run of characters gets an x position per character, so columns line up whatever
 * font the viewer ends up with. `fontData`: the font (woff2, base64) to embed, so it renders
 * exactly as here.
 */
export function exportSvg(d: Diagram, opts: ImageOptions = {}, fontData?: string): string {
  const L = layout(d, opts);
  const { cw, ch, baseline } = metrics;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${num(L.width)}" height="${num(L.height)}" viewBox="0 0 ${num(L.width)} ${num(L.height)}">`);
  if (fontData) {
    out.push(`<style>@font-face{font-family:"Source Code Pro";src:url(data:font/woff2;base64,${fontData}) format("woff2");}</style>`);
  }
  if (!opts.transparent) out.push(`<rect width="100%" height="100%" fill="${L.colors.bg}"/>`);
  out.push(`<g font-family="${escapeXml(FONT_FAMILY)}" font-size="${FONT_SIZE}" fill="${L.colors.text}" xml:space="preserve">`);
  L.lines.forEach((chars, row) => {
    const y = (row + L.pad) * ch + baseline;
    // Runs of non-space characters.
    for (let i = 0; i < chars.length; ) {
      if (chars[i] === " ") {
        i++;
        continue;
      }
      let j = i;
      while (j < chars.length && chars[j] !== " ") j++;
      const xs = chars.slice(i, j).map((_, k) => num((i + k + L.pad) * cw)).join(" ");
      out.push(`<text x="${xs}" y="${num(y)}">${escapeXml(chars.slice(i, j).join(""))}</text>`);
      i = j;
    }
  });
  out.push("</g></svg>");
  return out.join("\n") + "\n";
}

/** PNG (browser only), at `scale` times the screen size (2: sharp on high-density screens). */
export function exportPng(d: Diagram, opts: ImageOptions = {}, scale = 2): Promise<Blob> {
  const L = layout(d, opts);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(L.width * scale));
  canvas.height = Math.max(1, Math.ceil(L.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  if (!opts.transparent) {
    ctx.fillStyle = L.colors.bg;
    ctx.fillRect(0, 0, L.width, L.height);
  }
  ctx.fillStyle = L.colors.text;
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`;
  ctx.textBaseline = "alphabetic";
  L.lines.forEach((chars, row) => {
    chars.forEach((c, col) => {
      if (c !== " ") ctx.fillText(c, (col + L.pad) * metrics.cw, (row + L.pad) * metrics.ch + metrics.baseline);
    });
  });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no PNG"))), "image/png"));
}

/** The editor's font as base64, for embedding in SVGs (null if it can't be fetched). */
export async function fontBase64(): Promise<string | null> {
  try {
    const res = await fetch(new URL("fonts/SourceCodePro-Regular.woff2", document.baseURI));
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  } catch {
    return null;
  }
}
