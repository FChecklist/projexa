// LOCAL-FIRST AUTO-SYNC (R3/R14): the laptop syncs by itself, with no button, and cheaply.
//
// When it runs:
//   * on app open, on coming back online, when the tab becomes visible again after a while, when a new peer is verified;
//   * on a long timer: every 5 minutes while the person is working; when nothing changed it backs off (5 -> 10 -> 20 -> 30
//     minutes); while the tab is hidden, every 30 minutes; and once the tab has been hidden for long (60 minutes by default)
//     NOT AT ALL unless a peer is connected -- a forgotten background tab costs nothing.
// What one run does: the server step (sync from Supabase; it starts with a cheap /changes head check and pulls only when a head
// moved, see server-step.ts) and the peer step (ask connected laptops for anything new), IN PARALLEL, so a peer still helps while
// our server is down and the server still helps when there is no peer. While a peer IS connected the server step runs at most
// every `serverWithPeersMs` (30 minutes; always on open / online / manual): peers first, the server for what only it knows.
// Never a storm: one run at a time across tabs (Web Locks, `ifAvailable`: a second tab simply skips), at most one run per
// `minGapMs` from triggers, and every trigger that arrives during a run is folded into it -- except `online` / `manual`, which are
// OWED and run once when the gap ends (B28: a network that comes back right after a run is never ignored).
//
// THE DOCUMENTED INTERVAL (AUDIT-100 B7/B28; what e2e/lf-lifecycle-live-sync.spec.ts and peer/live-sync.test.ts hold it to): a colleague's
// change to the project this laptop has OPEN (the one the shell shows, shell/context.ts activeProjectFor) is on this laptop -- and on its
// open screen, without a reload -- by the next timer run: within `baseMs` (5 minutes) while things change, within the backed-off period
// (at most `idleMaxMs`, 30 minutes) on an idle laptop; at once (within `minGapMs`) when the network comes back. A change to a project
// that is NOT open waits at most server-step.ts's `othersEveryMs` (an hour) after that project's previous read, or until it is opened.
//
// Everything is injected (clock, visibility, online state, the two steps, the lock manager), so the tests drive it with a fake clock.

import { reportFault } from "../sync-fault-report";

