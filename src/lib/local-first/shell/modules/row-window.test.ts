import { describe, expect, test } from "bun:test";
import { averageHeight, buildOffsets, nextRange, planRows, rowAt, visibleRows, WINDOW_MIN_ROWS } from "./row-window";

// AUDIT-100 B15: the windowing math behind the BOQ screen (use-row-window.ts). Pure functions, no DOM.

describe("row offsets", () => {
  test("unmeasured rows count as the fallback height; measured rows as themselves", () => {
    const h: number[] = [];
    h[1] = 80;
    const o = buildOffsets(h, 4, 50);
    expect([...o]).toEqual([0, 50, 130, 180, 230]);
  });

  test("zero, negative and NaN heights are not trusted", () => {
    expect([...buildOffsets([0, -5, Number.NaN], 3, 10)]).toEqual([0, 10, 20, 30]);
  });

  test("the average uses measured rows only, the estimate when none is", () => {
    expect(averageHeight([], 10, 49)).toBe(49);
    const h: number[] = [];
    h[2] = 40;
    h[7] = 60;
    expect(averageHeight(h, 10, 49)).toBe(50);
  });
});

describe("finding rows on screen", () => {
  const o = buildOffsets([], 5000, 50); // 5,000 rows, 250,000 px

  test("rowAt finds the row containing a point, clamped at both ends", () => {
    expect(rowAt(o, -10)).toBe(0);
    expect(rowAt(o, 0)).toBe(0);
    expect(rowAt(o, 49.9)).toBe(0);
    expect(rowAt(o, 50)).toBe(1);
    expect(rowAt(o, 123_456)).toBe(2469);
    expect(rowAt(o, 250_000)).toBe(4999);
    expect(rowAt(o, 9e9)).toBe(4999);
    expect(rowAt(buildOffsets([], 0, 50), 10)).toBe(0);
  });

  test("rowAt works with uneven heights", () => {
    const uneven = buildOffsets([10, 100, 10, 10], 4, 10); // 0,10,110,120,130
    expect(rowAt(uneven, 9)).toBe(0);
    expect(rowAt(uneven, 10)).toBe(1);
    expect(rowAt(uneven, 109)).toBe(1);
    expect(rowAt(uneven, 110)).toBe(2);
  });

  test("a 720 px screen at the top of the table touches 15 rows", () => {
    expect(visibleRows(o, 0, 720)).toEqual({ start: 0, end: 15 });
  });

  test("a screen in the middle, and one exactly on row edges", () => {
    expect(visibleRows(o, 100_025, 100_745)).toEqual({ start: 2000, end: 2015 });
    expect(visibleRows(o, 100_000, 100_500)).toEqual({ start: 2000, end: 2010 });
  });

  test("a screen above or below the table touches nothing", () => {
    expect(visibleRows(o, -2000, -100)).toEqual({ start: 0, end: 0 });
    expect(visibleRows(o, 250_000, 251_000)).toEqual({ start: 0, end: 0 });
  });

  test("the table starting half-way down the screen: the rows in the lower half", () => {
    // the body's top is 400 px below the screen's top: the band is -400 .. 320 of the body
    expect(visibleRows(o, -400, 320)).toEqual({ start: 0, end: 7 });
  });
});

describe("the range to draw", () => {
  test("a new range is the visible rows plus the overscan on each side, clamped", () => {
    expect(nextRange({ start: 0, end: 0 }, { start: 2000, end: 2015 }, 5000, 12)).toEqual({ start: 1988, end: 2027 });
    expect(nextRange({ start: 0, end: 0 }, { start: 2, end: 17 }, 5000, 12)).toEqual({ start: 0, end: 29 });
    expect(nextRange({ start: 0, end: 0 }, { start: 4990, end: 5000 }, 5000, 12)).toEqual({ start: 4978, end: 5000 });
  });

  test("a small scroll inside the margin keeps the same range (the same object: nothing redraws)", () => {
    const cur = { start: 1988, end: 2027 };
    expect(nextRange(cur, { start: 2003, end: 2018 }, 5000, 12)).toBe(cur);
  });

  test("scrolling to the margin's half moves the range", () => {
    const cur = { start: 1988, end: 2027 };
    expect(nextRange(cur, { start: 2008, end: 2023 }, 5000, 12)).toEqual({ start: 1996, end: 2035 });
  });

  test("a jump far away replaces the range, never grows it to cover both places", () => {
    expect(nextRange({ start: 0, end: 29 }, { start: 4985, end: 5000 }, 5000, 12)).toEqual({ start: 4973, end: 5000 });
  });

  test("an over-large range (the first draw) shrinks only when it no longer covers the screen", () => {
    const first = { start: 0, end: 40 };
    expect(nextRange(first, { start: 0, end: 15 }, 5000, 12)).toBe(first);
  });

  test("the table off screen keeps a sane range; a stale range past a shrunk table is replaced", () => {
    const cur = { start: 100, end: 140 };
    expect(nextRange(cur, { start: 0, end: 0 }, 5000, 12)).toBe(cur);
    expect(nextRange({ start: 4000, end: 4040 }, { start: 0, end: 0 }, 300, 12)).toEqual({ start: 0, end: 24 });
  });
});

describe("the plan of the body", () => {
  test("rows in the range, one spacer for each run of rows not drawn", () => {
    expect(planRows(10, { start: 3, end: 6 }, null)).toEqual([
      { kind: "gap", from: 0, to: 3 },
      { kind: "row", index: 3 },
      { kind: "row", index: 4 },
      { kind: "row", index: 5 },
      { kind: "gap", from: 6, to: 10 },
    ]);
  });

  test("no spacer at an edge the range touches", () => {
    expect(planRows(3, { start: 0, end: 3 }, null)).toEqual([
      { kind: "row", index: 0 },
      { kind: "row", index: 1 },
      { kind: "row", index: 2 },
    ]);
  });

  test("the focused row stays drawn when it is off screen, with its own spacers either side", () => {
    expect(planRows(100, { start: 50, end: 52 }, 4)).toEqual([
      { kind: "gap", from: 0, to: 4 },
      { kind: "row", index: 4 },
      { kind: "gap", from: 5, to: 50 },
      { kind: "row", index: 50 },
      { kind: "row", index: 51 },
      { kind: "gap", from: 52, to: 100 },
    ]);
    expect(planRows(100, { start: 0, end: 2 }, 99).slice(-2)).toEqual([{ kind: "gap", from: 2, to: 99 }, { kind: "row", index: 99 }]);
  });

  test("a pinned row inside the range is not drawn twice; a pinned row past the end is ignored", () => {
    expect(planRows(10, { start: 0, end: 10 }, 4).filter((p) => p.kind === "row")).toHaveLength(10);
    expect(planRows(5, { start: 0, end: 5 }, 9)).toHaveLength(5);
  });

  test("every row is either drawn or inside exactly one spacer (5,000 rows)", () => {
    const plan = planRows(5000, { start: 2400, end: 2440 }, 7);
    let covered = 0;
    let last = 0;
    for (const p of plan) {
      const from = p.kind === "row" ? p.index : p.from;
      const to = p.kind === "row" ? p.index + 1 : p.to;
      expect(from).toBe(last);
      covered += to - from;
      last = to;
    }
    expect(covered).toBe(5000);
    expect(plan.filter((p) => p.kind === "row")).toHaveLength(41);
  });

  test("short tables are not windowed", () => {
    expect(WINDOW_MIN_ROWS).toBeGreaterThanOrEqual(100);
    expect(WINDOW_MIN_ROWS).toBeLessThanOrEqual(500);
  });
});
