/// <reference types="bun-types" />
// R67 E-11 (R-130). The parameter card's rules, tested without a browser: what
// each report really takes, what blocks the primary, and what happens to a
// filter the backend does not apply.
import { describe, expect, test } from "bun:test";
import {
  applyClientFilters,
  isMonday,
  missingPrerequisites,
  periodNote,
  reportParameters,
  runButtonLabel,
  unappliedFilterNote,
  PROJECT_PREREQUISITE,
  WEEK_START_NOT_MONDAY,
  WEEK_START_PREREQUISITE,
  weekStartFieldError,
  REPORT_PARAMETERS,
} from "./report-parameters";

describe("what a report takes (R67 E-11)", () => {
  test("every picker slug has a description a reader can act on, and none of them is a camelCase key", () => {
    for (const [slug, spec] of Object.entries(REPORT_PARAMETERS)) {
      expect(spec.description.length).toBeGreaterThan(20);
      expect(spec.description).not.toMatch(/[a-z][A-Z]/); // no percentByValue-style key in prose
      expect(spec.description.startsWith(slug)).toBe(false);
    }
  });

  test("the Work Progress description is the one the recommendation words", () => {
    expect(reportParameters("work-progress").description).toBe(
      "Work Progress: quantities and amounts done per BOQ line, previous / this period / to date."
    );
  });

  test("an unknown slug gets a spec that offers nothing, rather than crashing the card", () => {
    const spec = reportParameters("not-a-report");
    expect(spec.needsDateRange).toBe(false);
    expect(spec.needsWeekStart).toBe(false);
    expect(spec.supportsCategory).toBe(false);
    expect(spec.supportsVendor).toBe(false);
  });

  test("a report the period does not touch says so, at the field", () => {
    expect(periodNote("Project Status", reportParameters("project-status"))).toBe(
      "Project Status covers the whole project — the From and To dates are not applied to it."
    );
    // ...and one that IS period-scoped says nothing, because the fields speak for themselves.
    expect(periodNote("Work Progress", reportParameters("work-progress"))).toBeNull();
  });
});

describe("the primary is never clickable into a 400 (R67 E-11)", () => {
  test("ACCEPTANCE: with the rail on All projects the primary reads exactly 'Run Report (select a project)'", () => {
    const missing = missingPrerequisites("project-status", { projectId: null, weekStart: "" });
    expect(missing).toEqual([PROJECT_PREREQUISITE]);
    expect(runButtonLabel("project-status", missing, false)).toBe("Run Report (select a project)");
  });

  test("ACCEPTANCE: the weekly report with no week start reads exactly 'Run Report (Week Start)'", () => {
    const missing = missingPrerequisites("weekly-project", { projectId: "p-1", weekStart: "" });
    expect(missing).toEqual([WEEK_START_PREREQUISITE]);
    expect(runButtonLabel("weekly-project", missing, false)).toBe("Run Report (Week Start)");
  });

  test("nothing missing leaves the primary saying only what it does", () => {
    expect(runButtonLabel("project-status", [], false)).toBe("Run Report");
  });

  test("a report with a screen of its own says it opens one", () => {
    // A hosted report with no name of its own still says it opens something;
    // item E-15 gives the Work Progress Report the specific words.
    expect(runButtonLabel("work-progress", [], true)).toBe("Open Report");
    expect(runButtonLabel("not-a-report", [], true)).toBe("Open Report");
  });

  test("a week start that is not a Monday is reported at the field, not on the button", () => {
    expect(weekStartFieldError("weekly-project", "2026-08-31")).toBeNull(); // a Monday
    expect(weekStartFieldError("weekly-project", "2026-09-02")).toBe(WEEK_START_NOT_MONDAY);
    // A report that has no week start cannot fail its validation.
    expect(weekStartFieldError("project-status", "2026-09-02")).toBeNull();
    expect(isMonday("2026-08-31")).toBe(true);
    expect(isMonday("not-a-date")).toBe(false);
  });
});

describe("a filter the backend does not apply (R67 E-11)", () => {
  const RESULT = {
    projectName: "Cedar Heights Villa - Phase 1",
    total: 1000,
    rows: [
      { category: "Civil", vendorId: "v-1", vendorName: "Alpha Contracting", amount: 600 },
      { category: "Paint", vendorId: "v-2", vendorName: "Beta Finishes", amount: 400 },
    ],
  };

  test("filters the rows and leaves the summary figures alone", () => {
    const out = applyClientFilters(RESULT, { category: "Civil", vendorId: null, vendorName: null });
    const result = out.result as typeof RESULT;
    expect(result.rows.map((r) => r.category)).toEqual(["Civil"]);
    // The total describes the whole project and must not silently start
    // describing one category.
    expect(result.total).toBe(1000);
    expect(out.categoryApplied).toBe(true);
  });

  test("matches a category case-insensitively -- an imported 'civil' is the same category as 'Civil'", () => {
    const out = applyClientFilters({ rows: [{ category: "civil", amount: 1 }] }, { category: "Civil", vendorId: null, vendorName: null });
    expect((out.result as { rows: unknown[] }).rows).toHaveLength(1);
  });

  test("filters by vendor id, and by vendor NAME where the report carries no id", () => {
    const byId = applyClientFilters(RESULT, { category: null, vendorId: "v-2", vendorName: "Beta Finishes" });
    expect((byId.result as typeof RESULT).rows.map((r) => r.vendorId)).toEqual(["v-2"]);

    const nameOnly = applyClientFilters(
      { rows: [{ vendorName: "Alpha Contracting", cost: 5 }, { vendorName: "Beta Finishes", cost: 7 }] },
      { category: null, vendorId: "v-1", vendorName: "Alpha Contracting" }
    );
    expect((nameOnly.result as { rows: { vendorName: string }[] }).rows.map((r) => r.vendorName)).toEqual(["Alpha Contracting"]);
    expect(nameOnly.vendorApplied).toBe(true);
  });

  test("a report with no such field is returned untouched, and SAYS so", () => {
    const source = { budget: 2193.75, rows: [{ trade: "Mason", workerDays: 4 }] };
    const state = { category: "Civil", vendorId: null, vendorName: null };
    const out = applyClientFilters(source, state);
    expect((out.result as typeof source).rows).toHaveLength(1);
    expect(out.categoryApplied).toBe(false);
    expect(unappliedFilterNote(state, out)).toBe('This report carries no category "Civil" — every row is shown.');
  });

  test("no filter chosen is not a filter -- the result comes back byte-identical", () => {
    const out = applyClientFilters(RESULT, { category: null, vendorId: null, vendorName: null });
    expect(out.result).toBe(RESULT);
    expect(unappliedFilterNote({ category: null, vendorId: null, vendorName: null }, out)).toBeNull();
  });
});
