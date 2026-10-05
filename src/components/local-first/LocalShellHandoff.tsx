"use client";

// LOCAL-FIRST (AUDIT-100 A3, VERCEL_ROUTE_PLAN.md step 1): mounted ONLY in the (app) layout, i.e. on a server-rendered page. Once the shell
// is on this laptop for this person, the person is handed over to it (one replace of the current address, answered by the service worker
// from the laptop) and, until then, a plain in-app link click is a full navigation instead of an RSC fetch to Vercel. Renders nothing.
// See src/lib/local-first/release/shell-handoff.ts for the rules (never a server page asked for on purpose, never while a field is edited,
// never a reload loop). With the local-first flag off it does nothing at all.

import { useEffect } from "react";
import { isLocalFirstEnabled } from "@/lib/local-first/local-reader";
import { createSwClient } from "@/lib/local-first/release/sw-client";
import { SHELL_READY_EVENT, armLinkHandoff, editingNow, handOff, shellServes, type HandoffEnv } from "@/lib/local-first/release/shell-handoff";

export function LocalShellHandoff() {
  useEffect(() => {
    if (process.env.NODE_ENV === "development" || !isLocalFirstEnabled()) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    let stopped = false;
    let disarm: (() => void) | null = null;
    const sw = createSwClient();
    const hasController = () => Boolean(navigator.serviceWorker.controller);
    let session: HandoffEnv["session"] = null;
    try { session = sessionStorage; } catch { session = null; }
    const env: HandoffEnv = { location: window.location, session, isEditing: () => editingNow(document) };

    const arm = async () => {
      if (stopped || disarm) return;
      if (shellServes(await sw.status().catch(() => null), null, hasController())) disarm = armLinkHandoff(window, env);
    };
    // The page opened while the shell was already there: the person (or the shell) asked for this server page; links still leave it fully.
    void arm();
    // The shell has just become ready (the install finished, or the worker's pointer was just set): hand over now.
    const onReady = () => {
      if (stopped) return;
      void arm();
      void handOff({ sw, personId: null, hasController, env }).catch(() => "not_ready");
    };
    window.addEventListener(SHELL_READY_EVENT, onReady);
    return () => {
      stopped = true;
      window.removeEventListener(SHELL_READY_EVENT, onReady);
      disarm?.();
    };
  }, []);
  return null;
}
