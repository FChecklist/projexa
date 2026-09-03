import { describe, expect, test } from "bun:test";
import {
  AVAILABILITY_LABEL,
  OPEN_IN_PROJECT_REPORTS,
  PROJEXA_RUNNABLE_REPORTS,
  WORK_PROGRESS_REPORT_ROUTE,
  monthToDateRange,
  placeCatalogEntry,
  reportNameForCatalogId,
  reportSubject,
  type CatalogEntryLike,
} from "./report-registry";

function entry(over: Partial<CatalogEntryLike> = {}): CatalogEntryLike {
  return { id: "construction-attendance", name: "Attendance Report", route: "/api/construction/reports/attendance", source: "static", ...over };
}

describe("reportNameForCatalogId", () => {
  test("strips the prefix compliance-tracker's own catalog builder adds", () => {
    // report-catalog-service.ts builds route = /api/construction/reports/<name>
    // from id = "construction-<name>", so this is that map's inverse.
    expect(reportNameForCatalogId("construction-attendance")).toBe("attendance");
    expect(reportNameForCatalogId("construction-site-picture")).toBe("site-picture");
  });

  test("a construction id this app cannot actually run is not claimed", () => {
    // certified-payroll is a real catalog entry, but it needs a weekStart and
    // is not in the Project Reports picker -- claiming "Runs here" for it
    // would be the same lie in the other direction.
    expect(reportNameForCatalogId("construction-certified-payroll")).toBeNull();
  });

  test("a non-construction id is never claimed", () => {
    expect(reportNameForCatalogId("erp-trial-balance")).toBeNull();
    expect(reportNameForCatalogId("ai-performance-report")).toBeNull();
  });

  test("every runnable name round-trips through the prefix", () => {
    for (const name of PROJEXA_RUNNABLE_REPORTS) {
      expect(reportNameForCatalogId(`construction-${name}`)).toBe(name);
    }
  });
});

describe("placeCatalogEntry -- the catalog stops saying 'not yet viewable here' about reports it runs", () => {
  test("a construction report the Project Reports tab runs says 'Runs here', and the verb names where it opens", () => {
    const placement = placeCatalogEntry(entry());
    expect(placement.label).toBe("Runs here");
    // R67 E-28 (R-244): "Open in Project Reports", not a bare "Open" -- the
    // verb has to say WHERE, or the reader is left guessing whether the card
    // runs in place, navigates, or does nothing.
    expect(placement.action).toBe(OPEN_IN_PROJECT_REPORTS);
    expect(placement.action).toBe("Open in Project Reports");
    expect(placement.href).toBe("/reports?report=attendance");
    expect(placement.runsInPlace).toBe(false);
  });

  test("Work Progress goes to the ONE Work Progress Report route (D-02), not a second copy", () => {
    const placement = placeCatalogEntry(entry({ id: "construction-work-progress", name: "Work Progress Report" }));
    // R67 E-31: the route is still WORK_PROGRESS_REPORT_ROUTE's, and it now
    // carries the view so the destination arrives RUN rather than on a form.
    expect(placement.href?.startsWith(WORK_PROGRESS_REPORT_ROUTE.split("?")[0])).toBe(true);
    expect(placement.href).toBe("/work-progress?tab=report&view=scope");
    expect(placement.action).toBe("Open Work Progress Report");
  });

  test("a report that genuinely only runs in VERIDIAN says exactly that, and links there", () => {
    const placement = placeCatalogEntry(entry({ id: "erp-trial-balance", name: "Trial Balance", route: "/erp/reports" }));
    expect(placement.label).toBe(AVAILABILITY_LABEL["runs-in-veridian"]);
    expect(placement.label).toBe("Runs in VERIDIAN - open there");
    expect(placement.href).toBe("/erp/reports");
    // R67 E-31's own word: it states where the reader ENDS UP, rather than
    // promising an action this app is not the one performing.
    expect(placement.action).toBe("Opens in VERIDIAN");
  });

  test("a built report_definitions row still runs in place", () => {
    const placement = placeCatalogEntry(entry({ id: "rptdef_x", source: "definition", status: "built", definitionId: "def-1" }));
    expect(placement.runsInPlace).toBe(true);
    expect(placement.action).toBe("Run this report");
    expect(placement.href).toBeUndefined();
  });

  test("a data-gap definition says 'Not built - data gap' and offers nothing to click", () => {
    const placement = placeCatalogEntry(entry({ id: "rptdef_y", source: "definition", status: "data_gap", definitionId: "def-2" }));
    expect(placement.label).toBe("Not built - data gap");
    expect(placement.runsInPlace).toBe(false);
    expect(placement.href).toBeUndefined();
    expect(placement.note).toContain("not recorded anywhere yet");
  });

  test("a definition with no definitionId cannot be run, and does not pretend it can", () => {
    const placement = placeCatalogEntry(entry({ id: "rptdef_z", source: "definition", status: "built" }));
    expect(placement.runsInPlace).toBe(false);
    expect(placement.availability).toBe("not-built");
  });

  test("every placement either runs in place, links somewhere, or explains itself -- no dead card", () => {
    const cases: CatalogEntryLike[] = [
      entry(),
      entry({ id: "construction-work-progress" }),
      entry({ id: "erp-trial-balance", route: "/erp/reports" }),
      entry({ id: "d1", source: "definition", status: "built", definitionId: "x" }),
      entry({ id: "d2", source: "definition", status: "planned", definitionId: "y" }),
      entry({ id: "d3", source: "definition", status: "data_gap", definitionId: "z" }),
    ];
    for (const c of cases) {
      const p = placeCatalogEntry(c);
      expect(p.runsInPlace || Boolean(p.href) || Boolean(p.note)).toBe(true);
    }
  });
});

