import { describe, expect, test } from "bun:test";
import {
  AVAILABILITY_LABEL,
  OPEN_IN_PROJECT_REPORTS,
  PROJEXA_RUNNABLE_REPORTS,
  WORK_PROGRESS_REPORT_ROUTE,
  placeCatalogEntry,
  reportNameForCatalogId,
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
    expect(placement.href).toBe(WORK_PROGRESS_REPORT_ROUTE);
    expect(placement.action).toBe("Open Work Progress Report");
  });

  test("a report that genuinely only runs in VERIDIAN says exactly that, and links there", () => {
    const placement = placeCatalogEntry(entry({ id: "erp-trial-balance", name: "Trial Balance", route: "/erp/reports" }));
    expect(placement.label).toBe(AVAILABILITY_LABEL["runs-in-veridian"]);
    expect(placement.label).toBe("Runs in VERIDIAN - open there");
    expect(placement.href).toBe("/erp/reports");
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
