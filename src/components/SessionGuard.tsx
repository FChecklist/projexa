"use client";

// SESSION ENDED WHILE WORKING -- the way back. Two jobs, both without any network call and without opening any database:
//   1. Before the person leaves for the sign-in page by any "Sign in again" link, copy what is typed on the page (form-snapshot.ts), so it can be put back.
//      (The shell's own "signed out in another tab" redirect and the middleware's redirect carry ?redirectTo= themselves; the shell calls
//      snapshotThisPage too -- see M24Shell.)
//   2. When the same page opens again after sign-in, fill the EMPTY fields back in (once), and say so in one inline note with the way to check it.
// Renders nothing unless a restore actually happened. Mounted once in the (app) layout, beside ReturnStrip.

import { useEffect, useState } from "react";
import { GuidedPanel } from "@/components/GuidedPanel";
import { applySnapshot, discardSnapshot, peekSnapshot, snapshotThisPage, snapshotUrl } from "@/lib/error-guide/form-snapshot";
import { currentScreen } from "@/lib/error-guide/context";

const LOOK_EVERY_MS = 250;
const LOOK_FOR_MS = 12_000;

function isLoginLink(a: HTMLAnchorElement): boolean {
  try {
    const u = new URL(a.getAttribute("href") ?? "", window.location.origin);
    return u.origin === window.location.origin && (u.pathname === "/login" || u.pathname.startsWith("/login/"));
  } catch {
    return false;
  }
}

export function SessionGuard() {
  const [restored, setRestored] = useState<number | null>(null);

  // 1. leaving for the sign-in page by a link
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (a && isLoginLink(a) && !window.location.pathname.startsWith("/login")) snapshotThisPage("sign-in-link");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // 2. arriving again
  useEffect(() => {
    const url = snapshotUrl(window.location);
    const snap = peekSnapshot(url);
    if (!snap) return;
    const startedAt = Date.now();
    let total = 0;
    const done = new Set<string>();
    const timer = window.setInterval(() => {
      const { filled, missing } = applySnapshot(document, snap.fields);
      filled.forEach((k) => done.add(k));
      total = done.size;
      if (missing.length === 0 || Date.now() - startedAt > LOOK_FOR_MS) {
        window.clearInterval(timer);
        discardSnapshot(url); // used once, whatever happened
        if (total > 0) setRestored(total);
      }
    }, LOOK_EVERY_MS);
    return () => window.clearInterval(timer);
  }, []);

  if (restored === null) return null;
  const screen = currentScreen();
  return (
    <div className="px-4 pt-3" data-testid="session-restored">
      <GuidedPanel
        ctx={{ route: screen.route, search: screen.search, code: "SESSION_RESTORED", serverMessage: `${restored} ${restored === 1 ? "entry was" : "entries were"} put back in the form.` }}
        fix={null}
        noCopy
        actions={[{ id: "ok", label: "Got it", primary: true, onClick: () => setRestored(null) }]}
      />
    </div>
  );
}

export default SessionGuard;
