// LOCAL-FIRST R9 (owner order 2026-10-02): "once logged in, the user stays logged in FOREVER until they log out or
// choose to delete. Never signed out by a failed refresh, being offline, or a server error."
//
// WHY THIS FILE EXISTS. Supabase's auth client (auth-js) throws a session away whenever a token refresh fails in a way
// it does not recognise as "network trouble". Read in node_modules/@supabase/auth-js/dist/main/lib/fetch.js: only a thrown
// fetch (offline, DNS, CORS, abort) and the status codes 500-504 and 520-530 count as retryable. Everything else becomes a
// non-retryable AuthApiError / AuthUnknownError and GoTrueClient._callRefreshToken then calls _removeSession() as soon as
// the short access token has expired -- on a 429 (rate limit), a 408, a 505-519 or 531-599, a captive-portal 4xx HTML
// page, a half-broken gateway. The person is signed out although their refresh token is perfectly good.
//
// THE FIX, IN ONE PLACE. This wraps the `fetch` the auth client uses. For the refresh-token request ONLY
// (POST /auth/v1/token?grant_type=refresh_token) it keeps exactly one kind of answer: the server saying, in its own JSON,
// that this refresh token is revoked / unknown / already used / the session is gone. That is the only case in which the
// person really is signed out. Every other outcome (offline, a thrown network error, any 5xx, 408, 429, an HTML page, an
// unreadable body) is turned into a thrown network error, which auth-js treats as retryable and so keeps the session.
// Sign-in, sign-out, getUser, password reset and every other auth request pass through untouched.
//
// This file imports nothing so it can run in the Edge runtime (src/middleware.ts), the browser and Node alike.

/** The statuses GoTrue uses when it rejects a refresh token. A 5xx, 408 or 429 is never one of them. */
const REJECTION_STATUSES: readonly number[] = [400, 401, 403, 422];

/**
 * What GoTrue says (in `error_code` / `code` / `msg` / `message` / `error`) when the refresh token itself is the problem.
 * Anything not matching is NOT proof the person is signed out, so the session is kept.
 */
const REVOKED_PATTERN =
  /refresh_token_not_found|refresh_token_already_used|invalid[ _]refresh[ _]token|refresh[ _]token[ _](?:not[ _]found|already[ _]used)|session_not_found|session_expired|invalid_grant|user_banned|user_not_found/i;

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (typeof URL !== "undefined" && input instanceof URL) return input.href;
  return (input as { url?: string }).url ?? "";
}

/** True for the one request that renews a session: POST <project>/auth/v1/token?grant_type=refresh_token. */
export function isRefreshTokenRequest(input: FetchInput): boolean {
  const url = urlOf(input);
  return /\/auth\/v1\/token\?/.test(url) && /[?&]grant_type=refresh_token(?:&|$)/.test(url);
}

/**
 * "revoked": the server answered, with JSON, that this refresh token is no good -- the person must sign in again.
 * "transient": anything else. The session stays.
 */
export function classifyRefreshFailure(status: number, bodyText: string): "revoked" | "transient" {
  if (!REJECTION_STATUSES.includes(status)) return "transient";
  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return "transient"; // an HTML error page from a proxy or a captive portal says nothing about the token
  }
  if (typeof body !== "object" || body === null) return "transient";
  const o = body as Record<string, unknown>;
  const said = ["error_code", "code", "error", "error_description", "msg", "message"]
    .map((k) => o[k])
    .filter((v): v is string => typeof v === "string")
    .join(" ");
  return REVOKED_PATTERN.test(said) ? "revoked" : "transient";
}

export type DurableAuthFetchOptions = {
  /** True when the browser knows it has no network. Then no request is made at all and the session is simply kept. */
  isOffline?: () => boolean;
  /** Told when a refresh failed for a reason that is not "the token is revoked", so the failure can be logged or shown calmly. */
  onTransientFailure?: (info: { status: number | null; reason: "offline" | "network" | "answer" }) => void;
};

/**
 * Wraps a fetch so a failed token refresh can only ever end a session when the server says the token is revoked.
 * Pass the result as `global.fetch` of createBrowserClient / createServerClient.
 */
export function createDurableAuthFetch(baseFetch: typeof fetch, options: DurableAuthFetchOptions = {}): typeof fetch {
  const durable = async (input: FetchInput, init?: FetchInit): Promise<Response> => {
    if (!isRefreshTokenRequest(input)) return baseFetch(input, init);

    if (options.isOffline?.()) {
      options.onTransientFailure?.({ status: null, reason: "offline" });
      throw new TypeError("PROJEXA: this device is offline; the sign-in is kept and will be renewed when it is back online");
    }

    let response: Response;
    try {
      response = await baseFetch(input, init);
    } catch (err) {
      // A thrown fetch is what auth-js already reads as "retryable network failure": nothing to convert.
      options.onTransientFailure?.({ status: null, reason: "network" });
      throw err;
    }
    if (response.ok) return response;

    let text = "";
    try {
      text = await response.clone().text();
    } catch {
      /* an unreadable body is treated as transient below */
    }
    if (classifyRefreshFailure(response.status, text) === "revoked") return response;

    options.onTransientFailure?.({ status: response.status, reason: "answer" });
    throw new TypeError(`PROJEXA: the sign-in service answered ${response.status}; the sign-in is kept and will be renewed later`);
  };
  return durable as typeof fetch;
}

/** True when the browser itself says there is no network. `navigator` is absent on the server and in some workers. */
export function browserIsOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * True when an auth-js error means "could not reach / could not finish", not "you are not signed in". auth-js names this
 * AuthRetryableFetchError; the message patterns cover a thrown fetch that reached us unwrapped.
 */
export function isTransientAuthError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: unknown; message?: unknown; status?: unknown };
  if (e.name === "AuthRetryableFetchError") return true;
  if (e.name === "AuthApiError" || e.name === "AuthSessionMissingError" || e.name === "AuthInvalidJwtError") return false;
  const message = typeof e.message === "string" ? e.message : "";
  if (/PROJEXA: /.test(message)) return true;
  return /fetch failed|failed to fetch|network|timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|UND_ERR|socket/i.test(message);
}

/** True when the request carries a Supabase session cookie (sb-<ref>-auth-token, possibly chunked as .0 .1 ...). */
export function hasSessionCookie(cookieNames: Iterable<string>): boolean {
  for (const name of cookieNames) {
    if (/^sb-.+-auth-token(?:\.\d+)?$/.test(name)) return true;
  }
  return false;
}
