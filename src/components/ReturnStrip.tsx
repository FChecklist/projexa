"use client";

// THE WAY BACK, on the screen a guided error sent the person to. A thin strip -- "Back to <what you were doing>" -- with a stronger "You can go
// back now" once something was saved here. Always dismissible ("Stay here"); it never blocks anything and renders nothing when there is no trail.
// It also honours ?focus=<id> on arrival: scrolls to that element, outlines it for 3 s, announces it. Mounted once in the app shell.
// Nothing is read or fetched until the first effect runs (no work at page load beyond one sessionStorage read).

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGuidedNavigate } from "@/components/GuidedError";
import { backUrl, consumeReturn, entryForScreen, TRAIL_EVENT, type TrailEntry } from "@/lib/error-guide/return-trail";
import { FOCUS_PARAM, focusOnArrival } from "@/lib/error-guide/focus";

export function ReturnStrip() {
  const go = useGuidedNavigate();
  const pathname = usePathname() ?? "/";
  const [entry, setEntry] = useState<TrailEntry | null>(null);

  const refresh = useCallback(() => {
    setEntry(entryForScreen(pathname, typeof window !== "undefined" ? window.location.search : ""));
  }, [pathname]);

  useEffect(() => {
    refresh();
    window.addEventListener(TRAIL_EVENT, refresh);
    window.addEventListener("popstate", refresh);
    return () => {
      window.removeEventListener(TRAIL_EVENT, refresh);
      window.removeEventListener("popstate", refresh);
    };
  }, [refresh]);

  // Arrive at the exact place: ?focus=<id> -> scroll, outline for 3 s, announce.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get(FOCUS_PARAM);
    if (!id) return;
    return focusOnArrival(id);
  }, [pathname]);

  if (!entry) return null;

  const goBack = () => {
    consumeReturn(entry.id);
    setEntry(null);
    go(backUrl(entry));
  };
  const stay = () => {
    consumeReturn(entry.id);
    setEntry(null);
  };

  return (
    <div
      role="region"
      aria-label="Return to what you were doing"
      data-testid="return-strip"
      data-ready={entry.ready ? "true" : "false"}
      className={`flex flex-wrap items-center gap-2 border-b px-4 py-2 text-sm ${entry.ready ? "border-px-success-border bg-px-success-light text-px-success" : "border-px-info-border bg-px-info-light text-px-info"}`}
    >
      <span className="font-medium" data-testid="return-strip-text">
        {entry.ready ? `You can go back now: ${entry.label}` : `You came here from: ${entry.label}`}
      </span>
      <Button type="button" size="sm" variant={entry.ready ? "default" : "outline"} onClick={goBack} data-testid="return-strip-back" className="ml-auto">
        <ArrowLeft className="mr-2 size-4" aria-hidden />
        Back to {entry.label}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={stay} data-testid="return-strip-stay">
        Stay here
      </Button>
    </div>
  );
}

export default ReturnStrip;
