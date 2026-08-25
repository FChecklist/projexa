"use client";

// PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION:
// registers /sw.js (generated per-deploy by src/app/sw.js/route.ts -- see
// that file's header comment for why this moved off a static public/sw.js)
// from a client component (Next's App Router has no server-side hook for
// this -- navigator.serviceWorker only exists in the browser). Mounted once
// in the root layout so it's live on every route.
import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("PROJEXA service worker registration failed:", err);
    });
  }, []);

  return null;
}