// R67 E-31 (R-264). The defaults a catalog card runs with, and the context its
// links carry.
describe("monthToDateRange (R67 E-31)", () => {
  test("first of the current month through today", () => {
    expect(monthToDateRange(new Date(2026, 8, 2))).toEqual({ from: "2026-09-01", to: "2026-09-02" });
  });

  test("single-digit months and days are zero-padded, so the string is a real ISO date", () => {
    expect(monthToDateRange(new Date(2026, 0, 5))).toEqual({ from: "2026-01-01", to: "2026-01-05" });
  });

  test("on the first of a month the range is that one day, not an empty window", () => {
    expect(monthToDateRange(new Date(2026, 11, 1))).toEqual({ from: "2026-12-01", to: "2026-12-01" });
  });

  test("the last day of a long month is still inside its own month", () => {
    expect(monthToDateRange(new Date(2026, 6, 31))).toEqual({ from: "2026-07-01", to: "2026-07-31" });
  });
});

describe("reportSubject (R67 E-31)", () => {
  test("drops the trailing noun so the sentence reads about the DATA, not the document", () => {
    // "No attendance report between ..." reads as if the report is missing.
    expect(reportSubject("Attendance Report")).toBe("attendance");
    expect(reportSubject("Vendor Cost Report")).toBe("vendor cost");
    expect(reportSubject("Work Analysis")).toBe("work");
  });

  test("a name with no such suffix is simply lowercased", () => {
    expect(reportSubject("Site Picture Log")).toBe("site picture log");
  });

  test("a name that is ONLY the suffix keeps its word rather than becoming nothing", () => {
    expect(reportSubject("Report")).toBe("report");
    expect(reportSubject("  Analysis  ")).toBe("analysis");
  });
});

describe("placeCatalogEntry link context (R67 E-31)", () => {
  const context = { projectId: "prj-cedar", from: "2026-09-01", to: "2026-09-02" };

  test("the Work Progress row carries project, range and view -- so it arrives RUN", () => {
    const placement = placeCatalogEntry(entry({ id: "construction-work-progress", name: "Work Progress Report" }), context);
    const url = new URL(placement.href!, "https://projexa-ai.com");
    expect(url.pathname).toBe("/work-progress");
    expect(url.searchParams.get("tab")).toBe("report");
    expect(url.searchParams.get("projectId")).toBe("prj-cedar");
    expect(url.searchParams.get("from")).toBe("2026-09-01");
    expect(url.searchParams.get("to")).toBe("2026-09-02");
    expect(url.searchParams.get("view")).toBe("scope");
  });

  test("an in-app report row carries the PROJECT but not the range -- its own screen owns its parameters", () => {
    const placement = placeCatalogEntry(entry(), context);
    expect(placement.href).toBe("/reports?report=attendance&projectId=prj-cedar");
  });

  test("with no project resolved yet, the links are still real links", () => {
    expect(placeCatalogEntry(entry(), {}).href).toBe("/reports?report=attendance");
    expect(placeCatalogEntry(entry({ id: "construction-work-progress" }), {}).href).toBe(
      "/work-progress?tab=report&view=scope"
    );
  });

  test("a VERIDIAN route is left exactly as VERIDIAN gave it -- this app does not rewrite another app's URLs", () => {
    const placement = placeCatalogEntry(entry({ id: "erp-trial-balance", route: "/erp/reports" }), context);
    expect(placement.href).toBe("/erp/reports");
  });

  test("no card offers 'Run this report' unless it can really run one", () => {
    // The whole acceptance clause, restated: a runsInPlace card always has a
    // definition behind it, and every other card has somewhere to go or a
    // reason why not.
    const cases: CatalogEntryLike[] = [
      entry(),
      entry({ id: "construction-work-progress" }),
      entry({ id: "erp-trial-balance", route: "/erp/reports" }),
      entry({ id: "d1", source: "definition", status: "built", definitionId: "def-1" }),
      entry({ id: "d2", source: "definition", status: "planned", definitionId: "def-2" }),
      entry({ id: "d3", source: "definition", status: "built" }),
    ];
    for (const c of cases) {
      const p = placeCatalogEntry(c, context);
      if (p.action === "Run this report") {
        expect(p.runsInPlace).toBe(true);
        expect(c.definitionId).toBeTruthy();
      } else {
        expect(Boolean(p.href) || Boolean(p.note)).toBe(true);
      }
    }
  });
});