export type SchedulerClock = {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export type StepResult = { changed: boolean } | void;

export type TriggerReason = "open" | "online" | "visible" | "peer" | "timer" | "manual";

export type SchedulerOptions = {
  clock?: SchedulerClock;
  isVisible: () => boolean;
  isOnline: () => boolean;
  peersConnected: () => number;
  /** Sync with Supabase (head check first). Throwing = the server is unreachable; the run still counts. */
  serverStep: () => Promise<StepResult>;
  /** Sync with connected laptops. */
  peerStep: () => Promise<StepResult>;
  /** navigator.locks; null forces the in-tab guard only. */
  locks?: LockManager | null;
  lockName?: string;
  baseMs?: number;
  idleMaxMs?: number;
  hiddenMs?: number;
  hiddenLongMs?: number;
  minGapMs?: number;
  /** While a peer is connected, the server step runs at most this often (except on open / online / manual). Default 30 minutes. */
  serverWithPeersMs?: number;
  onRun?: (info: { reason: TriggerReason; server: "ok" | "failed" | "skipped"; peers: "ok" | "failed" | "skipped"; changed: boolean }) => void;
};

export type SyncScheduler = {
  start(): void;
  trigger(reason: TriggerReason): Promise<void>;
  /** Tell the scheduler the tab's visibility changed (wired to `visibilitychange`). */
  visibilityChanged(): void;
  stop(): void;
  /** For the tests and the UI: when the next timer run is due (null = none scheduled). */
  nextRunAt(): number | null;
  readonly runs: number;
};

export const DEFAULTS = { baseMs: 5 * 60_000, idleMaxMs: 30 * 60_000, hiddenMs: 30 * 60_000, hiddenLongMs: 60 * 60_000, minGapMs: 30_000, serverWithPeersMs: 30 * 60_000 } as const;

const realClock: SchedulerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createSyncScheduler(o: SchedulerOptions): SyncScheduler {
  const clock = o.clock ?? realClock;
  const baseMs = o.baseMs ?? DEFAULTS.baseMs;
  const idleMaxMs = o.idleMaxMs ?? DEFAULTS.idleMaxMs;
  const hiddenMs = o.hiddenMs ?? DEFAULTS.hiddenMs;
  const hiddenLongMs = o.hiddenLongMs ?? DEFAULTS.hiddenLongMs;
  const minGapMs = o.minGapMs ?? DEFAULTS.minGapMs;
  const locks = o.locks !== undefined ? o.locks : typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks ?? null : null;
  const lockName = o.lockName ?? "px-auto-sync";

  let timer: unknown = null;
  let due: number | null = null;
  let running: Promise<void> | null = null;
  let lastRunAt = -Infinity;
  let lastServerAt = -Infinity;
  const serverWithPeersMs = o.serverWithPeersMs ?? DEFAULTS.serverWithPeersMs;
  let idleStreak = 0;
  let hiddenSince: number | null = o.isVisible() ? null : clock.now();
  let stopped = true;
  let runs = 0;

  const hiddenLong = () => hiddenSince !== null && clock.now() - hiddenSince >= hiddenLongMs;
  /** A long-hidden tab with no peer does nothing at all. */
  const suspended = () => hiddenLong() && o.peersConnected() === 0;

  function delay(): number | null {
    if (suspended()) return null;
    if (hiddenSince !== null) return hiddenMs;
    return Math.min(baseMs * 2 ** Math.max(0, idleStreak - 1), idleMaxMs); // the first quiet run still waits only baseMs
  }

  /**
   * AUDIT-100 B28: an `online` (or `manual`) trigger that arrived during a run or within `minGapMs` of the last one is OWED, not dropped:
   * it runs once, as soon as the gap ends. Before, a laptop whose network came back less than `minGapMs` after its last run (a short
   * blip; Wi-Fi switching) ignored "the network is back" and waited for the long timer (5 -> 30 minutes) to catch up. Still never a
   * storm: at most one owed run per gap, whatever the number of triggers.
   */
  let owed: TriggerReason | null = null;

  function schedule() {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    due = null;
    if (stopped) return;
    const d = owed !== null ? Math.max(0, lastRunAt + minGapMs - clock.now()) : delay();
    if (d === null) return;
    due = clock.now() + d;
    timer = clock.setTimeout(() => {
      timer = null;
      due = null;
      const reason = owed ?? "timer";
      owed = null;
      void trigger(reason);
    }, d);
  }

  async function runOnce(reason: TriggerReason) {
    runs += 1;
    lastRunAt = clock.now();
    const online = o.isOnline();
    const peers = o.peersConnected();
    // PEERS FIRST (package lf-e6, R14): while a verified laptop of the same organisation and view class is connected, rows come
    // from it, and the server is asked at most once per `serverWithPeersMs` -- still regularly, because only the server
    // delivers tombstones, redaction changes and projects that were taken away. Opening the app, coming back online and a
    // manual sync always ask the server.
    const forced = reason === "open" || reason === "online" || reason === "manual";
    const serverDue = online && (peers === 0 || forced || clock.now() - lastServerAt >= serverWithPeersMs);
    if (serverDue) lastServerAt = clock.now();
    const [s, p] = await Promise.allSettled([
      serverDue ? o.serverStep() : Promise.resolve("skipped" as const),
      peers > 0 ? o.peerStep() : Promise.resolve("skipped" as const),
    ]);
    const changedOf = (r: PromiseSettledResult<unknown>) => r.status === "fulfilled" && typeof r.value === "object" && r.value !== null && (r.value as { changed?: boolean }).changed === true;
    const changed = changedOf(s) || changedOf(p);
    idleStreak = changed ? 0 : Math.min(idleStreak + 1, 8);
    const word = (r: PromiseSettledResult<unknown>, ran: boolean) => (!ran ? "skipped" : r.status === "fulfilled" ? "ok" : "failed") as "ok" | "failed" | "skipped";
    o.onRun?.({ reason, server: word(s, serverDue), peers: word(p, peers > 0), changed });
  }

  async function trigger(reason: TriggerReason): Promise<void> {
    if (stopped) return;
    const mustRun = reason === "online" || reason === "manual";
    if (running) {
      if (mustRun) owed = reason; // the run in flight may have started offline: one more once it ends (B28)
      return running; // folded into the run in flight
    }
    if (reason !== "timer" && clock.now() - lastRunAt < minGapMs) { // a burst of triggers is one run
      if (mustRun) { owed = reason; schedule(); } // ... but "the network is back" is honoured when the gap ends (B28)
      return;
    }
    if (reason !== "timer") owed = null; // this run serves what was owed
    if (reason === "timer" && suspended()) { schedule(); return; }
    if (reason === "peer" || reason === "online" || reason === "visible" || reason === "manual") idleStreak = 0;
    running = (async () => {
      try {
        if (locks?.request) {
          await locks.request(lockName, { ifAvailable: true }, async (lock) => {
            if (!lock) return; // another tab is syncing for this browser right now
            await runOnce(reason);
          });
        } else {
          await runOnce(reason);
        }
      } catch (err) {
        reportFault("peer:sync", err); // never escapes into the UI, but it does reach us (B57)
      } finally {
        running = null;
        schedule();
      }
    })();
    return running;
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      void trigger("open");
    },
    trigger,
    visibilityChanged() {
      if (o.isVisible()) {
        const wasLong = hiddenLong();
        hiddenSince = null;
        if (wasLong || clock.now() - lastRunAt >= baseMs) void trigger("visible");
        else schedule();
      } else {
        if (hiddenSince === null) hiddenSince = clock.now();
        schedule();
      }
    },
    stop() {
      stopped = true;
      if (timer !== null) clock.clearTimeout(timer);
      timer = null;
      due = null;
    },
    nextRunAt: () => due,
    get runs() { return runs; },
  };
}
