"use client";

// LOCAL-FIRST: mounted once in the root layout, next to ServiceWorkerRegister. It is deliberately TINY: the real work (src/lib/local-first/boot.ts)
// is a separate chunk loaded a moment after the page is interactive, so the marketing pages and the login screen pay for none of it.
//
// What it does:
//   * keeps the browser's one-shot `beforeinstallprompt` event until the install controller exists (the event fires early and once);
//   * after hydration (and a short idle wait), starts the boot: durable identity, persistent storage, the installed release, the worker's
//     person/mode, the cached project names, the workspace data -- all quietly (see boot.ts);
//   * renders the small "Working on this laptop; will sync when connected" marker when the laptop cannot reach our servers, and nothing
//     at all otherwise.

import { useEffect } from "react";
import { FloatingConnectivityMarker } from "./ConnectivityMarker";

// Module scope on purpose: it must exist before React hydrates, because the browser will not fire the event again.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    (window as unknown as { __pxInstallEvent?: Event }).__pxInstallEvent = event;
  });
}

export function LocalFirstBoot() {
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    // A beat after first paint, so the boot never competes with what the person is waiting to see.
    const timer = setTimeout(() => {
      void import("@/lib/local-first/boot")
        .then((m) => m.startLocalFirstBoot())
        .then((handle) => {
          if (cancelled) handle.stop();
          else stop = () => handle.stop();
        })
        .catch((err) => {
          console.error("PROJEXA local-first boot failed:", err);
        });
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop?.();
    };
  }, []);

  return <FloatingConnectivityMarker />;
}
