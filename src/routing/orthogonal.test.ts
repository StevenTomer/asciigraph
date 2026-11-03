import { describe, expect, it } from "vitest";
import { stepSide } from "../geometry/geom";
import { route } from "./orthogonal";

const bends = (cells: { x: number; y: number }[]) => {
  let n = 0;
  for (let i = 2; i < cells.length; i++) {
    if (stepSide(cells[i - 2], cells[i - 1]) !== stepSide(cells[i - 1], cells[i])) n++;
  }
  return n;
};

describe("route", () => {
  it("goes straight when aligned", () => {
    const r = route({ cell: { x: 0, y: 0 }, dir: "right" }, { cell: { x: 5, y: 0 }, dir: "left" }, []);
    expect(r.cells).toHaveLength(6);
    expect(bends(r.cells)).toBe(0);
    expect(r.clean).toBe(true);
  });

  it("uses one bend for an L and two for a Z", () => {
    expect(bends(route({ cell: { x: 0, y: 0 }, dir: null }, { cell: { x: 5, y: 4 }, dir: null }, []).cells)).toBe(1);
    const z = route({ cell: { x: 0, y: 0 }, dir: "right", strict: true }, { cell: { x: 9, y: 4 }, dir: "left", strict: true }, []);
    expect(bends(z.cells)).toBe(2);
    expect(z.clean).toBe(true);
  });

  it("never passes through an obstacle", () => {
    const wall = { x: 3, y: -5, w: 2, h: 11 };
    const r = route({ cell: { x: 0, y: 0 }, dir: "right" }, { cell: { x: 8, y: 0 }, dir: "left" }, [wall]);
    for (const c of r.cells) {
      expect(c.x >= wall.x && c.x < wall.x + wall.w && c.y >= wall.y && c.y < wall.y + wall.h).toBe(false);
    }
    expect(r.cells[r.cells.length - 1]).toEqual({ x: 8, y: 0 });
  });

  it("loops back around when the target is behind the source", () => {
    const r = route({ cell: { x: 10, y: 0 }, dir: "right", strict: true }, { cell: { x: 0, y: 0 }, dir: "left", strict: true }, []);
    expect(r.cells[1]).toEqual({ x: 11, y: 0 }); // leaves rightwards
    expect(stepSide(r.cells[r.cells.length - 2], r.cells[r.cells.length - 1])).toBe("right"); // arrives head-on
  });
});
