import { describe, expect, test } from "bun:test";
import { ROUTES } from "../clusters/overview";
import { findShellRoute, navRoutes } from "../route-table";

describe("the overview cluster's routes", () => {
  test("dashboard, project dashboard, reports, analysis hub, exceptions and project 360 are registered", () => {
    expect(ROUTES.map((r) => r.pattern)).toEqual(["/dashboard", "/dashboard/project", "/reports", "/analysis", "/analysis/exceptions", "/analysis/project-360"]);
    for (const path of ["/dashboard", "/dashboard/project", "/reports", "/analysis", "/analysis/exceptions", "/analysis/project-360"]) {
      expect(findShellRoute(path)?.route.pattern).toBe(path);
    }
    // Not converted: opened from the server when online, explained calmly when not.
    expect(findShellRoute("/dashboard/hierarchy")).toBeNull();
  });

  test("nav orders: the dashboard in 0-9 (first in the header), the rest in 80-99", () => {
    const withNav = ROUTES.filter((r) => r.nav);
    expect(withNav.find((r) => r.pattern === "/dashboard")?.nav?.order).toBeLessThan(10);
    for (const r of withNav.filter((r) => r.pattern !== "/dashboard")) expect(r.nav!.order).toBeGreaterThanOrEqual(80);
    for (const r of withNav.filter((r) => r.pattern !== "/dashboard")) expect(r.nav!.order).toBeLessThanOrEqual(99);
    expect(navRoutes()[0]).toEqual({ href: "/dashboard", label: "Dashboard" });
  });

  test("every route loads a function component and has an adapter", async () => {
    for (const route of ROUTES) {
      expect(typeof (await route.load()).default).toBe("function");
      expect(typeof route.adapter).toBe("function");
    }
  });
});
