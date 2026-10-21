// R48 UAT session 2, 2026-08-26 -- fixes R48_HTTP_ERROR_SWALLOWED_AS_EMPTY_LIST_01.
//
// The defect this exists to kill: 63 call sites across ~30 client components did
//
//     const res  = await fetch("/api/things");
//     const data = await res.json();
//     setThings(data.things ?? []);
//
// The /api routes are correct -- they answer a failure with { error: "<real
// message>" } and a real status. But res.ok was never read, so an error body
// parsed fine, `data.things` came back undefined, and `?? []` turned a failed
// request into an EMPTY LIST. The surrounding try/catch could not save it:
// catch only fires on a network or JSON-parse failure, never on an HTTP status.
// The user got a blank screen and was told nothing -- they could not tell
// "there is no data" from "the request failed".
//
// Criterion C19 ERROR_TRUTHFUL: a forced failure must show the REAL backend
// message -- never a false success, never a silent swallow, never a blank.
// SAP L5 agrees: a system never shows a blank where an error belongs.
//
// So: read the status first, and keep the backend's own words.

import { viaPxApi } from "@/lib/px-api";
import { apiPathOf } from "@/lib/error-guide/context";
import { markReturnReady } from "@/lib/error-guide/return-trail";
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  /** GUIDED ERRORS: the facts src/lib/error-guide/match.ts needs to pick the right guide. */
  code?: string;
  apiPath?: string;
  method?: string;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

/**
 * fetch + JSON, with the HTTP status actually checked.
 *
 * Throws {@link ApiError} carrying the backend's own `error` string on any
 * non-2xx response, so callers can show the real reason instead of inventing
 * a generic one. Resolves to the parsed body on success.
 */
// The generic defaults to `any` on purpose, matching what these call sites
// already had: the DOM lib types Response.json() as Promise<any>, so every
// `const data = await res.json()` was already `any`. Defaulting to `unknown`
// here would turn a pure error-handling fix into a 63-site typing rewrite,
// which is a different change with different risk. Call sites that want a
// real shape can still pass one.
export async function fetchJson<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const method = (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
  const apiPath = apiPathOf(input);
  let res: Response;
  try {
    res = await viaPxApi(input, init);
  } catch (err) {
    // The request never got an answer. The SAME error object is rethrown (callers that test `instanceof TypeError` keep working) with the facts
    // the guided-error matcher needs attached to it.
    attachFacts(err, { apiPath, method, code: failureCode(err) });
    throw err;
  }

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const error = new ApiError(backendMessage(body, res.status), res.status, body);
    attachFacts(error, { apiPath, method, code: bodyCode(body) });
    throw error;
  }
  if (method !== "GET" && method !== "HEAD") markReturnReady(typeof window !== "undefined" ? window.location.pathname : "");

  return body as T;
}

/**
 * The backend's own words for a non-2xx body, falling back to a plain
 * statement of the status when the body carried no `error` string (an HTML
 * proxy page, an empty 502).
 *
 * R67 D-72: extracted so the READ path (fetchJson above) and the WRITE path
 * (src/lib/use-submit.ts, which needs the raw Response and therefore cannot
 * call fetchJson) cannot end up quoting the same failure two different ways.
 * The returned string is the reason ALONE -- never a whole sentence -- so the
 * surface that shows it decides how it is framed.
 */
function bodyCode(body: unknown): string | undefined {
  const c = body && typeof body === "object" ? (body as { code?: unknown }).code : undefined;
  return typeof c === "string" && c ? c : undefined;
}

function failureCode(err: unknown): string | undefined {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError" || name === "AbortError") return "TIMEOUT";
  return err instanceof TypeError ? "OFFLINE" : undefined;
}

function attachFacts(err: unknown, facts: { apiPath?: string; method?: string; code?: string }): void {
  if (!err || typeof err !== "object") return;
  try {
    const target = err as { apiPath?: string; method?: string; code?: string; status?: number };
    if (facts.apiPath) target.apiPath = facts.apiPath;
    if (facts.method) target.method = facts.method;
    if (facts.code) target.code = facts.code;
    if (facts.code === "OFFLINE" || facts.code === "TIMEOUT") target.status ??= 0;
  } catch {
    /* a frozen error object: the guide falls back to the generic one */
  }
}

export function backendMessage(body: unknown, status: number): string {
  const fromBody =
    body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
      ? ((body as { error: string }).error).trim()
      : "";
  return fromBody || `Request failed (HTTP ${status})`;
}

/**
 * The message to show a user for a caught failure, without ever losing the
 * backend's reason. `context` is what the user was trying to do, e.g.
 * "Couldn't load budgets".
 */
export function errorMessage(err: unknown, context: string): string {
  if (err instanceof Error && err.message) return `${context}: ${err.message}`;
  return context;
}
