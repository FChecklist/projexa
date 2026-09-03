/// <reference types="bun-types" />
// R67 E-17 (R-175 / R-179). The registry's whole value is that it CANNOT
// disagree with the three modules it composes -- so these tests assert exactly
// that, rather than re-listing what it says.
import { describe, expect, test } from "bun:test";
import { isHostedReport, reportDestination } from "./report-destinations";
import { reportParameters } from "./report-parameters";
import { reportSchema } from "./report-schema";
import { isInReportRegistry, registryDestination, reportRegistryEntry } from "./report-registry";

// The picker's own list, which is what "a report PROJEXA knows" means.
const PICKER_IDS = [
  "project-status", "project-completion", "work-progress", "category-progress",
  "weekly-project", "attendance", "manpower-cost", "site-picture", "scope",
  "budget-summary", "budget-vs-actual", "material-consumption", "vendor-cost",
  "designer-timesheet", "kpi", "revenue", "expense",
];

describe("reportRegistryEntry: composed, never restated (R67 E-17)", () => {
  test("every picker report is in the registry", () => {
    for (const id of PICKER_IDS) expect(isInReportRegistry(id)).toBe(true);
  });

  test("a name that is not a report is not in it, and says so rather than inventing an entry", () => {
    expect(isInReportRegistry("not-a-report")).toBe(false);
    expect(isInReportRegistry("")).toBe(false);
    expect(isInReportRegistry(null)).toBe(false);
    expect(reportRegistryEntry("not-a-report")).toBeNull();
  });

  test("`supports` is exactly what report-parameters.ts says -- it cannot drift, because it is not a copy", () => {
    for (const id of PICKER_IDS) {
      const spec = reportParameters(id);
      expect(reportRegistryEntry(id)!.supports).toEqual({
        dateRange: spec.needsDateRange,
        weekStart: spec.needsWeekStart,
        category: spec.supportsCategory,
        vendor: spec.supportsVendor,
      });
    }
  });

  test("`mode` is 'navigate' for exactly the reports report-destinations.ts hosts", () => {
    for (const id of PICKER_IDS) {
      expect(reportRegistryEntry(id)!.mode === "navigate").toBe(isHostedReport(id));
    }
  });

  test("`exportable` is exactly report-schema.ts's serverExport", () => {
    for (const id of PICKER_IDS) {
      expect(reportRegistryEntry(id)!.exportable).toBe(reportSchema(id)?.serverExport === true);
    }
  });

  test("every navigating report NAMES its screen, in words a reader would say aloud", () => {
    for (const id of PICKER_IDS) {
      const entry = reportRegistryEntry(id)!;
      if (entry.mode !== "navigate") {
        expect(entry.screen).toBeNull();
        continue;
      }
      expect(entry.screen).toBeTruthy();
      // A screen name, not a route: a reader is told "Work Progress > Report",
      // never "/work-progress?tab=report".
      expect(entry.screen!.startsWith("/")).toBe(false);
    }
    expect(reportRegistryEntry("work-progress")!.screen).toBe("Work Progress > Report");
    expect(reportRegistryEntry("designer-timesheet")!.screen).toBe("Design Studio > Cost Analysis");
  });
});

describe("defaultParams: a report opens ready to run (R67 E-17)", () => {
  const TODAY = new Date("2026-09-03T00:00:00.000Z");

  test("a report that reads a period gets month-to-date", () => {
    expect(reportRegistryEntry("work-progress")!.defaultParams({ projectId: "p-1", today: TODAY })).toEqual({
      projectId: "p-1", from: "2026-09-01", to: "2026-09-03",
    });
  });

  test("a report that IGNORES the period gets none -- a link must not carry parameters that describe nothing", () => {
    // category-progress takes a projectId and nothing else; the parameter card
    // says so at the field rather than offering two dates that do nothing.
    expect(reportParameters("category-progress").needsDateRange).toBe(false);
    expect(reportRegistryEntry("category-progress")!.defaultParams({ projectId: "p-1", today: TODAY })).toEqual({
      projectId: "p-1",
    });
  });

  test("registryDestination opens the report where report-destinations.ts says, with those defaults", () => {
    const destination = registryDestination("work-progress", { projectId: "p-1", today: TODAY });
    expect(destination).toEqual(
      reportDestination("work-progress", { projectId: "p-1", from: "2026-09-01", to: "2026-09-03" })
    );
    expect(destination!.kind).toBe("navigate");
  });

  test("an unknown report has no destination rather than a guessed one", () => {
    expect(registryDestination("not-a-report", { projectId: "p-1" })).toBeNull();
  });
});
