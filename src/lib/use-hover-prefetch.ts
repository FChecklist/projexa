"use client";

// R67 F-22 (audit recommendation R-247) -- hover intent, then speculate.
//
// A cursor crossing a link is not intent; a cursor RESTING on it for 100 ms
// is. So nothing happens for the first 100 ms, and moving away inside that
// window cancels outright. That single rule is what keeps a mouse dragged
// across a forty-item module directory from firing forty requests.
//
// Two things are then prefetched, and both are needed for the click to feel
// instant: router.prefetch() gets Next's RSC payload for the route (the frame,
// the skeleton, the JS), and the store gets the module's primary list call
// (the rows). Either alone leaves the other as the wait.
//
// Focus is treated exactly like hover, so a keyboard user tabbing through the
// directory gets the same head start a mouse user does.

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/fetch-json";
import { primaryListUrl } from "@/lib/module-prefetch";
import { HOVER_INTENT_MS, prefetch, shouldSpeculate } from "@/lib/prefetch-store";

export function useHoverPrefetch(projectId: string | null) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const arm = useCallback(
    (route: string) => {
      if (!shouldSpeculate()) return;
      cancel();
      timer.current = setTimeout(() => {
        timer.current = null;
        // The route's own payload...
        router.prefetch(route.split("?")[0]);
        // ...and the rows it is going to ask for.
        const url = primaryListUrl(route, projectId);
        if (url) prefetch(url, () => fetchJson<Record<string, unknown>>(url));
      }, HOVER_INTENT_MS);
    },
    [router, projectId, cancel]
  );

  // A pending timer must not outlive the component that armed it.
  useEffect(() => cancel, [cancel]);

  /** Spread onto any link or row that leads to a module. */
  const hoverProps = useCallback(
    (route: string) => ({
      onMouseEnter: () => arm(route),
      onFocus: () => arm(route),
      onMouseLeave: cancel,
      onBlur: cancel,
    }),
    [arm, cancel]
  );

  return { hoverProps, arm, cancel };
}
