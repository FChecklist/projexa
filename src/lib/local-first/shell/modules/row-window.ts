// AUDIT-100 B15: the math for drawing only the rows of a long table that are on screen (windowing), with no library and no DOM.
// Measured in real Chromium (e2e/lf-lifecycle-large-project.spec.ts): drawing all 5,000 lines of a BOQ as real rows took 5-9 s on a quiet
// 8 GB laptop and 46 s on one starved of memory. Drawing only what is on screen plus a margin keeps the first draw to tens of rows.
// Rows can have different heights (a long description wraps), so heights are MEASURED as rows are drawn; a row never drawn yet counts as the
// average of the rows measured so far (or the estimate before any is measured). The hook that uses this is use-row-window.ts.

/** Below this many rows the table is drawn in full: windowing only pays off for long tables, and a short one keeps the browser's own find. */
export const WINDOW_MIN_ROWS = 200;

/**
 * offsets[i] is the top of row i from the top of the table body; offsets[count] is the body's full height. A height that is not a finite
 * positive number (a row not measured yet) counts as `fallback`.
 */
export function buildOffsets(heights: ArrayLike<number>, count: number, fallback: number): Float64Array {
  const offsets = new Float64Array(count + 1);
  for (let i = 0; i < count; i += 1) {
    const h = heights[i];
    offsets[i + 1] = offsets[i] + (Number.isFinite(h) && h > 0 ? h : fallback);
  }
  return offsets;
}

/** The average of the measured heights, or `estimate` when none is measured. */
export function averageHeight(heights: ArrayLike<number>, count: number, estimate: number): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < count; i += 1) {
    const h = heights[i];
    if (Number.isFinite(h) && h > 0) {
      sum += h;
      n += 1;
    }
  }
  return n === 0 ? estimate : sum / n;
}

/** The index of the row that contains the point `y` (clamped to the first and last row). `offsets` has count + 1 entries. */
export function rowAt(offsets: Float64Array, y: number): number {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  if (y <= 0) return 0;
  if (y >= offsets[count]) return count - 1;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export type RowRange = { start: number; end: number }; // rows start .. end-1

/** The rows that the band [top, bottom) of the body (pixels from the body's top) touches; empty when the band misses the body. */
export function visibleRows(offsets: Float64Array, top: number, bottom: number): RowRange {
  const count = offsets.length - 1;
  if (count <= 0 || bottom <= 0 || top >= offsets[count] || bottom <= top) return { start: 0, end: 0 };
  return { start: rowAt(offsets, top), end: rowAt(offsets, bottom - 0.001) + 1 };
}

/**
 * The rows to draw. The current range is kept while it still covers what is on screen with at least half the margin to spare on each side
 * (so scrolling a few pixels draws nothing new); otherwise a new range is the visible rows plus `overscan` rows each side.
 */
export function nextRange(current: RowRange, visible: RowRange, count: number, overscan: number): RowRange {
  if (visible.end <= visible.start) {
    // nothing of the table is on screen: keep what is drawn if it is a sane range, so scrolling past it and back does not redraw
    if (current.end > current.start && current.end <= count) return current;
    return { start: 0, end: Math.min(count, overscan * 2) };
  }
  const half = Math.floor(overscan / 2);
  const needStart = Math.max(0, visible.start - half);
  const needEnd = Math.min(count, visible.end + half);
  if (current.start <= needStart && current.end >= needEnd && current.end <= count && current.end - current.start <= visible.end - visible.start + overscan * 4) {
    return current;
  }
  return { start: Math.max(0, visible.start - overscan), end: Math.min(count, visible.end + overscan) };
}

export type RowPlanItem = { kind: "row"; index: number } | { kind: "gap"; from: number; to: number };

/**
 * What the body holds, top to bottom: a spacer (gap) for each run of rows not drawn, and the drawn rows. `pinned` is a row that must stay drawn
 * even when it is off screen (the one with the keyboard focus, so typing in it is never cut off by a scroll).
 */
export function planRows(count: number, range: RowRange, pinned: number | null): RowPlanItem[] {
  const start = Math.max(0, Math.min(range.start, count));
  const end = Math.max(start, Math.min(range.end, count));
  const drawn: number[] = [];
  if (pinned !== null && pinned >= 0 && pinned < count && (pinned < start || pinned >= end)) drawn.push(pinned);
  for (let i = start; i < end; i += 1) drawn.push(i);
  drawn.sort((a, b) => a - b);
  const plan: RowPlanItem[] = [];
  let cursor = 0;
  for (const index of drawn) {
    if (index > cursor) plan.push({ kind: "gap", from: cursor, to: index });
    plan.push({ kind: "row", index });
    cursor = index + 1;
  }
  if (cursor < count) plan.push({ kind: "gap", from: cursor, to: count });
  return plan;
}
