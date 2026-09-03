import { db, veridianCredentials } from "@/lib/db";
import { eq } from "drizzle-orm";
import { unstable_cache } from "next/cache";
// R67 F-28: every settled upstream call adds its wall time to the current
// request's ledger, which is how withTiming() can report `upstream` and `app`
// separately without any route handler threading a timer through its calls.
// A no-op outside a timed scope (server components, scripts).
import { recordUpstream } from "@/lib/request-timing";

// R67 D-04: re-exported so a module page can write one import
// (`callVeridian(..., { timeoutMs: VERIDIAN_SCREEN_BUDGET_MS })`) instead of
// reaching into two files for one call. The number itself lives in
// src/lib/screen-budget.ts, next to the 3 s "Still loading…" threshold it has
// to stay consistent with.
//
// R67 MERGE (lane D0 x lane F2). Lane D0 gave this file an opt-in `timeoutMs`
// and `signal` implemented with screen-budget's budgetSignal(), which composes
// AbortSignal.timeout() with the caller's signal. Lane F2 replaced the whole
// abort mechanism because AbortSignal.timeout() NEVER FIRES on Bun 1.3.14
// (Windows) -- the runtime this repo's unit tests execute in -- so the budget
// was untestable and any Bun-hosted execution had no timeout at all. The
// explicit AbortController + setTimeout in attemptFetch() below does exactly
// what budgetSignal() promised (a per-call budget composed WITH the caller's
// own cancellation, never replacing it) and does it on both runtimes. D0's
// PUBLIC SURFACE is kept unchanged, so the four callers that pass
// `{ timeoutMs: VERIDIAN_SCREEN_BUDGET_MS }` are untouched; budgetSignal()
// itself stays exported and tested in screen-budget.ts for callers outside
// this file.
export { VERIDIAN_SCREEN_BUDGET_MS } from "@/lib/screen-budget";

// PROJEXA's only connection to construction data: every call goes through
// VERIDIAN's /api/v1/projexa/* surface with a Bearer API key. This file
// never runs in the browser (server components / route handlers only) --
// no VERIDIAN key (per-org or platform) must ever reach the client.
//
// Platform provisioning (Priority 17): every new signup gets its own
// isolated VERIDIAN org + API key via POST /api/v1/platform/provision-org
// (see provisionVeridianOrg() below), stored per-organization in
// public.veridian_credentials. getVeridianApiKey(organizationId) is the
// ONLY path for resolving an org-scoped caller's key -- see resolveApiKey()
// below. Per AR-04 (fail loud, never silently swap tenants), a caller that
// passes organizationId but has no veridian_credentials row gets a thrown
// error, never the shared VERIDIAN_API_KEY. That shared key remains in use
// only as the key for calls that omit organizationId entirely (legacy call
// sites still being migrated).
const VERIDIAN_API_BASE = process.env.VERIDIAN_API_BASE_URL ?? "https://veridian-compliance-ai.vercel.app/api/v1/projexa";

// A handful of real, already-shipped VERIDIAN v1 endpoints PROJEXA needs
// (labour roster, KPI entries, generic documents) were never re-exported
// under /api/v1/projexa/* -- they only exist at their original /api/v1/*
// location (e.g. /api/v1/construction/labour-roster, /api/v1/documents).
// Rather than waiting on VERIDIAN to add projexa/* aliases for them, calls
// that need one of those paths pass `root: true` to reach VERIDIAN_API_ROOT
// (the base URL one level up, stripped of the "/projexa" suffix) instead of
// VERIDIAN_API_BASE. Same auth, same host, just a different path prefix.
// The platform provisioning endpoint (/platform/provision-org) also lives
// under this root, one level above the /projexa/* surface.
const VERIDIAN_API_ROOT = VERIDIAN_API_BASE.replace(/\/projexa$/, "");

// Point 118: the public share-link resolve route lives OUTSIDE /api/v1
// entirely (compliance-tracker's own /api/reports/share/[token], mirroring
// /api/veri-meetings/share/[token] -- neither is under /api/v1/*, since
// they carry no auth of any kind, Bearer or session). Exported so the
// public share page can reach it with a plain, unauthenticated fetch --
// never through callVeridian/callVeridianRaw, which always resolve an API
// key first and would defeat the point of a link that needs no credentials.
export const VERIDIAN_ORIGIN = VERIDIAN_API_ROOT.replace(/\/api\/v1$/, "");

