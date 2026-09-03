"use client";

// R67 D-04 -- the visible half of "a server-component fetch, streamed with
// Suspense, with an 8 s budget and a 'Still loading…' state at 3 s".
//
// This is the Suspense FALLBACK a module page hands to <Suspense> while its
// own server-side VERIDIAN read is still in flight. Because the page streams,
// the shell, the heading and the module's tabs are already painted and
// clickable; only this region is waiting. Two rules it exists to keep:
//
//   1. NEVER A WORDLESS SPINNER. The frame is a skeleton in the shape of the
//      real thing -- a table header plus rows -- so the wait shows what is
//      coming rather than a spinning circle that could equally precede an
//      error.
//   2. NEVER A SILENT LONG WAIT. At SLOW_READ_NOTICE_MS (3 s) a caption
//      appears naming the module's own noun and the elapsed seconds. The
//      wait is bounded: VERIDIAN_SCREEN_BUDGET_MS (8 s) is the read's budget,
//      after which the page's own catch renders the backend's words.
//
// It deliberately owns no fetch of its own -- it cannot, and must not, know
// anything about the request it is covering.
import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { stillLoadingCaption } from "@/lib/screen-budget";

export default function ScreenLoading({
  entity,
  rows = 5,
  columns = 4,
}: {
  /** The module's own noun as the user reads it: "permits", "the schedule". */
  entity: string;
  rows?: number;
  columns?: number;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 500);
    return () => clearInterval(timer);
  }, []);

  const caption = stillLoadingCaption(elapsedMs, entity);

  return (
    <div className="space-y-3" data-testid="screen-loading">
      <div
        role="status"
        aria-live="polite"
        aria-label={`Loading ${entity}`}
        className="rounded-lg border border-px-border p-4"
      >
        <div className="flex gap-3 border-b border-px-border pb-3">
          {Array.from({ length: columns }, (_, i) => (
            <Skeleton key={`h-${i}`} className="h-4 flex-1" />
          ))}
        </div>
        <div className="space-y-3 pt-3">
          {Array.from({ length: rows }, (_, r) => (
            <div key={`r-${r}`} className="flex gap-3">
              {Array.from({ length: columns }, (_, c) => (
                <Skeleton key={`r-${r}-c-${c}`} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>
      {/* Rendered only past the threshold, and only as an extra line -- the
          skeleton above never moves, so nothing the user is aiming at shifts
          when this appears (the R48_LAYOUT_REFLOW_01 rule DataLoadError.tsx
          documents for the error card). */}
      {caption && (
        <p className="text-sm text-px-muted" data-testid="screen-loading-caption">
          {caption}
        </p>
      )}
    </div>
  );
}
