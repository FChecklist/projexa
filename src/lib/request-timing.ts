// R67 F-28 (audit recommendation R-249) -- THE PER-REQUEST TIMING LEDGER.
//
// THE PROBLEM IT SOLVES. The audit could not say, for any PROJEXA screen,
// which part of a slow call was VERIDIAN's own cost and which was PROJEXA's
// hop: no response carried a duration, and the numbers in the report had to be
// reconstructed by hand from dev-server log lines. Without that split, "the
// /scope screen is slow" is unactionable -- it could equally be an N+1 in a
// service, a serial chain in a page, or a cold function.
//
// WHY AN AsyncLocalStorage AND NOT A PARAMETER. The alternative is threading a
// timing object from every route handler into every callVeridian() call, which
// means touching ~250 route files AND every call site inside them, and getting
// a wrong answer the moment one call site forgets. ALS gives the same answer
// with two touch points: withTiming() opens the scope, and veridian-client's
// own fetch adds to it. Concurrency-safe by construction -- each request gets
// its own store, and two overlapping requests cannot see each other's totals,
// which a module-level "last duration" variable could not promise.
//
// It runs in the Node runtime only. That is where every PROJEXA route handler
// runs (src/middleware.ts is the one Edge module in this repo and deliberately
// imports nothing from here -- see the note on @/lib/authz/roles in
// auth-guard.ts). recordUpstream() outside a scope is a silent no-op, so
// server components and scripts that import veridian-client are unaffected.

import { AsyncLocalStorage } from "node:async_hooks";

export type RequestTiming = {
  /** Total wall time spent waiting on VERIDIAN in this request, ms. */
  upstreamMs: number;
  /**
   * The SLOWEST single upstream call in this request, ms.
   *
   * On a FAN-OUT route the sum above overstates the wait: /api/shell issues
   * six lookups concurrently, so its user waited for the slowest one, not for
   * all six added together. Both numbers are wanted and they answer different
   * questions -- the sum is how much upstream work a request caused, the max is
   * how long the person actually sat there -- so both are recorded in ONE place
   * rather than each route inventing its own. `Server-Timing: upstream` stays
   * the sum, which is what perf-harness.mjs reads; the max goes in the
   * structured log line beside it.
   */
  upstreamMaxMs: number;
  /** How many upstream calls it took. A screen budget cares about this too. */
  upstreamCalls: number;
  /** The caller's organisation, once an auth guard has resolved it. */
  orgId: string | null;
};

const timingStore = new AsyncLocalStorage<RequestTiming>();

export function beginRequestTiming(): RequestTiming {
  return { upstreamMs: 0, upstreamMaxMs: 0, upstreamCalls: 0, orgId: null };
}

/** Runs `fn` with `timing` as the ambient ledger for everything it awaits. */
export function runWithRequestTiming<T>(timing: RequestTiming, fn: () => Promise<T>): Promise<T> {
  return timingStore.run(timing, fn);
}

/**
 * Adds one upstream call's wall time to the current request's ledger.
 *
 * Called by veridian-client on EVERY settled path -- success, timeout,
 * connection failure -- because a call that failed after 8 s cost the user
 * those 8 s just as surely as a slow success did, and a Server-Timing header
 * that only counted successes would understate exactly the requests worth
 * investigating.
 */
export function recordUpstream(durationMs: number): void {
  const timing = timingStore.getStore();
  if (!timing) return;
  const ms = Math.max(0, durationMs);
  timing.upstreamMs += ms;
  if (ms > timing.upstreamMaxMs) timing.upstreamMaxMs = ms;
  timing.upstreamCalls += 1;
}

/**
 * Records whose request this is, for the structured log line. Called from the
 * auth guard, so every authenticated route contributes it without any route
 * needing to remember to.
 */
export function recordRequestOrg(orgId: string | null | undefined): void {
  const timing = timingStore.getStore();
  if (timing && orgId) timing.orgId = orgId;
}

/** The current request's ledger, or undefined outside a timed scope. */
export function currentRequestTiming(): RequestTiming | undefined {
  return timingStore.getStore();
}
