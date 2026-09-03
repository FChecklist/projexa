/// <reference types="bun-types" />
// R67 E-23 (R-206). The three states this block owes the reader -- labelled
// skeleton, "Couldn't load ... Retry", and the drawn chart -- plus the two
// properties that make the chart honest: the figure is PRINTED at every bar
// end (never left to the mark), and a missing figure says "Not set" instead
// of drawing a zero-length bar that reads as a real zero.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), refresh: mock(() => {}), replace: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/hierarchy",
}));

import { cleanup, render } from "@testing-library/react";
import { HierarchyProjectBars } from "./HierarchyProjectBars";
import type { OrgMoney } from "@/lib/use-org-money";
import { formatMoney, currencyUnitSuffix } from "@/lib/format-money";

afterEach(cleanup);

const AED: OrgMoney = {
  currency: "AED",
  loaded: true,
  currencySet: true,
  showNotice: false,
  format: { currency: "AED" },
  money: (v, override) => formatMoney(v, { currency: "AED", ...override }),
  signedMoney: (v) => formatMoney(v, { currency: "AED" }),
  unitSuffix: currencyUnitSuffix({ currency: "AED" }) ?? "",
  notice: "",
};

const PROJECTS = [
  { id: "p1", name: "Cedar Heights Villa - Phase 1", revenue: 900_000, boqBudget: 400_000, earnedValue: 118_750 },
  { id: "p2", name: "Marina Fit-out", revenue: 120_000, boqBudget: null, budget: null, earnedValue: null },
];

function renderBars(over: Partial<Parameters<typeof HierarchyProjectBars>[0]> = {}) {
  return render(
    <HierarchyProjectBars
      projects={PROJECTS}
      orgMoney={AED}
      loading={false}
      error={null}
      onRetry={() => {}}
      dateRangeApplied={false}
      {...over}
    />
  );
}

describe("HierarchyProjectBars", () => {
  test("loading shows a LABELLED skeleton, so the reader knows what is coming", () => {
    const { container } = renderBars({ loading: true, projects: null });
    expect(container.textContent).toContain("Loading revenue, budget and earned value per project");
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
  });

  test("a failed load says so in the backend's own words and offers Retry", () => {
    const { container, getByRole } = renderBars({ error: "the workspace backend did not answer", projects: null });
    expect(container.textContent).toContain("Couldn't load project data");
    expect(container.textContent).toContain("the workspace backend did not answer");
    expect(getByRole("button", { name: "Retry" })).toBeDefined();
  });

  test("one row per project, ordered by revenue descending, each a door to its dashboard", () => {
    const { getAllByRole } = renderBars();
    const links = getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("/dashboard/project?projectId=p1");
    expect(links[0].textContent).toContain("Cedar Heights Villa - Phase 1");
    expect(links[1].getAttribute("href")).toBe("/dashboard/project?projectId=p2");
  });

  test("every bar prints its figure -- the chart is readable without hovering", () => {
    const { container } = renderBars();
    expect(container.textContent).toContain("AED 900,000");
    expect(container.textContent).toContain("AED 400,000");
    expect(container.textContent).toContain("AED 118,750");
  });

  test("a project with no budget and no earned value says 'Not set', it does not draw a zero", () => {
    const { container } = renderBars({ projects: [PROJECTS[1]] });
    expect(container.textContent).toContain("Not set");
    expect(container.textContent).not.toContain("AED 0");
  });

  test("the date-range caveat appears only when a range is actually set", () => {
    const without = renderBars();
    expect(without.container.textContent).not.toContain("not date-filtered");
    cleanup();
    const withRange = renderBars({ dateRangeApplied: true });
    expect(withRange.container.textContent).toContain("Budget is BOQ x budget %, not date-filtered");
  });

  test("each series carries a WORD beside its swatch, never colour alone", () => {
    const { container } = renderBars();
    expect(container.textContent).toContain("Revenue");
    expect(container.textContent).toContain("Budget");
    expect(container.textContent).toContain("Progress (earned value)");
  });

  test("an empty project list says so rather than drawing an empty axis", () => {
    const { container } = renderBars({ projects: [] });
    expect(container.textContent).toContain("No projects in this scope yet.");
  });
});
