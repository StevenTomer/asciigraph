import { type Side, OPPOSITE } from "../geometry/geom";
import type { Head, LineStyle } from "../model/types";

/**
 * Glyphs by connection directions. Each cell records, per direction (up, right, down, left), the
 * line style reaching it; the glyph is chosen once everything is drawn. Junctions (├ ┬ ┼, a
 * connector meeting a border) fall out of that, including mixed ones (a single line meeting a
 * double border: ╤ ╟; light meeting heavy: ┝ ╁). The single-line and ASCII sets match
 * asciidraw/ASCIIFlow (client/constants.ts UNICODE, ASCII).
 */
export const UP = 1, RIGHT = 2, DOWN = 4, LEFT = 8;
export const DIR_BITS = [UP, RIGHT, DOWN, LEFT];
export const SIDE_INDEX: Record<Side, number> = { top: 0, right: 1, bottom: 2, left: 3 };

/** When strokes of different styles reach a cell from the same direction, the heavier one wins. */
export const STYLE_WEIGHT: Record<LineStyle, number> = { ascii: 0, dotted: 1, dashed: 2, single: 3, double: 4, heavy: 5 };

// Uniform sets. Order: [vertical, horizontal, ┌, ┐, └, ┘, ├, ┤, ┬, ┴, ┼]
const SETS: Record<"single" | "double" | "heavy" | "ascii", string> = {
  single: "│─┌┐└┘├┤┬┴┼",
  double: "║═╔╗╚╝╠╣╦╩╬",
  heavy: "┃━┏┓┗┛┣┫┳┻╋",
  ascii: "|-++++++++++",
};
/** Dashed and dotted lines have straight glyphs only; corners and junctions use single ones. */
const DASHES: Record<"dashed" | "dotted", [string, string]> = { dashed: ["┆", "┄"], dotted: ["┊", "┈"] };
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

const TABLES = Object.fromEntries(Object.entries(SETS).map(([style, chars]) => [style, table(chars)])) as Record<
  keyof typeof SETS,
  Map<number, string>
>;

const ROUNDED = new Map([
  [DOWN | RIGHT, ROUNDED_CORNERS[0]],
  [DOWN | LEFT, ROUNDED_CORNERS[1]],
  [UP | RIGHT, ROUNDED_CORNERS[2]],
  [UP | LEFT, ROUNDED_CORNERS[3]],
]);

/**
 * Mixed-weight glyphs, keyed by the weight in each direction (up, right, down, left):
 * 0 none, 1 light, 2 heavy, 3 double. Unicode only has some mixes; others fall back to the
 * heaviest style.
 */
const MIXED = new Map<string, string>(
  (
    // light / heavy
    "┍0210 ┎0120 ┑0012 ┒0021 ┕1200 ┖2100 ┙1002 ┚2001 " +
    "┝1210 ┞2110 ┟1120 ┠2120 ┡2210 ┢1220 ┥1012 ┦2011 ┧1021 ┨2021 ┩2012 ┪1022 " +
    "┭0112 ┮0211 ┯0212 ┰0121 ┱0122 ┲0221 ┵1102 ┶1201 ┷1202 ┸2101 ┹2102 ┺2201 " +
    "┽1112 ┾1211 ┿1212 ╀2111 ╁1121 ╂2121 ╃2112 ╄2211 ╅1122 ╆1221 ╇2212 ╈1222 ╉2122 ╊2221 " +
    "╼0201 ╽1020 ╾0102 ╿2010 " +
    // single / double
    "╒0310 ╓0130 ╕0013 ╖0031 ╘1300 ╙3100 ╛1003 ╜3001 ╞1310 ╟3130 ╡1013 ╢3031 " +
    "╤0313 ╥0131 ╧1303 ╨3101 ╪1313 ╫3131"
  )
    .split(" ")
    .map((s) => [s.slice(1), s[0]] as [string, string])
);

const WEIGHT_CODE: Record<LineStyle, number> = { ascii: 1, dotted: 1, dashed: 1, single: 1, heavy: 2, double: 3 };
const CODE_STYLE = ["single", "single", "heavy", "double"] as const; // by weight code (0 unused)
const STRAIGHT = new Set([UP, DOWN, UP | DOWN, LEFT, RIGHT, LEFT | RIGHT]);

