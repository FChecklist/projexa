// R67 D-04 -- "Where module pages fetch their data".
//
// DECISION D-04, verbatim: "Option A: server-component fetch in the Next.js
// route, streamed with Suspense, with the VERIDIAN API key kept server-side.
// Option B (browser calls direct to VERIDIAN) is rejected because it would
// expose the org API key or require a second proxy." Its concrete additions
// are a per-request AbortSignal and an 8 s budget with a visible
// "Still loading…" state at 3 s.
//
// Both numbers live HERE, in one server-safe module with no "use client" and
// no DB import, so the server half (src/lib/veridian-client.ts's per-call
// timeout) and the client half (src/components/ScreenLoading.tsx's caption)
// can never drift apart -- which is exactly how a 3 s caption ends up
// promising a wait that a 20 s timeout has already made a lie.
//
// WHY 8 s AND NOT THE CLIENT'S EXISTING 20 s: veridian-client.ts's
// VERIDIAN_FETCH_TIMEOUT_MS (20 s, with one retry on an idempotent call) is
// the ceiling for ANY call including writes, chosen against Vercel's 300 s
// function cap. A screen read is a different contract: nobody looks at a
// module page for 20 s, and a page that streams its shell immediately can
// afford to give up on the data far sooner and say so. The 20 s default is
// unchanged for every caller that does not opt in.

/** The read budget a module page gives one VERIDIAN screen call. */
export const VERIDIAN_SCREEN_BUDGET_MS = 8_000;

/** When the user is first told, in words, that the read is still running. */
export const SLOW_READ_NOTICE_MS = 3_000;

/**
 * The caption under a screen's skeleton. `null` before the notice threshold --
 * a skeleton alone is the honest answer for the first three seconds; a
 * "still loading" line shown instantly would be noise on every fast page.
 *
 * `entity` is the module's own noun as the user reads it ("permits",
 * "the schedule"), never an endpoint or a function id.
 */
export function stillLoadingCaption(elapsedMs: number, entity: string): string | null {
  if (elapsedMs < SLOW_READ_NOTICE_MS) return null;
  const seconds = Math.floor(elapsedMs / 1000);
  return `Still loading ${entity} — ${seconds} s`;
}

/**
 * Combines an optional caller-supplied AbortSignal with the budget's own
 * timeout, so a caller can cancel early (a superseded request, a closed
 * stream) without losing the budget, and vice versa.
 *
 * AbortSignal.any is used where the runtime has it (Node 20.3+, every
 * browser this app supports); the fallback keeps the budget rather than
 * silently dropping one of the two signals, because dropping the timeout is
 * how an unbounded fetch comes back.
 */
export function budgetSignal(timeoutMs: number, callerSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!callerSignal) return timeout;
  const any = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof any === "function") return any([timeout, callerSignal]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (callerSignal.aborted) abort();
  else callerSignal.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  return controller.signal;
}