// R67 F-20. The CLOSED set of upstream failure codes. Every screen and every
// /api/* proxy answers from this vocabulary, so a caller can branch on the
// KIND of failure without parsing a message:
//   UPSTREAM_TIMEOUT     -- VERIDIAN did not answer inside the abort budget
//   UPSTREAM_500         -- VERIDIAN answered, with a server error
//   STORAGE_UNAVAILABLE  -- VERIDIAN answered, but its own storage client is
//                           unconfigured ("supabaseKey is required"). This is
//                           a distinct, actionable condition and must never be
//                           shown as a generic error.
//   NETWORK              -- the connection itself failed (ECONNRESET,
//                           ECONNREFUSED, ENOTFOUND, CONNECT_TIMEOUT)
// A 4xx carries no code: the upstream gave a real, specific answer (404 "no
// row seeded yet", 400 "projectId required") and its own message is the thing
// to show -- inventing an infrastructure code for it would be false.
export type VeridianErrorCode = "UPSTREAM_TIMEOUT" | "UPSTREAM_500" | "STORAGE_UNAVAILABLE" | "NETWORK";

// R52 / R46S11_03. `message` is what the user reads: virtually every /api
// route in this repo returns it verbatim as { error: <message> }, and several
// screens render that string directly. So it must never carry anything the
// user should not see. `detail` is the operator's half -- the internal URL and
// the exact budget -- and is only ever logged server-side, never returned.
export class VeridianApiError extends Error {
  readonly detail?: string;
  // R67 F-20: the typed half. `code` is null for a 4xx (see VeridianErrorCode)
  // and for the local configuration errors thrown by resolveApiKey(), which
  // never reached the network at all. `durationMs` is the real wall time spent
  // on the upstream, including any retry -- it is what /api/* routes put in
  // their `Server-Timing: upstream;dur=` header.
  readonly code: VeridianErrorCode | null;
  readonly durationMs: number;
  /**
   * R67 B-09 (decision D-03) -- the upstream's CLOSED-VOCABULARY RULE REFUSAL.
   *
   * VERIDIAN no longer answers a rule violation with an English sentence; it
   * answers with {code, missing} and PROJEXA composes the words from
   * src/lib/task-errors.ts. Before this, that body reached `errorBody.error`
   * as `undefined` and every coded refusal degraded to the generic "VERIDIAN
   * API request failed (400)" -- the code was thrown away one line before it
   * would have been useful. Both are optional, so nothing that still returns
   * `{error}` changes shape.
   *
   * R67 MERGE (lane B x lane F2) -- WHY THIS IS `ruleCode` AND NOT `code`.
   * Lane B named this field `code`; lane F-20 independently gave the same
   * class a `code` of its own. They are two DIFFERENT closed vocabularies:
   * F-20's is the four-value TRANSPORT classification (VeridianErrorCode:
   * UPSTREAM_TIMEOUT / UPSTREAM_500 / STORAGE_UNAVAILABLE / NETWORK), which
   * decides the HTTP status and whether Retry-After is honest; B-09's is the
   * BUSINESS-RULE vocabulary (BOQ_LINE_REQUIRED, ...) the browser turns into
   * a sentence. Collapsing them into one field would either widen
   * VeridianErrorCode to `string` -- breaking veridian-response.ts's
   * RETRYABLE_CODES lookup, which is what makes the retry advice truthful --
   * or force a rule code into a set it does not belong to. They never co-occur
   * (a rule refusal is a 4xx, where F-20's `code` is null by design), so they
   * get one field each and both survive intact. The HTTP wire shape is
   * unchanged: /api/work-progress still answers {code, missing}.
   */
  readonly ruleCode?: string;
  readonly missing?: string[];
  /**
   * R67 D-27 -- THE WHOLE UPSTREAM ERROR BODY, kept beside the two parsed
   * fields because some refusals carry structured data a screen needs beyond
   * the sentence: the scope-reduction 409's `conflicts[]` is the first, and
   * the revise screen renders the violating lines as a table above the
   * override, which it cannot do from a prose message.
   *
   * It is the SAME object the codes were parsed out of -- one constructor
   * parameter feeds all three, so a call site cannot hand the code and the
   * body two different objects. It is DATA FOR A PROXY TO FORWARD
   * DELIBERATELY, never something to spill into a user-facing string:
   * `message` stays the only thing safe to render and `detail` stays
   * server-side-only.
   */
  readonly body?: unknown;
  constructor(
    message: string,
    public status: number,
    detail?: string,
    code: VeridianErrorCode | null = null,
    durationMs = 0,
    coded?: { code?: unknown; missing?: unknown }
  ) {
    super(message);
    this.detail = detail;
    this.code = code;
    this.durationMs = durationMs;
    this.body = coded;
    this.ruleCode = typeof coded?.code === "string" ? coded.code : undefined;
    this.missing = Array.isArray(coded?.missing) ? coded.missing.filter((m): m is string => typeof m === "string") : undefined;
  }
}

