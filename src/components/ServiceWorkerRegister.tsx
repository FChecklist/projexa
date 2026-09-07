"use client";

// PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION:
// registers /sw.js (generated per-deploy by src/app/sw.js/route.ts -- see
// that file's header comment for why this moved off a static public/sw.js)
// from a client component (Next's App Router has no server-side hook for
// this -- navigator.serviceWorker only exists in the browser). Mounted once
// in the root layout so it's live on every route.
//
// NEVER register it in local dev (found + fixed 2026-09-07). sw.js's own
// CACHE_VERSION falls back to the fixed literal string "local-dev" whenever
// VERCEL_GIT_COMMIT_SHA is unset -- true for every `bun run dev` run -- so
// its own activate handler's "delete any cache key that isn't today's
// CACHE_NAME" purge never fires locally: CACHE_NAME never changes between
// dev-server restarts. The SW cache-firsts `/_next/static/*` on the
// (correct, for production) assumption that those URLs are content-hashed
// and genuinely immutable -- but Turbopack's DEV-mode chunk URLs are NOT
// stable across separate `next dev` process launches for the same source
// tree, so a chunk cached under an earlier dev-server session can still
// satisfy a `caches.match()` hit against the CURRENT session's request for
// the same URL, serving stale bytes with no invalidation. This is what
// caused a real, hours-long, previously misdiagnosed bug: after removing
// the DraftingCompass import from AppSidebar.tsx, /dashboard kept throwing
// "Module ... was instantiated ... but the module factory is not
// available" -- surviving full `.next` cache deletes and complete process
// restarts (which don't touch the browser's own Cache Storage), because
// the SW was still serving an old chunk that referenced the removed
// import. Confirmed directly: `navigator.serviceWorker.getRegistrations()`
// showed an active registration at scope `http://localhost:3100/` backing
// a cache literally named `projexa-shell-local-dev`; unregistering it and
// clearing that cache fixed the page immediately, with zero source changes.
// It had been filed as an "isolated Turbopack dev-mode bug" -- that
// diagnosis was wrong, corrected here. The SW's own stated purpose (a site
// worker opening PROJEXA with no signal in the field) is a production
// concern with zero meaning on a developer's own localhost, so the safest
// fix is to never run it there at all, and to clean up any registration
// (and its now-permanently-stale cache) a developer already has from
// before this fix -- self-healing on the very next component mount rather
// than requiring everyone to manually replicate the console commands used
// to diagnose this.
import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV === "development") {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .then(() => caches.keys())
        .then((cacheNames) => Promise.all(cacheNames.filter((name) => name.startsWith("projexa-shell-")).map((name) => caches.delete(name))))
        .catch((err) => {
          console.error("PROJEXA dev-mode service worker cleanup failed:", err);
        });
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("PROJEXA service worker registration failed:", err);
    });
  }, []);

  return null;
}
