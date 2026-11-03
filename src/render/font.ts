/**
 * Canvas font and character cell size. Adapted from asciidraw/ASCIIFlow (client/font.ts): load
 * Source Code Pro (self-hosted, see index.html) and measure the cell at startup so the grid,
 * hit-testing and text all agree.
 */

export const FONT_FAMILY = "'Source Code Pro', monospace";
export const FONT_SIZE = 15;
export const FONT_SPEC = `${FONT_SIZE}px ${FONT_FAMILY}`;

export const metrics = {
  /** Cell width and height in px at zoom 1. */
  cw: 9,
  ch: 18,
  /** Distance from a cell's top to the text baseline. */
  baseline: 14,
  /** The font's real advance width (cw is rounded up); the text editor uses it to line up. */
  advance: 9,
};

export async function initFont(): Promise<void> {
  try {
    await Promise.race([document.fonts.load(FONT_SPEC), new Promise((r) => setTimeout(r, 3000))]);
  } catch {
    // No font loading API, or it failed: the monospace fallback still works.
  }
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = FONT_SPEC;
  const m = ctx.measureText("M");
  metrics.advance = m.width;
  metrics.cw = Math.ceil(m.width);
  // Box-drawing characters reach past the em box so they tile; size rows to │ so they touch.
  const bar = ctx.measureText("│");
  if (bar.actualBoundingBoxAscent !== undefined && bar.actualBoundingBoxDescent !== undefined) {
    const ascent = Math.ceil(bar.actualBoundingBoxAscent);
    metrics.ch = ascent + Math.ceil(bar.actualBoundingBoxDescent);
    metrics.baseline = ascent;
  } else {
    metrics.ch = Math.ceil(FONT_SIZE * 1.2);
    metrics.baseline = FONT_SIZE;
  }
}
