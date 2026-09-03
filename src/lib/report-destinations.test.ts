/// <reference types="bun-types" />
// R67 E-04 (R-079) / E-05 (R-103): the same-name-same-destination rule, which
// is the whole point of this module -- one answer to "where does this report
// name go", shared by the Project Reports picker and the Full Catalog, so the
// two tabs cannot contradict each other again.
import { describe, expect, test } from "bun:test";
import {
  catalogDestination,
  catalogSlug,
  isHostedReport,
  monthToDate,
  reportDestination,
} from "./report-destinations";

const PARAMS = { projectId: "p-1", from: "2026-09-01", to: "2026-09-02" };

describe("reportDestination", () => {
  test("Work Progress NAVIGATES to its own screen -- it is never fetched from the Reports frame", () => {
    // Fetching it here is the 24.3 s spinner the audit measured; the same
    // report renders in 2.7 s with exports at /work-progress?tab=report.
    const d = reportDestination("work-progress", PARAMS);
    expect(d.kind).toBe("navigate");
    expect(d.kind === "navigate" && d.href).toBe("/work-progress?tab=report&projectId=p-1&from=2026-09-01&to=2026-09-02");
  });

  test("Material Consumption navigates to the Materials Cost Report tab -- one report, two doors", () => {
    const d = reportDestination("material-consumption", PARAMS);
    expect(d.kind).toBe("navigate");
    expect(d.kind === "navigate" && d.href).toBe("/materials?tab=cost-report&projectId=p-1&from=2026-09-01&to=2026-09-02");
  });

  test("every other report is still FETCHED, exactly as before", () => {
    const d = reportDestination("project-status", { projectId: "p-1" });
    expect(d.kind).toBe("fetch");
    expect(d.kind === "fetch" && d.path).toBe("/api/reports/project-status?projectId=p-1");
  });

  test("the weekly report carries its week start; nothing else does", () => {
    const weekly = reportDestination("weekly-project", { projectId: "p-1", weekStart: "2026-08-31" });
    expect(weekly.kind === "fetch" && weekly.path).toContain("weekStart=2026-08-31");
    const status = reportDestination("project-status", { projectId: "p-1", weekStart: "2026-08-31" });
    expect(status.kind === "fetch" && status.path).not.toContain("weekStart");
  });

  test("a report name with a slash or a space cannot escape its own path segment", () => {
    const d = reportDestination("a/b c", { projectId: "p-1" });
    expect(d.kind === "fetch" && d.path).toBe("/api/reports/a%2Fb%20c?projectId=p-1");
  });

  test("isHostedReport agrees with reportDestination -- one fact, not two", () => {
    for (const name of ["work-progress", "material-consumption", "project-status", "kpi"]) {
      expect(isHostedReport(name)).toBe(reportDestination(name, PARAMS).kind === "navigate");
    }
  });
});

describe("catalogSlug", () => {
  test("reads the slug out of an API-only catalog route", () => {
    expect(catalogSlug("/api/construction/reports/site-picture")).toBe("site-picture");
  });

  test("reads the SAME slug out of the PROJEXA screen route, so a card and a picker entry agree", () => {
    expect(catalogSlug("/work-progress?tab=report")).toBe("work-progress");
  });

  test("a trailing slash, a fragment or nothing at all does not produce a bogus slug", () => {
    expect(catalogSlug("/api/construction/reports/scope/")).toBe("scope");
    expect(catalogSlug("/work-progress#top")).toBe("work-progress");
    expect(catalogSlug(null)).toBeNull();
    expect(catalogSlug("")).toBeNull();
  });
});

describe("catalogDestination", () => {
  test("a report with a PROJEXA screen gets the words AND the link", () => {
    const d = catalogDestination("/work-progress?tab=report", PARAMS)!;
    expect(d.label).toBe("Runs here — Work Progress > Report");
    expect(d.href).toContain("/work-progress?tab=report&projectId=p-1");
  });

  test("a report with NO PROJEXA screen returns null -- the card keeps its honest note", () => {
    // Site Picture has no view yet. Claiming one would be the same defect as
    // "Not yet viewable here" on a report that does, facing the other way.
    expect(catalogDestination("/api/construction/reports/site-picture", PARAMS)).toBeNull();
  });

  test("an unrecognised route is null rather than a guess", () => {
    expect(catalogDestination("/erp/reports", PARAMS)).toBeNull();
    expect(catalogDestination(undefined, PARAMS)).toBeNull();
  });
});

describe("monthToDate", () => {
  test("runs from the 1st of the month to today", () => {
    expect(monthToDate(new Date("2026-09-02T10:00:00Z"))).toEqual({ from: "2026-09-01", to: "2026-09-02" });
  });

  test("on the 1st, from and to are the same day -- a real one-day window, not an empty one", () => {
    expect(monthToDate(new Date("2026-09-01T10:00:00Z"))).toEqual({ from: "2026-09-01", to: "2026-09-01" });
  });
});