// R46 (production incident, 2026-08-25: "Vercel Runtime Timeout Error: Task
// timed out after 300 seconds" on /api/projects, /api/scope, /api/module-chain,
// /api/currencies, /dashboard, /dashboard/overview and others -- 5 real
// users affected, 20:00:14Z-03:08:19Z, still recurring). Root cause:
// VERIDIAN's own backend independently hangs on some of these same logical
// endpoints (confirmed via its own Vercel runtime errors, an identical
// timeout error group recurring there since 2026-07-15 -- a pre-existing,
// chronic condition, not something this incident's investigation caused or
// could fix from this side). Every fetch() in this file had NO timeout at
// all, so a VERIDIAN hang meant the calling PROJEXA route just sat on the
// unbounded fetch until Vercel's own 300s function cap killed the whole
// request -- the single shared choke point behind failures on otherwise
// unrelated routes, since virtually every PROJEXA API route goes through
// this one client. This does not fix VERIDIAN's hang (that's a separate,
// upstream investigation) -- it bounds PROJEXA's own exposure to it: a
// hung upstream now fails fast with a clear, catchable VeridianApiError
// instead of consuming the full 300s Vercel limit on every affected route.
//
// R67 F-20 (audit recommendation R-238) CUTS THIS FROM 20s TO 8s, and removes
// the retry-on-timeout below. MEASURED cost of the old pair: a hung upstream
// meant 20 s + 20 s = 40 s of spinner before the user saw anything, and the
// dev-server log line `GET /api/tasks?limit=50 504 in 56s` is that same 40 s
// plus the proxy's own work. Nobody waits 40 s; they reload, which starts a
// second 40 s. The budget is now 8 s per attempt with a 9 s ceiling on the
// whole call (VERIDIAN_TOTAL_BUDGET_MS), so every /api/* route answers well
// inside Vercel's 300 s cap and inside the 8 s at which the UI gives up too
// (the shared figure D-04 fixes: veridian-client aborts at the same moment
// the screen says "This is taking longer than usual").
// Exported so the budget itself is assertable: a wall-clock measurement in a
// busy test process is not a reliable way to prove "the budget is 8 s", but
// this constant is.
export const VERIDIAN_FETCH_TIMEOUT_MS = 8_000;

// *** THE 8 s ABOVE IS A READ BUDGET, AND IT DOES NOT APPLY TO FILE TRANSFER.
//
// The whole justification for 8 s is the SCREEN's contract: it is the moment
// D-04 has the UI say "This is taking longer than usual", so the request is
// abandoned at exactly the moment the user stops believing in it. A file
// upload has no such contract. The bytes are still going up, the user can see
// that they are, and the honest thing is to let them finish.
//
// callVeridianUpload() and callVeridianBinary() carry PROJEXA's real file
// transfer: POST /api/permits, /api/drawings, /api/documents and
// /api/scope/import, the last of which relays a BOQ workbook that VERIDIAN
// then parses server-side. Applying the read budget to those took a site
// engineer's multi-megabyte drawing over 4G from 20 s to 8 s -- and because
// F-20 also (correctly) removed the retry for non-GET, the failure is final
// with nothing saved. So they keep a budget of their own, close to the 20 s
// they had, and every other call in this file is unaffected.
export const VERIDIAN_UPLOAD_TIMEOUT_MS = 30_000;

// The ceiling on ONE callVeridian, retry included. A connection failure fails
// fast (no TCP peer, DNS miss), so a retry normally costs milliseconds -- but
// it must never be able to push a call past the 9 s an /api/* handler promises
// to answer within.
const VERIDIAN_TOTAL_BUDGET_MS = 9_000;

