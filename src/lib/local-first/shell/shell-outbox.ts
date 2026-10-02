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

type OutboxLike = Pick<Outbox, "flush" | "subscribe">;

export type ShellOutboxDeps<O extends OutboxLike = OutboxLike> = {
  /** The person's shared outbox (created and resumed on first call). */
  getOutbox: (userId: string) => O;
  /** Redraw the screen from the laptop's database. */
  onSettled: () => void;
  /** Coalescing window for redraws (ms). */
  redrawDelayMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/**
 * THE CARD THAT SAYS WHEN A CHANGE NEEDS THE PERSON (OutboxAttention): a change the server turned down (with what they typed kept
 * as a draft), a conflict, one that needs the online screen. The online app mounts it once in (app)/layout.tsx; the on-laptop shell
 * mounted it only inside the dashboard screen, so on every other shell screen (work progress, labour, materials, documents, design
 * and change ...) a turned-down change was undone with no word to the person (found by lf-e10a in a real Chromium). The shell now
 * mounts it once for every screen -- except the screens that already render their own, so the person never sees it twice.
 */
export const SCREENS_WITH_OWN_OUTBOX_CARD: readonly string[] = [];

/** Whether the shell itself shows the outbox card on the screen of this route pattern (null = no screen matched, e.g. "/"). */
export function shellShowsOutboxCard(pattern: string | null): boolean {
  return pattern === null || !SCREENS_WITH_OWN_OUTBOX_CARD.includes(pattern);
}

export type ShellOutbox<O extends OutboxLike = OutboxLike> = {
  /** The person's outbox, for the card. */
  outbox: O;
  /** Send what is due now (back online, the tab came back to the front). */
  nudge(): void;
  stop(): void;
};

/** Events after which what the screen shows may have changed. */
const REDRAW_ON: ReadonlySet<OutboxEvent["type"]> = new Set(["changed", "applied", "conflict", "rejected", "blocked", "attention"]);

export function connectShellOutbox<O extends OutboxLike>(userId: string, deps: ShellOutboxDeps<O>): ShellOutbox<O> {
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
    outbox,
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
