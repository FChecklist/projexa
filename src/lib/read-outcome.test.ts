/// <reference types="bun-types" />
// R52 -- re-runnable oracle for the empty-state-honesty faults:
//   R46S11_01, R48_OVERVIEW_ASSERTS_ZERO_PROJECTS_OVER_A_500_01.
//
// Both faults have the same shape: a truthful error on screen, and directly
// beneath it a confident statement of a fact the failed read makes
// unknowable. These assertions fail if either screen goes back to answering
// a question it could not read.
import { describe, expect, test } from "bun:test";
import { dashboardSummary, mayAssertEmpty } from "./read-outcome";

// The exact message R48_TWO_OF_THREE... and R48_OVERVIEW... both recorded
// coming back from the backend.
const AR04 =
  "No VERIDIAN credentials configured for organization 9165054f-f9de-4c8b-b672-f92b936d8ce6, and per-org requests may not fall back to a shared key (AR-04)";

describe("mayAssertEmpty", () => {
  test("a successful read may state that there are none", () => {
    expect(mayAssertEmpty(null)).toBe(true);
    expect(mayAssertEmpty(undefined)).toBe(true);
  });

  test("a failed read may not -- 'we could not find out' is not 'zero'", () => {
    expect(mayAssertEmpty(AR04)).toBe(false);
    expect(mayAssertEmpty("VERIDIAN request timed out after 20000ms")).toBe(false);
  });
});

describe("dashboardSummary -- R46S11_01", () => {
  test("a failed read never says 'No active projects yet'", () => {
    // The org in R46S11_01 had FIVE active projects; the retry proved it.
    const summary = dashboardSummary(null, "VERIDIAN request timed out after 20000ms");
    expect(summary).not.toContain("No active projects yet");
    expect(summary.toLowerCase()).toContain("couldn't load");
  });

  test("a failed read is not rescued by data that happens to be present but zeroed", () => {
    const summary = dashboardSummary({ totalProjects: 0, delayedProjectCount: 0 }, AR04);
    expect(summary).not.toContain("No active projects yet");
  });

  test("a SUCCESSFUL read with genuinely no projects still says so plainly", () => {
    // The honest empty state must survive -- this fix must not turn a real
    // "you have none yet" into a scary error.
    expect(dashboardSummary(null, null)).toContain("No active projects yet");
    expect(dashboardSummary({ totalProjects: 0, delayedProjectCount: 0 }, null)).toContain("No active projects yet");
  });

  test("a successful read reports the real counts, unchanged", () => {
    expect(dashboardSummary({ totalProjects: 5, delayedProjectCount: 0 }, null)).toBe(
      "You have 5 active projects. None of them have delayed tasks right now."
    );
    expect(dashboardSummary({ totalProjects: 5, delayedProjectCount: 2 }, null)).toBe(
      "You have 5 active projects. 2 of them have delayed tasks needing attention."
    );
    expect(dashboardSummary({ totalProjects: 1, delayedProjectCount: 1 }, null)).toBe(
      "You have 1 active project. 1 of them has delayed tasks needing attention."
    );
  });
});

// ─── R67 D-71 ────────────────────────────────────────────────────────────
// R-293 / R-270: "could not load" and "none yet" are different answers, and
// the product printed the second one for both. These assertions are the
// oracle: no failure shape may produce `status: "empty"`, and no successful
// read may lose its rows.
import {
  listOutcomeFromError,
  listOutcomeFromResponse,
  listOutcomeFromRows,
  listOutcomeRows,
  type ListOutcome,
} from "./read-outcome";
import { ApiError } from "./fetch-json";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const pickPermits = (body: unknown) => (body as { permits?: unknown[] } | null)?.permits as unknown[] | undefined;

