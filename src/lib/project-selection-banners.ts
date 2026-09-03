// R67 D1 CI FIX (2026-09-03): pulled out of project-selection.ts, which is server-only
// (it imports next/headers' cookies() and @/lib/veridian-client, which in turn imports
// @/lib/db -- a real Postgres driver needing Node's fs/net/tls/perf_hooks).
//
// Two "use client" components (DrawingCreateClient.tsx, CreateScreenUnavailable.tsx) need
// only these three PURE symbols -- no I/O, no cookies, no DB -- but importing them FROM
// project-selection.ts pulled that file's whole module graph into the client bundle:
// Turbopack failed the build with "Module not found: Can't resolve 'fs'/'net'/'tls'/
// 'perf_hooks'" from src/lib/project-selection.ts [app-client]. tsc --noEmit does not
// catch this class of defect -- only a real `next build` does.
//
// This file has ZERO imports by design. Do not add one without checking it stays
// client-safe -- that is the entire reason it exists.

/**
 * VERIDIAN's raw failure strings are sometimes exactly what a construction
 * DataLoadError's header says a real API caller must never render (a bare
 * "Internal Server Error"), and this keeps them -- with that one exception. A
 * message that says nothing is replaced by one that says which call failed and
 * who answered; every real VERIDIAN message, including its timeout wording,
 * passes through untouched.
 */
export function describeProjectListFailure(raw: string): string {
  return /^(internal server error|internal error|error|500|bad gateway|502|service unavailable|503)\.?$/i.test(raw.trim())
    ? "VERIDIAN answered with an internal error."
    : raw;
}

/** The one sentence every create screen leads its failure banner with. */
export function projectListFailureBanner(raw: string): string {
  return `Couldn't load your project list: ${describeProjectListFailure(raw)}`;
}

/**
 * The one reason a create screen's Save states while there is no project list to
 * write against. It outranks every field-level reason: there is nothing to write
 * to, whatever the form says.
 */
export const PROJECT_LIST_UNAVAILABLE_REASON = "project list unavailable";
