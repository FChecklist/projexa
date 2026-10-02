// LOCAL-FIRST shell: the person's OUTBOX while the on-laptop shell is on screen.
//
// WHY THIS EXISTS (found by package lf-e10a in a real Chromium, 2026-10-02). The shell's screens (work progress, labour, materials,
// documents, design and change ...) keep every edit in the shared outbox (outbox-shared.ts). That outbox is only CREATED by the first
// write of a page load, and only an existing outbox listens for the browser's `online` event. So: save an entry offline, reload the page
// (still offline: the service worker serves the shell), come back online -- and nothing was ever sent, because after the reload no outbox
// existed to notice. The online app does not have this hole (M24Shell starts the outbox as soon as it knows the person); the shell did.
//
// What this does, for one person:
//   * starts their outbox at once (which also resumes, with the SAME op ids, whatever a reload or a closed tab left waiting);
//   * sends what waits when the laptop is back online and when the person comes back to the tab (one try each, the outbox's own
//     back-off still decides what is due);
//   * tells the shell to redraw when the outbox settled something (a waiting row became the server's row, or the server said no), so the
//     "Waiting to sync" mark clears without the person reloading. Events are coalesced: one redraw per burst.
//
// Everything is injected so it is tested without a browser (shell-outbox.test.ts).

import type { Outbox, OutboxEvent } from "../outbox";

export type ShellOutboxDeps = {
  /** The person's shared outbox (created and resumed on first call). */
  getOutbox: (userId: string) => Pick<Outbox, "flush" | "subscribe">;
  /** Redraw the screen from the laptop's database. */
  onSettled: () => void;
  /** Coalescing window for redraws (ms). */
  redrawDelayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export type ShellOutbox = {
  /** Send what is due now (back online, the tab came back to the front). */
  nudge(): void;
  stop(): void;
};

/** Events after which what the screen shows may have changed. */
const REDRAW_ON: ReadonlySet<OutboxEvent["type"]> = new Set(["changed", "applied", "conflict", "rejected", "blocked", "attention"]);

export function connectShellOutbox(userId: string, deps: ShellOutboxDeps): ShellOutbox {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const delay = deps.redrawDelayMs ?? 50;
  let stopped = false;
  let pending: unknown = null;

  const outbox = deps.getOutbox(userId);
  const unsubscribe = outbox.subscribe((event) => {
    if (stopped || !REDRAW_ON.has(event.type) || pending !== null) return;
    pending = setTimer(() => {
      pending = null;
      if (!stopped) deps.onSettled();
    }, delay);
  });

  return {
    nudge() {
      if (stopped) return;
      void outbox.flush().catch(() => {
        /* flush never throws by contract; a broken one must not break the shell */
      });
    },
    stop() {
      stopped = true;
      unsubscribe();
      if (pending !== null) clearTimer(pending);
      pending = null;
    },
  };
}
