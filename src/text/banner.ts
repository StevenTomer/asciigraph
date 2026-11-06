import figlet from "figlet";
import banner from "figlet/fonts/Banner";
import big from "figlet/fonts/Big";
import mini from "figlet/fonts/Mini";
import shadow from "figlet/fonts/Shadow";
import slant from "figlet/fonts/Slant";
import small from "figlet/fonts/Small";
import standard from "figlet/fonts/Standard";

/**
 * Banner text: big lettering made of characters, in FIGlet fonts (from the FIGlet distribution).
 * A banner is a plain text label whose text is the lettering, with `Node.banner` keeping what it
 * says and in which font, so it can be changed and drawn again. Loaded only by the banner dialog.
 */
export const BANNER_FONTS = [
  { id: "standard", label: "standard", figlet: "Standard", data: standard },
  { id: "small", label: "small", figlet: "Small", data: small },
  { id: "mini", label: "mini", figlet: "Mini", data: mini },
  { id: "slant", label: "slant", figlet: "Slant", data: slant },
  { id: "big", label: "big", figlet: "Big", data: big },
  { id: "shadow", label: "shadow", figlet: "Shadow", data: shadow },
  { id: "blocks", label: "blocks", figlet: "Banner", data: banner, fill: "█" },
] as const;

export type BannerFont = (typeof BANNER_FONTS)[number]["id"];

const parsed = new Set<string>();

/** `text` as lettering in `font`: each line of text a band of lettering, with no trailing spaces
 * or blank lines around it. */
export function bannerArt(text: string, font: string): string {
  const f = BANNER_FONTS.find((x) => x.id === font) ?? BANNER_FONTS[0];
  if (!parsed.has(f.figlet)) {
    figlet.parseFont(f.figlet as never, f.data);
    parsed.add(f.figlet);
  }
  const bands = text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => trimBlank(figlet.textSync(l.trim(), { font: f.figlet as never, width: 10000, whitespaceBreak: false }).split("\n")));
  let lines = bands.flatMap((b, i) => (i ? ["", ...b] : b));
  if ("fill" in f) lines = lines.map((l) => l.replace(/#/g, f.fill));
  return lines.join("\n");
}

function trimBlank(lines: string[]): string[] {
  lines = lines.map((l) => l.trimEnd());
  while (lines.length && !lines[0]) lines.shift();
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  // A common indent (a font's empty first column) goes too.
  const indent = Math.min(...lines.filter((l) => l).map((l) => l.length - l.trimStart().length));
  return indent > 0 && indent < Infinity ? lines.map((l) => l.slice(indent)) : lines;
}
