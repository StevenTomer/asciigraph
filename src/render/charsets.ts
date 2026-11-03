import type { Side } from "../geometry/geom";
import type { LineStyle } from "../model/types";

/**
 * Glyphs by connection directions. A cell's strokes are a bitmask of the directions it connects
 * to; the glyph is looked up once, after everything is drawn, so junctions (├ ┬ ┼, a connector
 * meeting a border) fall out of the bitmask instead of being patched character by character.
 * The single-line and ASCII sets match asciidraw/ASCIIFlow (client/constants.ts UNICODE, ASCII).
 */
export const UP = 1, RIGHT = 2, DOWN = 4, LEFT = 8;

export const SIDE_BIT: Record<Side, number> = { top: UP, right: RIGHT, bottom: DOWN, left: LEFT };

// Order: [vertical, horizontal, ┌, ┐, └, ┘, ├, ┤, ┬, ┴, ┼]
const SETS: Record<LineStyle, string> = {
  single: "│─┌┐└┘├┤┬┴┼",
  double: "║═╔╗╚╝╠╣╦╩╬",
  heavy: "┃━┏┓┗┛┣┫┳┻╋",
  ascii: "|-++++++++++",
};
const ROUNDED_CORNERS = "╭╮╰╯";

function table(chars: string): Map<number, string> {
  const [v, h, tl, tr, bl, br, jr, jl, jd, ju, all] = Array.from(chars);
  return new Map([
    [UP, v], [DOWN, v], [UP | DOWN, v],
    [LEFT, h], [RIGHT, h], [LEFT | RIGHT, h],
    [DOWN | RIGHT, tl], [DOWN | LEFT, tr], [UP | RIGHT, bl], [UP | LEFT, br],
    [UP | DOWN | RIGHT, jr], [UP | DOWN | LEFT, jl],
    [LEFT | RIGHT | DOWN, jd], [LEFT | RIGHT | UP, ju],
    [UP | DOWN | LEFT | RIGHT, all],
  ]);
}

const TABLES = Object.fromEntries(
  Object.entries(SETS).map(([style, chars]) => [style, table(chars)])
) as Record<LineStyle, Map<number, string>>;

const ROUNDED = new Map([
  [DOWN | RIGHT, ROUNDED_CORNERS[0]],
  [DOWN | LEFT, ROUNDED_CORNERS[1]],
  [UP | RIGHT, ROUNDED_CORNERS[2]],
  [UP | LEFT, ROUNDED_CORNERS[3]],
]);

export function lineGlyph(mask: number, style: LineStyle, rounded: boolean): string {
  if (rounded && style === "single") {
    const corner = ROUNDED.get(mask);
    if (corner) return corner;
  }
  return TABLES[style].get(mask) ?? " ";
}

/** Arrowheads, by the direction they point. */
const ARROWS: Record<"unicode" | "ascii", Record<Side, string>> = {
  unicode: { top: "▲", right: "►", bottom: "▼", left: "◄" },
  ascii: { top: "^", right: ">", bottom: "v", left: "<" },
};

export function arrowGlyph(pointing: Side, style: LineStyle): string {
  return ARROWS[style === "ascii" ? "ascii" : "unicode"][pointing];
}

/** When strokes of different styles meet in a cell, the heavier one wins. */
export const STYLE_WEIGHT: Record<LineStyle, number> = { ascii: 0, single: 1, double: 2, heavy: 3 };
