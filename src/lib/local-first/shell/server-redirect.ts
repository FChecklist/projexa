"use client";

// LOCAL-FIRST shell: the "open the server's page" redirect, shared by every screen that only the server has (NotInShell and the cluster
// server-only screens).
//
// It must not fire on the first render. Until the connectivity probe has run, the shell says "online" (it cannot know yet), and a laptop
// whose browser still reports navigator.onLine=true while the network is really gone (Chromium's emulated offline does this for a freshly
// loaded document; a dead server behind a live wifi does too) would be sent to the server page at once, racing the person's next
// navigation. So the redirect waits a moment and asks again: it goes only when the laptop STILL says online after that.

import { useEffect } from "react";
import { getConnectivity } from "../connectivity";

export const SERVER_REDIRECT_DELAY_MS = 1500;

export function useServerRedirect(online: boolean, url: string, delayMs = SERVER_REDIRECT_DELAY_MS): void {
  useEffect(() => {
    if (!online) return;
    const timer = setTimeout(() => {
      if (navigator.onLine !== false && getConnectivity() === "online") window.location.replace(url);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [online, url, delayMs]);
}