// R52: ONE bounded retry, and ONLY for requests that are safe to repeat.
//
// MEASURED 2026-08-26, not assumed. Twenty sequential probes of
// /api/v1/projexa/dashboard with an INVALID bearer token -- so the only work
// asked of the upstream is boot, look the key up, reject it with 401:
//   19 responded 401 in 0.65s-3.4s
//    1 hung and returned nothing after 21.3s
// A second run the same minute hung 1 in 8. So the upstream hangs roughly
// 5-12% of the time, each hang costing the full 20s timeout.
//
// THE IMPORTANT PART, which changes the diagnosis on record: THIS IS NOT A
// COLD START. The fault register attributes these timeouts to a cold boot, and
// an earlier probe run in this session showed a textbook warm-up curve that
// supported it. It does not survive twenty probes: the hang lands on probe 8
// of 8 and probe 1 of 20, with sub-second responses either side. A warm
// function hangs too. Cold start is at most the first request; this is chronic
// and intermittent.
//
// WHY A RETRY IS THE RIGHT FIX HERE AND NOT A PAPER-OVER: the hangs are
// independent -- every probe adjacent to a hang succeeded in about a second.
// One retry therefore turns a ~5% user-visible failure into ~0.25%, which is
// the difference between "the demo broke" and "that page took a moment". It
// does NOT fix the upstream, which lives in compliance-tracker and is another
// session's to own; it bounds PROJEXA's exposure, exactly as the 20s timeout
// above already does.
//
// *** ONLY IDEMPOTENT METHODS ARE RETRIED. *** A timeout means we never saw a
// response -- it does NOT mean the server did no work. Retrying a POST could
// create a second BOQ, a second permit or a second task, and a silent double
// write is far worse than the error it would be hiding. GET and HEAD are safe
// to repeat; everything else fails on the first timeout exactly as before.
//
// *** R67 F-20 NARROWS THIS FURTHER: NO RETRY ON A TIMEOUT AT ALL. *** The
// paragraph above is still the right reasoning for a CONNECTION failure, and
// that is what the retry now covers. It is the wrong reasoning for a timeout,
// for the same reason the paragraph below gives for POST: a timeout means we
// never saw a response, NOT that the upstream did no work -- and a timeout is
// the one failure whose retry is guaranteed to cost the user another full
// budget (8 s here) on top of the one that already elapsed. A GET that has
// already burned 8 s waiting is a GET the user has stopped believing in; the
// screen retries it explicitly (D-04's "This is taking longer than usual
// [Retry]") when the user asks, which is a decision they make with the facts
// rather than one made for them behind a spinner.
//
// So the retry survives only for the failure class where it is nearly free and
// genuinely transient: the connection never established (ECONNRESET,
// ECONNREFUSED, ENOTFOUND, or a CONNECT_TIMEOUT from the pooler). Those fail
// in milliseconds and a second attempt lands on a different socket.
const CONNECTION_FAILURE_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ENOTFOUND"]);

function isIdempotent(init: RequestInit): boolean {
  const m = (init.method ?? "GET").toUpperCase();
  return m === "GET" || m === "HEAD";
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

// Node/undici hides the real cause one or two levels down: a fetch() failure
// surfaces as `TypeError: fetch failed` whose `.cause` is the Error carrying
// `code: "ECONNREFUSED"`. Walk the cause chain rather than only reading the
// top-level error, which is how these are routinely mis-classified as generic.
function isConnectionFailure(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object") {
      const code = (current as { code?: unknown }).code;
      if (typeof code === "string" && CONNECTION_FAILURE_CODES.has(code)) return true;
      const message = (current as { message?: unknown }).message;
      if (typeof message === "string") {
        if (message.includes("CONNECT_TIMEOUT")) return true;
        for (const c of CONNECTION_FAILURE_CODES) if (message.includes(c)) return true;
      }
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return false;
}

// ONE attempt, bounded by the budget and by the caller's own cancellation.
//
// *** WHY AN EXPLICIT AbortController AND setTimeout, NOT AbortSignal.timeout.
// *** This file used AbortSignal.timeout(), and it is NOT portable: on Bun
// 1.3.14 (Windows) the signal it returns never fires its `abort` event at all
// -- verified directly, a listener on AbortSignal.timeout(500) is still
// waiting minutes later, and a `bun test` that awaits one hangs past its own
// --timeout. That is the runtime this repo's unit tests execute in, so the
// budget was untestable, and any Bun-hosted execution of this file had no
// timeout whatsoever. setTimeout + controller.abort() behaves identically on
// Node (production) and Bun (tests), and is cleared on every settled path
// below so a fast call leaves no timer holding the event loop open.
//
// The `timedOut` flag is how a budget abort is told apart from the CALLER's
// abort: both surface as the same AbortError, and reporting a cancelled
// request as an upstream timeout would be a lie about VERIDIAN.
type AttemptOutcome = { res: Response } | { err: unknown; timedOut: boolean };

async function attemptFetch(
  url: string,
  init: RequestInit,
  callerSignal?: AbortSignal,
  timeoutMs: number = VERIDIAN_FETCH_TIMEOUT_MS
): Promise<AttemptOutcome> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onCallerAbort = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    return { res: await fetch(url, { ...init, signal: controller.signal }) };
  } catch (err) {
    return { err, timedOut };
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

// R67 F-20: returns the real wall time alongside the response so every caller
// can put `Server-Timing: upstream;dur=<ms>` on what it sends back. Before
// this, the only place a duration existed was inside the timeout message.
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  callerSignal?: AbortSignal,
  timeoutMs: number = VERIDIAN_FETCH_TIMEOUT_MS
): Promise<{ res: Response; durationMs: number }> {
  const startedAt = Date.now();
  const canRetry = isIdempotent(init);
  // The whole-call ceiling tracks the per-attempt budget: the 9 s figure exists
  // only to stop a retry pushing a READ past what an /api/* handler promises,
  // so a 30 s upload gets a 31 s ceiling rather than being cut off at 9 s by a
  // constant that was never about it.
  const totalBudgetMs =
    timeoutMs === VERIDIAN_FETCH_TIMEOUT_MS ? VERIDIAN_TOTAL_BUDGET_MS : timeoutMs + 1_000;
  let lastErr: unknown;
  let budgetExpired = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const outcome = await attemptFetch(url, init, callerSignal, timeoutMs);
    if ("res" in outcome) {
      const durationMs = Date.now() - startedAt;
      recordUpstream(durationMs);
      return { res: outcome.res, durationMs };
    }
    lastErr = outcome.err;
    budgetExpired = outcome.timedOut;
    // A timeout is never retried (see the block comment above), and neither
    // is anything that is not a connection failure.
    if (outcome.timedOut || isTimeout(outcome.err) || !canRetry || !isConnectionFailure(outcome.err)) break;
    // And the retry may not push this call past the 9 s an /api/* handler
    // promises. A connection failure that somehow took most of the budget
    // has already spent the room a second attempt would need.
    if (attempt === 2 || Date.now() - startedAt > totalBudgetMs - timeoutMs) break;
    // Logged so a retry is visible in the runtime logs rather than hiding
    // the upstream's real failure rate behind a success.
    console.warn(`[veridian] connection failed, retrying once:`, url);
  }

  const durationMs = Date.now() - startedAt;
  // R67 F-28: a failed call cost the user exactly as much time as a slow
  // successful one, so it counts toward `upstream` too. A Server-Timing header
  // that only measured successes would understate precisely the requests worth
  // investigating.
  recordUpstream(durationMs);

  if (budgetExpired || isTimeout(lastErr)) {
    // A caller-initiated abort is not an upstream timeout -- nobody is waiting
    // for this answer any more, so it must not be reported as a failure of
    // VERIDIAN's.
    if (!budgetExpired && callerSignal?.aborted) {
      const detail = `VERIDIAN request cancelled by the caller after ${durationMs}ms: ${url}`;
      throw new VeridianApiError("The request was cancelled.", 499, detail, null, durationMs);
    }
    // R52 / R46S11_03. This message used to end in `: ${url}`, and that string
    // reached owner-facing UI intact -- "VERIDIAN request timed out after
    // 20000ms: https://veridian-compliance-ai.vercel.app/api/v1/projexa/dashboard"
    // was rendered on /dashboard/project, /dashboard/overview and /reports. It
    // leaked the internal backend hostname, the internal path and the exact
    // timeout budget to every user who hit a slow call.
    //
    // The real cause is kept -- the user is told a timeout happened, on which
    // service, and that it was retried -- which is what C19 ERROR_TRUTHFUL
    // asks for. The internal address and the millisecond budget move to
    // `detail`, which is logged here and never returned to a client.
    const detail = `VERIDIAN request timed out after ${timeoutMs}ms: ${url}`;
    console.error(`[veridian] ${detail}`);
    throw new VeridianApiError(
      "The construction data service did not respond in time. Please retry.",
      504,
      detail,
      "UPSTREAM_TIMEOUT",
      durationMs
    );
  }

  if (isConnectionFailure(lastErr)) {
    const detail = `VERIDIAN connection failed after ${durationMs}ms: ${url} (${lastErr instanceof Error ? lastErr.message : String(lastErr)})`;
    console.error(`[veridian] ${detail}`);
    throw new VeridianApiError(
      "Couldn't reach the construction data service. Please retry.",
      502,
      detail,
      "NETWORK",
      durationMs
    );
  }
  throw lastErr;
}

