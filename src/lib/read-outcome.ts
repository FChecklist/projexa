// R52 -- the shared rule behind three faults:
//   R46S11_01                                (/dashboard)
//   R48_OVERVIEW_ASSERTS_ZERO_PROJECTS_OVER_A_500_01  (/dashboard/overview)
//   R48_TWO_OF_THREE_PER_PAGE_500S_NEVER_SURFACED_01  (every page)
//
// THE RULE: a screen may only state a definite fact about the user's data
// when the read that would establish it SUCCEEDED. When the read failed, the
// true answer is "we could not find out" -- never "zero", never "none",
// never "nothing needs your attention".
//
// This is not the same rule as "show an error". Both of the first two faults
// DID show a truthful error, and then contradicted it one line below with a
// confident count. R48_OVERVIEW_... says so explicitly: the defect "belongs
// to whichever criterion owns EMPTY-STATE HONESTY -- the claim being false
// is the empty state, not the error."

import { classifyReadError, sanitiseBackendMessage, type ReadErrorCode } from "@/lib/task-errors";
import { ApiError } from "@/lib/fetch-json";

/**
 * True only when the read succeeded, so an empty result really does mean
 * "there are none". Pass the same errorMessage the screen renders.
 */
export function mayAssertEmpty(errorMessage: string | null | undefined): boolean {
  return !errorMessage;
}

export type DashboardSummaryInput = {
  totalProjects: number;
  delayedProjectCount: number;
};

/**
 * The /dashboard greeting sentence.
 *
 * R46S11_01: when GET /api/projects 504'd, `data` was null and the greeting
 * read "No active projects yet — use VERI Chat below to get started." on the
 * PRIMARY owner-facing screen, while the org demonstrably had 5 active
 * projects (proven by the auditor's own retry). The error card below it said
 * the load had failed; the greeting above it reported a result anyway.
 *
 * `data` null + a failure => say the read failed.
 * `data` null + no failure => genuinely nothing yet.
 */
export function dashboardSummary(
  data: DashboardSummaryInput | null,
  errorMessage: string | null | undefined
): string {
  if (!data) {
    return mayAssertEmpty(errorMessage)
      ? "No active projects yet — use VERI Chat below to get started."
      : "Couldn't load your projects just now, so this screen can't show how many you have. The error below has the details.";
  }

  if (data.totalProjects === 0) {
    return mayAssertEmpty(errorMessage)
      ? "No active projects yet — use VERI Chat below to get started."
      : "Couldn't load your projects just now, so this screen can't show how many you have. The error below has the details.";
  }

  const plural = data.totalProjects === 1 ? "" : "s";
  const delayed = data.delayedProjectCount;
  const tail =
    delayed > 0
      ? `${delayed} of them ${delayed === 1 ? "has" : "have"} delayed tasks needing attention.`
      : "None of them have delayed tasks right now.";
  return `You have ${data.totalProjects} active project${plural}. ${tail}`;
}

// ─── R67 D-71: a list read resolves to ONE of three things, never to [] ───
//
// R-293 / R-270, restated: "Could not load" and "none yet" are DIFFERENT
// ANSWERS and the product printed the second one for both. The mechanism was
// always the same single character sequence -- `?? []` -- applied to a body
// that was an error payload, after which every downstream branch was
// reasoning about an empty array that no backend had ever sent.
//
// mayAssertEmpty() above is the RULE. What follows is the TYPE that makes the
// rule impossible to break by accident: a list read cannot produce rows and
// an error at the same time, and there is no shape a failure can take that a
// caller could mistake for zero rows. `status: "empty"` is a distinct
// variant precisely so that "there are none" has to be MINTED by a
// successful read -- it can never be arrived at by a `.length === 0` check on
// a value that got defaulted.

export type ListOutcome<T> =
  | { status: "ready"; rows: T[] }
  | { status: "empty" }
  | {
      status: "error";
      /**
       * The backend's own words, VERBATIM. This is transport, not display:
       * it is what the dictionary classifies, and describeReadError() is
       * what redacts it. Never render this string directly -- render
       * `safeMessage`, or hand this one to PaneState and let the dictionary
       * do its job.
       */
      message: string;
      /** The same words, run through the dictionary's redaction. Safe to render. */
      safeMessage: string;
      /** The closed-vocabulary classification, from the one dictionary. */
      code: ReadErrorCode;
      /** The transport status, when there was one. */
      httpStatus: number | null;
      /** Whether retrying could plausibly help. A 401 or a 404 will not. */
      retry: boolean;
    };

/** The rows a list outcome carries; [] for an empty read, [] for a failure. */
export function listOutcomeRows<T>(outcome: ListOutcome<T>): T[] {
  return outcome.status === "ready" ? outcome.rows : [];
}

/** ready or empty, minted only where a 200 has actually been seen. */
export function listOutcomeFromRows<T>(rows: T[]): ListOutcome<T> {
  return rows.length === 0 ? { status: "empty" } : { status: "ready", rows };
}

function errorOutcome<T>(httpStatus: number | null, rawMessage: string | null): ListOutcome<T> {
  const code = classifyReadError({ status: httpStatus, message: rawMessage });
  return {
    status: "error",
    // The backend's real reason is what a user can act on, so it is kept
    // whole here -- classification depends on it ("supabaseKey is required"
    // is only STORAGE_UNAVAILABLE while those words are still present).
    message: rawMessage ?? "",
    // ...and the redacted form sits beside it, so a screen that renders the
    // message directly cannot put an IP, a host:port or a camelCase
    // parameter name in front of a user.
    safeMessage: sanitiseBackendMessage(rawMessage),
    code,
    httpStatus,
    retry: code !== "NOT_AUTHORISED" && code !== "NOT_FOUND",
  };
}

/**
 * The whole rule in one function: given the Response a list endpoint actually
 * returned, decide what the screen is allowed to say.
 *
 * `select` pulls the array out of the parsed body. It returning undefined on
 * a 2xx is NOT an error -- an endpoint answering `{}` for a project with no
 * rows is a legitimate empty answer -- but it can only ever be reached
 * through a successful status, which is the entire point.
 */
export async function listOutcomeFromResponse<T>(
  res: Response,
  select: (body: unknown) => T[] | null | undefined
): Promise<ListOutcome<T>> {
  // Parse defensively for the same reason fetch-json.ts does: a proxy 502 or
  // an HTML error page is not JSON, and a parse failure must not be allowed
  // to mask the status that came with it.
  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const fromBody =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error.trim()
        : "";
    return errorOutcome<T>(res.status, fromBody || `Request failed (HTTP ${res.status})`);
  }

  const rows = select(body);
  return listOutcomeFromRows(Array.isArray(rows) ? rows : []);
}

/**
 * The same decision for a thrown failure -- a network drop, an abort, or the
 * ApiError fetchJson() raises. There is no "maybe it was empty" branch here:
 * nothing came back, so nothing may be claimed.
 */
export function listOutcomeFromError<T>(err: unknown): ListOutcome<T> {
  const httpStatus = err instanceof ApiError ? err.status : null;
  const message = err instanceof Error && err.message ? err.message : null;
  return errorOutcome<T>(httpStatus, message);
}
