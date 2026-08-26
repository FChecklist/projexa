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

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

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
export async function fetchJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(input, init);

  // Parse defensively: an error response is not guaranteed to be JSON at all
  // (a proxy 502, an HTML error page). A parse failure must not mask the status.
  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const fromBody =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? ((body as { error: string }).error).trim()
        : "";
    throw new ApiError(
      fromBody || `Request failed (HTTP ${res.status})`,
      res.status,
      body
    );
  }

  return body as T;
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