// Looks up this org's own VERIDIAN API key from public.veridian_credentials.
// Returns null (never throws) when no row exists or the DB is unreachable --
// resolveApiKey() below turns either case into a thrown, fail-loud AR-04
// error rather than silently substituting the shared key. A thrown
// DB-connectivity error here (e.g. DATABASE_URL not yet configured -- see
// src/lib/db/index.ts) must not take down every request; it should just mean
// "couldn't resolve a per-org key this time," same as "no row yet."
export async function getVeridianApiKey(organizationId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ apiKey: veridianCredentials.veridianApiKey })
      .from(veridianCredentials)
      .where(eq(veridianCredentials.organizationId, organizationId))
      .limit(1);
    return row?.apiKey ?? null;
  } catch (err) {
    console.error(
      `[veridian-client] getVeridianApiKey(${organizationId}) failed -- treating as no per-org key found:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// Single place that decides which key a call uses. Priority order:
//   1. an explicit apiKey passed by the caller
//   2. this org's own row in veridian_credentials (the real multi-tenant path)
//   3. if organizationId was omitted entirely (legacy call sites still being
//      migrated), the shared VERIDIAN_API_KEY env var (demo/sandbox
//      fallback). An organizationId that WAS provided but has no per-org
//      row never falls back to this shared key -- see the AR-04 guard below.
export async function resolveApiKey(options: { apiKey?: string; organizationId?: string }): Promise<string> {
  if (options.apiKey) return options.apiKey;

  if (options.organizationId) {
    const perOrgKey = await getVeridianApiKey(options.organizationId);
    if (perOrgKey) return perOrgKey;
    // AR-04 fail-loud guard: a request that identifies a tenant but has no
    // per-org credentials MUST fail, never silently authenticate as whatever
    // tenant the shared VERIDIAN_API_KEY belongs to. Falling back here would
    // be a cross-tenant data leak (E-45) -- empty is a legitimate answer, a
    // shared key never is.
    throw new VeridianApiError(
      `No VERIDIAN credentials configured for organization ${options.organizationId}, and per-org requests may not fall back to a shared key (AR-04)`,
      500
    );
  }

  if (process.env.VERIDIAN_API_KEY) return process.env.VERIDIAN_API_KEY;
  throw new VeridianApiError("No VERIDIAN API key configured", 500);
}

// R48_NO_CURRENCY_UI_01: "PUT" added so /api/organization/currency can call
// VERIDIAN's PUT /currencies/base (compliance-tracker PR #1391) -- every
// prior caller in this file used POST/PATCH for writes, so PUT was simply
// never needed here before.
// R67 F-20: `signal` lets a caller cancel a call it no longer needs -- a client
// pane that unmounted, a project the user switched away from. It composes with
// the 8 s budget rather than replacing it (see attemptSignal above).
// R67 D-04: `timeoutMs` is the per-request budget a module page opts into. It
// defaults to VERIDIAN_FETCH_TIMEOUT_MS (8 s), which is the same figure
// VERIDIAN_SCREEN_BUDGET_MS carries, so the four D-04 callers behave exactly
// as they did before this merge -- the value is now the default rather than an
// override.
type CallVeridianOptions = { method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown; apiKey?: string; organizationId?: string; root?: boolean; signal?: AbortSignal; timeoutMs?: number };

// R67 F-20: one place that turns a non-2xx VERIDIAN response into a typed
// error, so all four transports (JSON, raw, binary, multipart) classify a
// failure identically instead of each inventing its own generic message.
//
// STORAGE_UNAVAILABLE is the reason this is worth centralising: VERIDIAN
// answers `supabaseKey is required` when its own storage client is
// unconfigured, and every one of these call sites used to hand that string
// through as an anonymous 500. It is a specific, fixable operator condition
// and now says so.
async function throwForResponse(res: Response, durationMs: number): Promise<never> {
  // R67 MERGE (lane B x lane F2): `code`/`missing` are read here too. Lane B
  // parsed the error body inline at each of the three call sites so a B-09
  // rule refusal would stop degrading to the generic "VERIDIAN API request
  // failed (400)". F-20 had already made this function the ONE place a failed
  // response becomes an error, so B's parse moves here and covers all three
  // sites at once -- B's fix intact, F-20's single owner intact.
  const errorBody = await res.json().catch(() => ({ error: res.statusText })) as {
    error?: string;
    code?: unknown;
    missing?: unknown;
  };
  const message = errorBody.error ?? `VERIDIAN API request failed (${res.status})`;
  const code: VeridianErrorCode | null = /supabasekey is required/i.test(message)
    ? "STORAGE_UNAVAILABLE"
    : res.status >= 500
      ? "UPSTREAM_500"
      : null;
  throw new VeridianApiError(
    code === "STORAGE_UNAVAILABLE"
      ? "The construction data service's file storage is not configured. Nothing was lost — this needs an administrator."
      : message,
    res.status,
    code === "STORAGE_UNAVAILABLE" ? `upstream reported: ${message}` : undefined,
    code,
    durationMs,
    errorBody
  );
}

// Priority 15, Wave 2: factored out of callVeridian() so the quotation PDF
// route (a real binary response, not JSON) can reuse the exact same
// auth/base-url/error-shape logic instead of duplicating it. callVeridian()
// below is now a thin `res.json()` wrapper around this -- every existing
// caller's behavior is unchanged.
export async function callVeridianRaw(path: string, options: CallVeridianOptions = {}): Promise<Response> {
  const apiKey = await resolveApiKey(options);

  const base = options.root ? VERIDIAN_API_ROOT : VERIDIAN_API_BASE;
  const { res, durationMs } = await fetchWithTimeout(
    `${base}${path}`,
    {
      method: options.method ?? "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    },
    options.signal,
    options.timeoutMs
  );

  if (!res.ok) await throwForResponse(res, durationMs);
  // R67 F-20: carried on the Response itself so callVeridianResult() can report
  // the upstream duration of a SUCCESSFUL call too -- Server-Timing is only
  // useful if the fast path is measured as well as the slow one.
  lastUpstreamDurationMs.set(res, durationMs);
  return res;
}

// The duration of the call that produced a given Response. A WeakMap rather
// than a field on Response (which is frozen) or a module-level "last" variable
// (which would be wrong the moment two calls overlap, which they routinely do
// inside a Promise.all).
const lastUpstreamDurationMs = new WeakMap<Response, number>();

export async function callVeridian<T = unknown>(path: string, options: CallVeridianOptions = {}): Promise<T> {
  const res = await callVeridianRaw(path, options);
  return res.json() as Promise<T>;
}

// R67 F-20 (audit recommendation R-238). THE TYPED RESULT.
//
// callVeridian() throws, and ~250 call sites depend on that, so it keeps
// throwing -- but a screen or a proxy that wants to BRANCH on the kind of
// failure had to parse a message to do it. This is the same call with the
// failure returned instead of thrown, carrying the closed code set and the
// measured duration. Never throws for an upstream failure; the only thing it
// lets through is a programming error inside this file.
export type VeridianResult<T> =
  | { ok: true; status: number; code: null; message: null; durationMs: number; data: T }
  | { ok: false; status: number; code: VeridianErrorCode | null; message: string; durationMs: number; data: null };

export async function callVeridianResult<T = unknown>(
  path: string,
  options: CallVeridianOptions = {}
): Promise<VeridianResult<T>> {
  const startedAt = Date.now();
  try {
    const res = await callVeridianRaw(path, options);
    const data = (await res.json()) as T;
    return {
      ok: true,
      status: res.status,
      code: null,
      message: null,
      durationMs: lastUpstreamDurationMs.get(res) ?? Date.now() - startedAt,
      data,
    };
  } catch (err) {
    if (err instanceof VeridianApiError) {
      return {
        ok: false,
        status: err.status,
        code: err.code,
        message: err.message,
        durationMs: err.durationMs || Date.now() - startedAt,
        data: null,
      };
    }
    // Anything that is not a VeridianApiError never reached a classified
    // failure path -- a JSON body that would not parse, most often. Reported as
    // NETWORK with its own words rather than swallowed into a success.
    return {
      ok: false,
      status: 502,
      code: "NETWORK",
      message: err instanceof Error && err.message ? err.message : "Couldn't reach the construction data service.",
      durationMs: Date.now() - startedAt,
      data: null,
    };
  }
}

// Priority 15 Wave 2: callVeridian() above always parses the response as
// JSON, which breaks for binary responses (the new payslip PDF endpoint
// returns Content-Type: application/pdf). Same auth/base-URL resolution as
// callVeridian, but returns the raw ArrayBuffer + content-type instead of
// assuming JSON.
export async function callVeridianBinary(
  path: string,
  options: { apiKey?: string; organizationId?: string; root?: boolean; signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<{ body: ArrayBuffer; contentType: string }> {
  const apiKey = await resolveApiKey(options);

  const base = options.root ? VERIDIAN_API_ROOT : VERIDIAN_API_BASE;
  // File transfer, not a screen read -- see VERIDIAN_UPLOAD_TIMEOUT_MS.
  const { res, durationMs } = await fetchWithTimeout(
    `${base}${path}`,
    {
      method: "GET",
      headers: { "Authorization": `Bearer ${apiKey}` },
      cache: "no-store",
    },
    options.signal,
    options.timeoutMs ?? VERIDIAN_UPLOAD_TIMEOUT_MS
  );

  if (!res.ok) await throwForResponse(res, durationMs);
  return { body: await res.arrayBuffer(), contentType: res.headers.get("Content-Type") ?? "application/octet-stream" };
}

// Priority 13/Wave 143 (Permits/Drawings/Documents real upload): callVeridian()
// always JSON-encodes its body, which can't carry file bytes. This is the
// multipart twin -- relays a FormData body (file + fields) straight through
// with the same Bearer auth/base-URL/error-shape as callVeridianRaw, letting
// fetch set its own multipart Content-Type/boundary header (setting it
// manually here would omit the boundary and break the upload).
export async function callVeridianUpload<T = unknown>(
  path: string,
  formData: FormData,
  options: { apiKey?: string; organizationId?: string; root?: boolean; signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<T> {
  const apiKey = await resolveApiKey(options);
  const base = options.root ? VERIDIAN_API_ROOT : VERIDIAN_API_BASE;
  // File transfer, not a screen read -- see VERIDIAN_UPLOAD_TIMEOUT_MS. This is
  // the one that matters most: a POST is never retried, so an abort here loses
  // the upload outright.
  const { res, durationMs } = await fetchWithTimeout(
    `${base}${path}`,
    {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}` },
      body: formData,
      cache: "no-store",
    },
    options.signal,
    options.timeoutMs ?? VERIDIAN_UPLOAD_TIMEOUT_MS
  );

  if (!res.ok) await throwForResponse(res, durationMs);
  return res.json() as Promise<T>;
}