describe("listOutcomeFromResponse -- D-71", () => {
  test("a 500 yields status 'error' carrying the body's own message", async () => {
    const outcome = await listOutcomeFromResponse(
      json({ error: "No VERIDIAN credentials configured (AR-04)" }, 500),
      pickPermits
    );
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") throw new Error("unreachable");
    expect(outcome.message).toBe("No VERIDIAN credentials configured (AR-04)");
    expect(outcome.httpStatus).toBe(500);
    expect(outcome.retry).toBe(true);
  });

  test("a 500 with NO rows in the body is still an error, never 'empty'", async () => {
    // This is the exact shape that used to become `?? []`: an error payload
    // with no `permits` key at all.
    const outcome = await listOutcomeFromResponse(json({ error: "boom" }, 500), pickPermits);
    expect(outcome.status).not.toBe("empty");
    expect(outcome.status).not.toBe("ready");
  });

  test("an HTML error page fails loudly rather than parsing as nothing", async () => {
    const outcome = await listOutcomeFromResponse(
      new Response("<html>502 Bad Gateway</html>", { status: 502, headers: { "content-type": "text/html" } }),
      pickPermits
    );
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") throw new Error("unreachable");
    expect(outcome.message).toBe("Request failed (HTTP 502)");
  });

  test("a 200 with zero rows is 'empty' -- the honest empty state survives", async () => {
    const outcome = await listOutcomeFromResponse(json({ permits: [] }, 200), pickPermits);
    expect(outcome.status).toBe("empty");
  });

  test("a 200 with rows is 'ready' and keeps every row", async () => {
    const outcome = await listOutcomeFromResponse(json({ permits: [{ id: "a" }, { id: "b" }] }, 200), pickPermits);
    expect(outcome.status).toBe("ready");
    expect(listOutcomeRows(outcome)).toHaveLength(2);
  });

  test("a 200 whose body simply lacks the key is empty, not an error", async () => {
    // An endpoint answering {} for a project with nothing in it is a real
    // empty answer -- but it can only be reached through a 2xx.
    expect((await listOutcomeFromResponse(json({}, 200), pickPermits)).status).toBe("empty");
  });

  test("a 401 and a 404 do not offer Retry -- retrying cannot fix either", async () => {
    for (const status of [401, 403, 404]) {
      const outcome = await listOutcomeFromResponse(json({ error: "nope" }, status), pickPermits);
      if (outcome.status !== "error") throw new Error("expected an error outcome");
      expect(outcome.retry).toBe(false);
    }
  });

  test("a 504 is classified as a timeout, in the shared vocabulary", async () => {
    const outcome = await listOutcomeFromResponse(json({ error: "upstream gone" }, 504), pickPermits);
    if (outcome.status !== "error") throw new Error("expected an error outcome");
    expect(outcome.code).toBe("UPSTREAM_TIMEOUT");
  });

  test("a message that would leak the shape of the system is replaced, not shown", async () => {
    const outcome = await listOutcomeFromResponse(
      json({ error: "write CONNECT_TIMEOUT 3.109.171.244:6543" }, 500),
      pickPermits
    );
    if (outcome.status !== "error") throw new Error("expected an error outcome");
    // The raw words survive for the dictionary to classify...
    expect(outcome.message).toContain("3.109.171.244");
    // ...and the form a screen is allowed to render does not carry them.
    expect(outcome.safeMessage).not.toContain("3.109.171.244");
  });
});

describe("listOutcomeFromError -- D-71", () => {
  test("an ApiError keeps its status and its backend message", () => {
    const outcome = listOutcomeFromError(new ApiError("supabaseKey is required", 500, null));
    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") throw new Error("unreachable");
    expect(outcome.code).toBe("STORAGE_UNAVAILABLE");
  });

  test("a bare network failure is an error, never an empty list", () => {
    const outcome = listOutcomeFromError(new TypeError("Failed to fetch"));
    expect(outcome.status).toBe("error");
  });

  test("rows are never recovered from a failure", () => {
    expect(listOutcomeRows(listOutcomeFromError(new Error("x")))).toEqual([]);
  });
});

describe("listOutcomeFromRows -- D-71", () => {
  test("zero rows is 'empty' and any rows is 'ready'", () => {
    expect(listOutcomeFromRows([]).status).toBe("empty");
    expect(listOutcomeFromRows([1]).status).toBe("ready");
  });

  test("the union has no variant carrying both rows and an error", () => {
    // A type-level guarantee, asserted at runtime so it cannot be silently
    // widened later: every error variant returns [] from listOutcomeRows.
    const outcomes: ListOutcome<number>[] = [
      listOutcomeFromRows([1, 2]),
      listOutcomeFromRows([]),
      listOutcomeFromError(new Error("x")),
    ];
    for (const outcome of outcomes) {
      if (outcome.status === "error") expect(listOutcomeRows(outcome)).toEqual([]);
    }
  });
});
