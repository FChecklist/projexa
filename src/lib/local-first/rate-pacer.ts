// LOCAL-FIRST COST (package lf-fc, review wire:F07 / cost:COST-03): the laptop's own speed limit for requests to the sync service.
//
// The service allows 120 requests a minute per person (handler.ts REQUESTS_PER_MINUTE, a rolling minute per isolate) and answers 429
// with `Retry-After: 60` past it. A first copy of P projects sends about 28P keyset pulls; without pacing, from about 4 projects the cap
// was met mid-sync, 186 of 306 requests were answered 429 (harness W26) and the copy ended "partial". This pacer keeps the replica at or
// below PACE_PER_MINUTE (100: a margin of 20 for the outbox, the shell's manifest refresh and a second tab) in a SLIDING minute, so the
// cap is never met by the laptop's own traffic. When the server does say 429 with Retry-After, pauseUntil() makes EVERY caller wait
// until then, instead of each request failing on its own.
//
// Pure apart from the injected clock and sleep (tests and the cost harness pass a simulated clock; the browser uses the real one).
// It never sends anything itself and holds no timer when nobody is waiting.

export const PACE_PER_MINUTE = 100;
export const PACE_WINDOW_MS = 60_000;

export type RequestPacer = {
  /** Resolves when one more request may leave now (and counts it). Resolves early, without counting, when `signal` aborts. */
  take(signal?: AbortSignal): Promise<void>;
  /** The server asked the laptop to wait (429 + Retry-After): no request leaves before `atMs`. Never shortens an existing pause. */
  pauseUntil(atMs: number): void;
  /** pauseUntil(now + ms) on the pacer's OWN clock (callers with another clock use this). */
  pauseFor(ms: number): void;
  /** Requests counted in the current window (diagnostics, tests). */
  inWindow(): number;
};

export type PacerOptions = {
  perMinute?: number;
  windowMs?: number;
  now?: () => number;
  /** Waits `ms` on the same clock as `now`; resolves early when the signal aborts. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const realSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

export function createRequestPacer(options: PacerOptions = {}): RequestPacer {
  const perMinute = Math.max(1, options.perMinute ?? PACE_PER_MINUTE);
  const windowMs = Math.max(1, options.windowMs ?? PACE_WINDOW_MS);
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? realSleep;
  const stamps: number[] = [];
  let pausedUntil = 0;

  const pauseUntil = (atMs: number) => {
    if (Number.isFinite(atMs) && atMs > pausedUntil) pausedUntil = atMs;
  };
  const prune = (t: number) => {
    while (stamps.length && t - stamps[0]! >= windowMs) stamps.shift();
  };

  return {
    async take(signal) {
      for (;;) {
        if (signal?.aborted) return;
        const t = now();
        if (pausedUntil > t) {
          await sleep(pausedUntil - t, signal);
          continue;
        }
        prune(t);
        if (stamps.length < perMinute) {
          stamps.push(t);
          return;
        }
        // The oldest request in the window leaves it at stamps[0] + windowMs: wait exactly that long (at least 1 ms, so a clock that
        // has not moved cannot spin).
        await sleep(Math.max(1, stamps[0]! + windowMs - t), signal);
      }
    },
    pauseUntil,
    pauseFor(ms) {
      if (Number.isFinite(ms) && ms > 0) pauseUntil(now() + ms);
    },
    inWindow() {
      prune(now());
      return stamps.length;
    },
  };
}