// Platform provisioning (Priority 17): calls VERIDIAN's platform-level
// provisioning endpoint to create a brand-new, fully isolated VERIDIAN org
// for a PROJEXA customer at signup time. This is a DIFFERENT credential
// class from everything else in this file -- VERIDIAN_PLATFORM_APPLICATION_KEY
// is a platform-wide application key (authorizes "create a new tenant"),
// never a customer's own scoped key, and it must never be used for any
// other call in this file. Server-side only, same as every other export
// here; this is additionally never expected to run per-request (only once,
// at signup).
//
// Contract (as specified by the PROJEXA<->VERIDIAN integration task; the
// sibling session building this endpoint in compliance-tracker is the
// authoritative source if it drifts from this):
//   POST {VERIDIAN_API_ROOT}/platform/provision-org
//   Authorization: Bearer <VERIDIAN_PLATFORM_APPLICATION_KEY>
//   body: { customerOrgName: string, country?: string, primaryCurrency?: string }
//   201 -> { organisationId: string, apiKey: string }  (apiKey returned once)
//   401 -> bad/missing platform key; 400 -> missing customerOrgName
export type ProvisionVeridianOrgParams = {
  customerOrgName: string;
  country?: string;
  primaryCurrency?: string;
};

export type ProvisionVeridianOrgResult = {
  organisationId: string;
  apiKey: string;
};

