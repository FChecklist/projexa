"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

// GAP FOUND (2026-09-19, Merge 6 workspace's own first Playwright run):
// mounting all 11 sections at once fires ~15 concurrent data fetches on a
// single page load (WPR, Site Diary, BOQ, Timeline, Milestones, Change
// Orders, RFIs, Billing, Materials, Manpower, 4 Records sub-tabs, Project
// 360, Exceptions) -- a genuinely heavier combined load than any single
// existing module page ever produces, and it reproducibly timed out
// several of them under it (materials/site-diary hit their real 8s ceiling
// running alongside the rest, confirmed via this app's own structured
// server timing logs). The individual routes are not the defect -- 8s is
// correct for a route that is normally the ONLY thing loading -- so the
// fix belongs here, not in every domain's own timeout budget: each section
// mounts (and so only THEN fires its own real fetch) once it is actually
// near the viewport, the same lazy-loading discipline a real production
// dashboard with this many embedded widgets needs regardless of framework.
export function LazyMount({ children, minHeight = 96 }: { children: ReactNode; minHeight?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shouldMount, setShouldMount] = useState(false);

  useEffect(() => {
    if (shouldMount || !ref.current) return;
    const el = ref.current;
    // 400px rootMargin: mounts a little before the section is actually on
    // screen, so a normal scroll never shows a bare skeleton for long.
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShouldMount(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [shouldMount]);

  if (!shouldMount) {
    return (
      <div ref={ref} style={{ minHeight }} className="grid place-items-center">
        <Loader2 className="size-5 animate-spin text-px-muted" />
      </div>
    );
  }
  return <>{children}</>;
}
