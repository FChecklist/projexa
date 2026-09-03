// R67 F-28 (audit recommendation R-249) -- THE WRAPPER EVERY /api/* ROUTE WEARS.
//
// WHAT IT ADDS, AND WHY EACH PART EARNS ITS PLACE.
//
//   Server-Timing: upstream;dur=<ms>, app;dur=<ms>
//     The split the audit could not make. `upstream` is the wall time this
//     request spent waiting on VERIDIAN (summed over every call it made);
//     `app` is everything else -- auth, cookie reads, JSON, the proxy's own
//     work. A screen that is slow because the ERP is slow and a screen that is
//     slow because the hop is slow need completely different fixes, and until
//     this header existed there was no way to tell them apart from outside.
//     The browser surfaces it in DevTools' network panel for free, and
//     perf-harness.mjs reads it per request to build the per-module table.
//
//   One structured log line per request
//     { t, route, method, status, upstreamMs, appMs, upstreamCalls, orgId }.
//     One line, parseable, so "which route is spending the time" is a grep and
//     not an archaeology exercise. This is precisely what the audit had to do
//     by hand against unstructured `GET /api/tasks?limit=50 504 in 56s` lines.
//
// It does NOT change any response body, any status, or any other header. A
// handler that throws still throws (Next renders its own 500) -- the failure
// is logged with its duration first, because a request that took 9 s and then
// crashed is the most interesting row in any latency table.

import { beginRequestTiming, runWithRequestTiming, type RequestTiming } from "@/lib/request-timing";
import { serverTimingHeader } from "@/lib/veridian-response";

/** Marks an already-wrapped handler, so a re-export chain cannot double-count. */
const WRAPPED = Symbol.for("projexa.withTiming");

type AnyHandler<A extends unknown[]> = (...args: A) => Promise<Response>;

/**
 * The request path, taken from the NextRequest the framework passes as the
 * first argument. Read defensively: a handler may declare no parameters at
 * all (several GETs in this repo do), and the route name is diagnostic
 * information -- it must never be the reason a request fails.
 */
function routeOf(args: unknown[]): string {
  const first = args[0] as { nextUrl?: { pathname?: string }; url?: string } | undefined;
  if (first?.nextUrl?.pathname) return first.nextUrl.pathname;
  if (typeof first?.url === "string") {
    try {
      return new URL(first.url).pathname;
    } catch {
      /* not a URL -- fall through */
    }
  }
  return "unknown";
}

function emit(
  route: string,
  method: string,
  status: number,
  timing: RequestTiming,
  totalMs: number
): number {
  // `app` is the time this process spent on its own work. Clamped at zero:
  // the two clocks are read at different moments and a few milliseconds of
  // drift must never produce a negative duration in a header other tools
  // parse.
  const appMs = Math.max(0, totalMs - timing.upstreamMs);
  console.log(
    JSON.stringify({
      t: "api",
      route,
      method,
      status,
      upstreamMs: Math.round(timing.upstreamMs),
      appMs: Math.round(appMs),
      upstreamCalls: timing.upstreamCalls,
      // The slowest SINGLE upstream call. On a fan-out route (/api/shell runs
      // six lookups at once) upstreamMs is the work caused and this is the
      // wait endured; they differ by a lot, and reading the sum as the wait is
      // how a concurrent route gets blamed for latency it does not have. One
      // definition, recorded in request-timing.ts, so no route computes a
      // second one of its own -- a header set inside a handler is overwritten
      // by the one this wrapper sets anyway.
      upstreamMaxMs: Math.round(timing.upstreamMaxMs),
      orgId: timing.orgId,
    })
  );
  return appMs;
}

/**
 * Wraps one route handler.
 *
 * Generic over the handler's own parameter list rather than pinned to
 * (NextRequest, context): Next passes a second argument only to dynamic
 * segments, and several handlers in this repo declare no parameters at all.
 * Preserving the exact signature is what keeps Next's own route type-check
 * satisfied.
 */
export function withTiming<A extends unknown[]>(method: string, handler: AnyHandler<A>): AnyHandler<A> {
  // A route that re-exports another route's handler would otherwise wrap it
  // twice and log the same request under two names.
  if ((handler as { [WRAPPED]?: boolean })[WRAPPED]) return handler;

  const wrapped = async (...args: A): Promise<Response> => {
    const timing = beginRequestTiming();
    const startedAt = Date.now();
    const route = routeOf(args);
    try {
      const res = await runWithRequestTiming(timing, () => handler(...args));
      const appMs = emit(route, method, res.status, timing, Date.now() - startedAt);
      // Headers on a NextResponse are mutable; on a plain Response built by
      // some other means they may not be. A timing header is never worth
      // failing a request that otherwise succeeded.
      try {
        res.headers.set("Server-Timing", serverTimingHeader(timing.upstreamMs, appMs));
      } catch {
        /* immutable headers -- the log line still carries the numbers */
      }
      return res;
    } catch (err) {
      emit(route, method, 500, timing, Date.now() - startedAt);
      throw err;
    }
  };

  (wrapped as { [WRAPPED]?: boolean })[WRAPPED] = true;
  return wrapped;
}
