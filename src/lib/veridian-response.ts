// R67 F-20 (audit recommendation R-238) -- the ONE place a PROJEXA /api/*
// proxy turns a VERIDIAN failure into an HTTP response.
//
// THE DEFECT THIS REMOVES. Every proxy handler in this repo ends with its own
// hand-written copy of
//
//     return NextResponse.json(
//       { error: err instanceof VeridianApiError ? err.message : "Failed to load X" },
//       { status: err instanceof VeridianApiError ? err.status : 502 }
//     );
//
// which has three consequences the audit measured. (1) A hung upstream came
// back as a bare 504 with no Retry-After, so nothing -- not the browser, not
// the client code, not a human -- knew whether waiting was worth anything.
// (2) The KIND of failure was destroyed: a timeout, a dead socket and an
// unconfigured storage client all arrived as an anonymous string, so the
// screen could only ever say "something went wrong". (3) There was no timing
// anywhere, which is why the audit had to reconstruct per-call durations from
// dev-server log lines.
//
// So a failure now answers with the typed `code` (the closed set on
// VeridianErrorCode), `Retry-After: 5` when retrying is genuinely the right
// move, and `Server-Timing: upstream;dur=<ms>` measured by veridian-client
// itself. C07-16's visible "Still loading…"/"taking longer than usual" states
// consume exactly these codes.

import { NextResponse } from "next/server";
import { VeridianApiError, type VeridianErrorCode } from "@/lib/veridian-client";

// The failure classes where the upstream never gave a real answer, so the
// honest status is "service unavailable, try again" rather than whatever
// number the transport happened to produce. A 4xx is NOT in this set: a 404
// or a 400 is a real, specific answer and retrying it changes nothing.
//
// STORAGE_UNAVAILABLE is deliberately NOT here, although it is an
// infrastructure failure. It means VERIDIAN's file-storage client has no
// supabaseKey configured, and the sentence the user is shown says so: "…this
// needs an administrator." An unconfigured key does not become configured in
// five seconds. Telling every client to come back then would build precisely
// the queue behind a broken service that RETRY_AFTER_SECONDS below says it is
// avoiding, and it would contradict the words already on the screen. The code
// still travels -- it is what lets a screen say "this needs an administrator"
// instead of "something went wrong" -- it just keeps its own status and gets
// no Retry-After.
const RETRYABLE_CODES: ReadonlySet<VeridianErrorCode> = new Set<VeridianErrorCode>([
  "UPSTREAM_TIMEOUT",
  "NETWORK",
]);

// Seconds. Deliberately short: veridian-client's own budget is 8 s, so a
// second attempt five seconds later is a genuine second chance at a
// transient hang, not a queue forming behind a broken service.
export const RETRY_AFTER_SECONDS = 5;

export function serverTimingHeader(upstreamMs: number, appMs?: number): string {
  const parts = [`upstream;dur=${Math.max(0, Math.round(upstreamMs))}`];
  if (typeof appMs === "number") parts.push(`app;dur=${Math.max(0, Math.round(appMs))}`);
  return parts.join(", ");
}

export type UpstreamFailure = {
  status: number;
  code: VeridianErrorCode | null;
  message: string;
  durationMs: number;
  retryable: boolean;
};

/**
 * Classify any thrown value from veridian-client into the shape a proxy
 * answers with. Exported separately from the NextResponse builder so it can
 * be unit-tested without a Next request context.
 */
export function classifyUpstreamFailure(err: unknown, fallbackMessage: string): UpstreamFailure {
  // A failed VeridianResult (callVeridianResult's non-throwing form) carries
  // exactly the same four facts as the thrown error, so a handler can pass
  // either one and get the same answer. Structural, not `instanceof`, because
  // the result is a plain object by design.
  if (
    err !== null &&
    typeof err === "object" &&
    !(err instanceof Error) &&
    (err as { ok?: unknown }).ok === false &&
    typeof (err as { status?: unknown }).status === "number"
  ) {
    const r = err as { status: number; code: VeridianErrorCode | null; message?: string; durationMs?: number };
    const retryable = r.code !== null && RETRYABLE_CODES.has(r.code);
    return {
      status: retryable ? 503 : r.status,
      code: r.code,
      message: r.message && r.message.trim() ? r.message : fallbackMessage,
      durationMs: r.durationMs ?? 0,
      retryable,
    };
  }
  if (err instanceof VeridianApiError) {
    const retryable = err.code !== null && RETRYABLE_CODES.has(err.code);
    return {
      // A retryable failure is always reported as 503 + Retry-After, whatever
      // transport-level number it arrived as (504 for a timeout, 502 for a
      // dead socket). One status for "the service isn't answering" means the
      // client has one branch to write instead of three.
      status: retryable ? 503 : err.status,
      code: err.code,
      message: err.message,
      durationMs: err.durationMs,
      retryable,
    };
  }
  return { status: 502, code: "NETWORK", message: fallbackMessage, durationMs: 0, retryable: true };
}

/**
 * The error response every proxy handler returns. `fallbackMessage` is only
 * used when the thrown value carries no message of its own -- the backend's
 * own words always win (C19 ERROR_TRUTHFUL).
 */
export function veridianErrorResponse(err: unknown, fallbackMessage: string, appMs?: number): NextResponse {
  const failure = classifyUpstreamFailure(err, fallbackMessage);
  const headers: Record<string, string> = {
    "Server-Timing": serverTimingHeader(failure.durationMs, appMs),
  };
  if (failure.retryable) headers["Retry-After"] = String(RETRY_AFTER_SECONDS);
  return NextResponse.json(
    { error: failure.message, code: failure.code },
    { status: failure.status, headers }
  );
}

// There is deliberately NO veridianJsonResponse() success counterpart here.
// One was written for the success path before F-28 landed, and F-28 made it a
// trap: withTiming() wraps every handler in this repo and sets Server-Timing
// from the request-timing ledger AFTER the handler returns, overwriting
// whatever the handler set. A helper that invites a route to compute a second
// upstream figure produces a number nobody can observe and that disagrees with
// the one they can. The success header has exactly one owner (withTiming); the
// error path keeps its own because veridianErrorResponse also decides the
// STATUS and the Retry-After, and its duration comes from the failure it is
// already holding.
