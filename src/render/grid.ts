import { type Point, type Rect, type Side, bottom, right } from "../geometry/geom";
import type { Head, LineStyle } from "../model/types";
import { DIR_BITS, SIDE_INDEX, STYLE_WEIGHT, arrowGlyph, asciiChar, lineGlyph } from "./charsets";

export interface Cell {
  /** Directions this cell's line strokes connect to (charsets.ts bits). */
  mask: number;
  /** The line style reaching the cell from each direction: up, right, down, left. */
  styles: (LineStyle | undefined)[];
  rounded: boolean;
  /** A text character; wins over strokes. */
  ch?: string;
  /** An arrowhead pointing this way; wins over strokes. */
  arrow?: Side;
  arrowStyle?: LineStyle;
  head?: Head;
}

/** A sparse grid of cells, built by the rasterizer and read by the canvas and text export. */
export class CharGrid {
  readonly cells = new Map<string, Cell>();

  private cell(p: Point): Cell {
    const k = `${p.x},${p.y}`;
    let c = this.cells.get(k);
    if (!c) {
      c = { mask: 0, styles: [undefined, undefined, undefined, undefined], rounded: false };
      this.cells.set(k, c);
    }
    return c;
  }

  get(p: Point): Cell | undefined {
    return this.cells.get(`${p.x},${p.y}`);
  }

  stroke(p: Point, dirs: Side | Side[], style: LineStyle, rounded = false) {
    const c = this.cell(p);
    for (const d of Array.isArray(dirs) ? dirs : [dirs]) {
      const i = SIDE_INDEX[d];
      const cur = c.styles[i];
      if (!cur || STYLE_WEIGHT[style] > STYLE_WEIGHT[cur]) c.styles[i] = style;
      c.mask |= DIR_BITS[i];
    }
    if (rounded) c.rounded = true;
  }

  setChar(p: Point, ch: string) {
    this.cell(p).ch = ch;
  }

  setArrow(p: Point, pointing: Side, style: LineStyle, head: Head = "arrow") {
    const c = this.cell(p);
    c.arrow = pointing;
    c.arrowStyle = style;
    c.head = head;
  }

  /** Blank out a rectangle (what's behind an opaque node). */
  clear(r: Rect) {
    for (let y = r.y; y <= bottom(r); y++) {
      for (let x = r.x; x <= right(r); x++) this.cells.delete(`${x},${y}`);
    }
  }

  /** The character shown in a cell ("" when empty). `ascii` maps every line glyph to ASCII. */
  glyph(p: Point, ascii = false): string {
    const c = this.get(p);
    return c ? cellGlyph(c, ascii) : "";
  }

  /** Every non-blank cell with its character. */
  *entries(ascii = false): Generator<[Point, string]> {
    for (const [k, c] of this.cells) {
      const g = cellGlyph(c, ascii);
      if (g && g !== " ") {
        const [x, y] = k.split(",").map(Number);
        yield [{ x, y }, g];
      }
    }
  }

  /** Bounding box of the non-blank cells, or null if empty. */
  bounds(): Rect | null {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [p] of this.entries()) {
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /** Plain text of `area` (default: everything), with trailing spaces trimmed. */
  toText(area?: Rect | null, ascii = false): string {
    const r = area ?? this.bounds();
    if (!r) return "";
    const lines: string[] = [];
    for (let y = r.y; y <= bottom(r); y++) {
      let line = "";
      for (let x = r.x; x <= right(r); x++) line += this.glyph({ x, y }, ascii) || " ";
      lines.push(line.replace(/\s+$/, ""));
    }
    return lines.join("\n");
  }
}

export function cellGlyph(c: Cell, ascii: boolean): string {
  if (c.ch !== undefined) return ascii ? asciiChar(c.ch) : c.ch;
  if (c.arrow) return arrowGlyph(c.arrow, ascii ? "ascii" : (c.arrowStyle ?? "single"), c.head);
  if (c.mask) return lineGlyph(c.styles, c.rounded, ascii);
  return "";
}