/** The glyph for a cell's strokes. `styles` is indexed by direction (up, right, down, left). */
export function lineGlyph(styles: readonly (LineStyle | undefined)[], rounded: boolean, ascii: boolean): string {
  let mask = 0;
  const present: LineStyle[] = [];
  styles.forEach((s, i) => {
    if (s) {
      mask |= DIR_BITS[i];
      present.push(s);
    }
  });
  if (!mask) return "";
  if (ascii || present.includes("ascii")) return TABLES.ascii.get(mask) ?? " ";

  const first = present[0];
  if (present.every((s) => s === first)) {
    if (first === "dashed" || first === "dotted") {
      return STRAIGHT.has(mask) ? DASHES[first][mask & (UP | DOWN) ? 0 : 1] : TABLES.single.get(mask)!;
    }
    if (rounded && first === "single") {
      const corner = ROUNDED.get(mask);
      if (corner) return corner;
    }
    return TABLES[first].get(mask) ?? " ";
  }

  const codes = styles.map((s) => (s ? WEIGHT_CODE[s] : 0));
  const nonZero = codes.filter((c) => c);
  if (nonZero.every((c) => c === nonZero[0])) return TABLES[CODE_STYLE[nonZero[0]]].get(mask) ?? " ";
  const mixed = MIXED.get(codes.join(""));
  if (mixed) return mixed;
  // No mixed glyph for this combination: the heaviest style throughout.
  const heaviest = present.reduce((a, b) => (STYLE_WEIGHT[b] > STYLE_WEIGHT[a] ? b : a));
  const style = heaviest === "dashed" || heaviest === "dotted" ? "single" : heaviest;
  return TABLES[style].get(mask) ?? " ";
}

/** Connector heads, by the direction they point (diamonds, dots and crosses look the same every
 * way). Only characters the editor's font has (no ◇: ◊ instead), each one cell wide. In ASCII
 * each kind is told apart too: * and o as Mermaid writes composition and aggregation, @ a dot,
 * O a circle, x a cross; a hollow arrow is A or V, or |> and <| left and right (the | is drawn on
 * the line, see grid.ts). */
const HEAD_GLYPHS: Record<Exclude<Head, "bar">, { unicode: Record<Side, string> | string; ascii: Record<Side, string> | string }> = {
  arrow: { unicode: { top: "▲", right: "►", bottom: "▼", left: "◄" }, ascii: { top: "^", right: ">", bottom: "v", left: "<" } },
  triangle: { unicode: { top: "△", right: "▷", bottom: "▽", left: "◁" }, ascii: { top: "A", right: ">", bottom: "V", left: "<" } },
  diamond: { unicode: "◆", ascii: "*" },
  "hollow-diamond": { unicode: "◊", ascii: "o" },
  dot: { unicode: "●", ascii: "@" },
  circle: { unicode: "○", ascii: "O" },
  cross: { unicode: "×", ascii: "x" },
};

/** What each head is called in the panel and menus. */
export const HEAD_NAMES: Record<Head | "none", string> = {
  none: "no head", arrow: "arrow", triangle: "hollow arrow", diamond: "diamond", "hollow-diamond": "hollow diamond",
  dot: "dot", circle: "circle", cross: "cross", bar: "bar",
};

export function arrowGlyph(pointing: Side, style: LineStyle, head: Head = "arrow"): string {
  const ascii = style === "ascii";
  if (head === "bar") {
    // The line runs into a crossbar: ─┤  ├─  ┴  ┬ (in the line's own style).
    const horizontal = pointing === "left" || pointing === "right";
    if (ascii) return horizontal ? "|" : "-";
    const styles: (LineStyle | undefined)[] = [undefined, undefined, undefined, undefined];
    const back = SIDE_INDEX[OPPOSITE[pointing]];
    styles[back] = style;
    for (const i of horizontal ? [0, 2] : [1, 3]) styles[i] = style;
    return lineGlyph(styles, false, false);
  }
  const g = HEAD_GLYPHS[head][ascii ? "ascii" : "unicode"];
  return typeof g === "string" ? g : g[pointing];
}

/** ASCII stand-ins for the drawing characters shapes use, for ASCII-only output. (People's own
 * text is left as they typed it.) */
const ASCII_CHARS: Record<string, string> = { "╱": "/", "╲": "\\", "…": ".", "•": "*", "◦": "-", "▪": "+" };

export function asciiChar(ch: string): string {
  return ASCII_CHARS[ch] ?? ch;
}