export async function provisionVeridianOrg(params: ProvisionVeridianOrgParams): Promise<ProvisionVeridianOrgResult> {
  const platformKey = process.env.VERIDIAN_PLATFORM_APPLICATION_KEY;
  if (!platformKey) {
    throw new VeridianApiError(
      "VERIDIAN_PLATFORM_APPLICATION_KEY is not configured -- cannot provision a new VERIDIAN org for this signup",
      500
    );
  }
  if (!params.customerOrgName || !params.customerOrgName.trim()) {
    throw new VeridianApiError("customerOrgName is required to provision a VERIDIAN org", 400);
  }

  const { res, durationMs } = await fetchWithTimeout(`${VERIDIAN_API_ROOT}/platform/provision-org`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${platformKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customerOrgName: params.customerOrgName,
      ...(params.country ? { country: params.country } : {}),
      ...(params.primaryCurrency ? { primaryCurrency: params.primaryCurrency } : {}),
    }),
    cache: "no-store",
  });

  if (!res.ok) await throwForResponse(res, durationMs);

  const data = await res.json().catch(() => null) as { organisationId?: string; apiKey?: string } | null;
  if (!data?.organisationId || !data?.apiKey) {
    throw new VeridianApiError("VERIDIAN provision-org returned an unexpected response shape", 502);
  }

  return { organisationId: data.organisationId, apiKey: data.apiKey };
}

