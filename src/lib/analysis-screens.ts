// R67 E-27 (R-213). WHERE "Analysis" GOES.
//
// The Analysis leaf is one of the fourteen entry points in the shell's pill
// strip, and clicking it landed nowhere: the pill catalogue carries no
// function id for it until a user has already used it once, so the first click
// -- the only one that matters for a reader finding out what Analysis is --
// fell through to seeding the composer draft with the word "Analysis".
//
// There genuinely are analytical screens in this product; they were just
// scattered as tabs inside four other modules, reachable only by knowing which
// module hid which chart. This module is the list, kept pure so the routes are
// asserted by a test rather than trusted, and so /analysis and the shell
// cannot drift into naming two different destinations.

export type AnalysisScreen = {
  key: string;
  label: string;
  /** What question this screen answers, in words. The list is useless without it. */
  description: string;
  /** Built by analysisScreens() with the caller's project already carried. */
  href: string;
  /** True when the screen is project-scoped and no project is selected yet. */
  needsProject: boolean;
};

/** The one route the Analysis leaf points at. */
export const ANALYSIS_ROUTE = "/analysis";

type Entry = { key: string; label: string; description: string; path: string; query: Record<string, string>; needsProject: boolean };

const ENTRIES: Entry[] = [
  {
    key: "work-progress-analytics",
    label: "Work Progress Analytics",
    description: "Logged % and earned % per scope category, with the entries behind each bar.",
    path: "/work-progress",
    query: { tab: "analytics" },
    needsProject: true,
  },
  {
    key: "cost-variance",
    label: "Cost Variance",
    description: "Budget against vendor amount for every BOQ line, worst overrun first.",
    path: "/scope",
    query: { tab: "variance" },
    needsProject: true,
  },
  {
    key: "category-distribution",
    label: "Category distribution",
    description: "Each trade's share of the BOQ and how much of it is complete.",
    path: "/dashboard/project",
    query: {},
    needsProject: true,
  },
  {
    key: "designer-cost",
    label: "Designer cost analysis",
    description: "Hours and cost per designer against their budget line.",
    path: "/reports",
    query: { report: "designer-timesheet" },
    needsProject: true,
  },
];

/**
 * The list, with the current project carried into every destination. A screen
 * that needs a project and has none still gets its row -- with the reason -- so
 * the reader learns the screen exists and what it wants, rather than seeing a
 * shorter list on some days than others.
 */
export function analysisScreens(projectId: string | null | undefined): AnalysisScreen[] {
  return ENTRIES.map((entry) => {
    const params = new URLSearchParams(entry.query);
    if (projectId) params.set("projectId", projectId);
    const qs = params.toString();
    return {
      key: entry.key,
      label: entry.label,
      description: entry.description,
      href: qs ? `${entry.path}?${qs}` : entry.path,
      needsProject: entry.needsProject && !projectId,
    };
  });
}
