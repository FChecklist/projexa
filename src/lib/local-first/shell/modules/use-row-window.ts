"use client";

// AUDIT-100 B15: draw only the rows of a long table body that are on screen (windowing). The math is in row-window.ts (unit-tested); this
// hook only reads the page: where the body is on screen (any scrolling ancestor or the window), and how tall the drawn rows really are.
//   - Rows not drawn are replaced by one spacer row per run, as tall as those rows, so the scrollbar and the page length stay true.
//   - The row holding the keyboard focus is never removed, even when scrolled away, so typing in it is not cut off.
//   - Printing draws every row (beforeprint / the print media query), so a printed BOQ is complete.
//   - Below WINDOW_MIN_ROWS rows nothing is windowed at all.
// Each drawn row must carry data-row-index={its index}; the body element gets `ref={attachBody}`, and onFocus/onBlur from this hook.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FocusEvent } from "react";
import { flushSync } from "react-dom";
import { averageHeight, buildOffsets, nextRange, planRows, visibleRows, WINDOW_MIN_ROWS, type RowPlanItem, type RowRange } from "./row-window";

// The first draw, before the page can be measured, draws this many rows: enough for a tall screen.
const FIRST_DRAW_ROWS = 40;
const OVERSCAN = 12;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type RowWindow = {
  plan: RowPlanItem[];
  windowed: boolean;
  /** Height in pixels of the rows from..to-1 (for a spacer). */
  gapHeight: (from: number, to: number) => number;
  attachBody: (el: HTMLTableSectionElement | null) => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
  onBlur: (e: FocusEvent<HTMLElement>) => void;
};

function rowIndexOf(target: EventTarget | null): number | null {
  const el = target instanceof Element ? target.closest("[data-row-index]") : null;
  const n = el ? Number(el.getAttribute("data-row-index")) : Number.NaN;
  return Number.isInteger(n) ? n : null;
}

type Geometry = { count: number; offsets: Float64Array };

export function useRowWindow(count: number, estimate = 49): RowWindow {
  const [printing, setPrinting] = useState(false);
  const windowed = count >= WINDOW_MIN_ROWS && !printing;
  const [body, setBody] = useState<HTMLTableSectionElement | null>(null);
  // measured row heights by index; read and written only in effects
  const heights = useRef<number[]>([]);
  const [geometry, setGeometry] = useState<Geometry>(() => ({ count, offsets: buildOffsets([], count, estimate) }));
  const [range, setRange] = useState<RowRange>(() => ({ start: 0, end: Math.min(count, FIRST_DRAW_ROWS) }));
  const [pinned, setPinned] = useState<number | null>(null);

  // until the effect below has measured a new row count, every row counts as the estimate
  const offsets = useMemo(
    () => (geometry.count === count ? geometry.offsets : buildOffsets([], count, estimate)),
    [geometry, count, estimate],
  );

  const update = useCallback(() => {
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
    const visible = visibleRows(offsets, -rect.top, viewport - rect.top);
    const n = offsets.length - 1;
    setRange((cur) => {
      const next = nextRange(cur, visible, n, OVERSCAN);
      return next.start === cur.start && next.end === cur.end ? cur : next;
    });
  }, [body, offsets]);

  // Where the body is on screen: on any scroll (captured, so a scrolling ancestor counts too) or resize, and whenever the heights change.
  useEffect(() => {
    if (!windowed) return;
    document.addEventListener("scroll", update, { capture: true, passive: true });
    window.addEventListener("resize", update);
    return () => {
      document.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("resize", update);
    };
  }, [windowed, update]);

  // After every draw: measure the drawn rows (a wrapped description makes a row taller than the estimate), then place the window.
  useIsoLayoutEffect(() => {
    if (!body || !windowed) return;
    const h = heights.current;
    if (h.length !== count) h.length = count;
    let changed = geometry.count !== count;
    for (const row of body.querySelectorAll<HTMLElement>("[data-row-index]")) {
      const i = Number(row.getAttribute("data-row-index"));
      const height = row.getBoundingClientRect().height;
      if (Number.isInteger(i) && i < count && height > 0 && Math.abs((h[i] ?? 0) - height) > 0.5) {
        h[i] = height;
        changed = true;
      }
    }
    if (changed) {
      const next = { count, offsets: buildOffsets(h, count, averageHeight(h, count, estimate)) };
      setGeometry(next);
    } else {
      update();
    }
  });

  // Printing draws every row; the state is set synchronously so the print layout already has them.
  useEffect(() => {
    const on = () => flushSync(() => setPrinting(true));
    const off = () => setPrinting(false);
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    const mq = typeof window.matchMedia === "function" ? window.matchMedia("print") : null;
    const onMq = (e: MediaQueryListEvent) => (e.matches ? on() : off());
    mq?.addEventListener?.("change", onMq);
    return () => {
      window.removeEventListener("beforeprint", on);
      window.removeEventListener("afterprint", off);
      mq?.removeEventListener?.("change", onMq);
    };
  }, []);

  const onFocus = useCallback((e: FocusEvent<HTMLElement>) => {
    const i = rowIndexOf(e.target);
    if (i !== null) setPinned(i);
  }, []);
  const onBlur = useCallback((e: FocusEvent<HTMLElement>) => {
    // Focus moving to another element un-pins (a focus landing on another row pins that one in onFocus). Focus leaving the window
    // (relatedTarget null) keeps the pin, so coming back to the window finds the box still there.
    if (e.relatedTarget && rowIndexOf(e.relatedTarget) !== rowIndexOf(e.target)) setPinned(null);
  }, []);

  const plan = useMemo(
    () => (windowed ? planRows(count, range, pinned) : planRows(count, { start: 0, end: count }, null)),
    [windowed, count, range, pinned],
  );
  const gapHeight = useCallback((from: number, to: number) => offsets[to] - offsets[from], [offsets]);

  return { plan, windowed, gapHeight, attachBody: setBody, onFocus, onBlur };
}
