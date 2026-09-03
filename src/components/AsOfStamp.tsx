"use client";

// R67 F-22 -- the stamp on rows that came from a speculative prefetch.
//
// Renders nothing at all once the live read lands (asOf goes null), so the
// steady state carries no extra chrome; it only appears in the window where
// the screen is showing a head start rather than a fresh answer.
import { asOfLabel } from "@/lib/as-of";

export function AsOfStamp({ at }: { at: number | null }) {
  if (at === null) return null;
  return (
    <span className="text-[11px] text-px-muted" title="Shown from a copy fetched a moment ago; refreshing now.">
      {asOfLabel(at)}
    </span>
  );
}

export default AsOfStamp;
