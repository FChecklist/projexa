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
