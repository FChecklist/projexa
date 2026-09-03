/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { ANALYSIS_ROUTE, analysisScreens } from "./analysis-screens";

describe("analysisScreens", () => {
  test("every screen carries the current project", () => {
    for (const screen of analysisScreens("prj-cedar")) {
      expect(screen.href).toContain("projectId=prj-cedar");
      expect(screen.needsProject).toBe(false);
    }
  });

  test("the four analytical screens the audit named, at their real routes", () => {
    const byKey = Object.fromEntries(analysisScreens("p1").map((s) => [s.key, s.href]));
    expect(byKey["work-progress-analytics"]).toBe("/work-progress?tab=analytics&projectId=p1");
    expect(byKey["cost-variance"]).toBe("/scope?tab=variance&projectId=p1");
    expect(byKey["category-distribution"]).toBe("/dashboard/project?projectId=p1");
    expect(byKey["designer-cost"]).toBe("/reports?report=designer-timesheet&projectId=p1");
  });

  test("with no project the rows stay, flagged -- a shorter list on some days teaches nothing", () => {
    const screens = analysisScreens(null);
    expect(screens).toHaveLength(4);
    expect(screens.every((s) => s.needsProject)).toBe(true);
    expect(screens[0].href).toBe("/work-progress?tab=analytics");
  });

  test("every row says what question its screen answers", () => {
    for (const screen of analysisScreens("p1")) {
      expect(screen.description.length).toBeGreaterThan(20);
    }
  });

  test("the leaf's route is the page this list lives on", () => {
    expect(ANALYSIS_ROUTE).toBe("/analysis");
  });
});