// Perf, 2026-08-27: cached counterpart to callVeridian() for GET-only,
// read-heavy, slowly-changing reference/lookup data -- currency master list,
// cost centers, fiscal years. Deliberately NOT used for anything that shows
// a live/current figure (dashboard totals, AR aging, balance sheet, invoice
// status) or any write path; those keep calling callVeridian() directly with
// its existing cache: "no-store".
//
// SECURITY, read before reusing this for a new route: every VERIDIAN call
// in this file is per-tenant -- the exact same `path` (e.g. "/currencies")
// returns a DIFFERENT org's data depending solely on which per-org Bearer
// token resolveApiKey() attached (see AR-04 above), never on the URL. Next's
// ordinary `fetch()` cache keys on URL + method + body only, NOT headers --
// so naively adding `next: { revalidate }` to the shared fetch() inside
// fetchWithTimeout() would silently serve org A's cached response to org B
// on org B's next request. That is a real cross-tenant leak (same class as
// E-45), not a theoretical one, which is why this helper exists instead of
// touching that shared fetch call.
//
// unstable_cache's cache key is derived from `keyParts` PLUS the serialized
// arguments passed to the wrapped function -- organizationId is both an
// explicit keyPart and the function's sole argument, so it is org-scoped
// two independent ways. Define the returned fetcher ONCE per route at
// module scope (as every call site below does) rather than inside the
// request handler -- unstable_cache is meant to be created once, not
// re-wrapped on every request.
//
// This uses Next's built-in Data Cache -- the same mechanism ISR/`fetch`
// revalidation uses. It ships on every Vercel plan including Hobby; it is
// not a paid add-on.
//
// Caller must already have run requireAuth() (or equivalent) and confirmed
// the request is authorized BEFORE calling the returned fetcher -- this
// only caches the downstream data for an already-authorized org, it never
// substitutes for the authorization check itself.
export function createCachedVeridianGet<T = unknown>(
  cacheKey: string,
  path: string,
  revalidateSeconds: number
): (organizationId: string) => Promise<T> {
  return unstable_cache(
    (organizationId: string) => callVeridian<T>(path, { organizationId }),
    [cacheKey, path],
    { revalidate: revalidateSeconds, tags: [cacheKey] }
  );
}
