/// <reference types="bun-types" />
// R67 E-01 (R-007). Renders the real ProjectRow through
// react-dom/server's renderToStaticMarkup and reads the output as HTML --
// the same approach WorkProgressReportClient.test.tsx uses, and for the same
// reason: this repo has no DOM-backed test runner wired up, but the component
// tree really is rendered, so these are assertions about the shipped markup
// rather than a description of it.
//
// ProjectRow deliberately takes `money` and its two callbacks as props (the
// router lives in the ProjectRowList wrapper), which is what makes this
// possible with no currencies fetch and no Next router context.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NoProjectsRow, ProjectRow, projectHref } from "./ProjectRow";
import type { DashboardProject } from "@/lib/dashboard-rows";
import { formatMoney } from "@/lib/format-money";

// R67 D-61 (second-merge fix): the real formatMoney(), not a hand-rolled
// toLocaleString() -- money-format-rule.test.ts bans the method itself
// anywhere under src/components, test files included.
const money = (v: number | string | null | undefined) => formatMoney(v, { currency: "AED" });

function project(overrides: Partial<DashboardProject> = {}): DashboardProject {
  return {
    id: "prj_cedar",
    name: "Cedar Heights Villa - Phase 1",
    revenue: 0,
    expenses: 412_000,
    taskCount: 12,
    delayedTaskCount: 0,
    value: 2_120_500,
    earnedValue: 0,
    percentByValue: 46,
    percentByActivity: 31,
    spendOverValue: false,
    permitsExpiring30d: 0,
    ...overrides,
  };
}

const noop = () => {};

describe("ProjectRow", () => {
  // R67 E-19 (R-180) ACCEPTANCE, first clause: "on /dashboard assert every
  // project row is a link whose href contains /dashboard/project?projectId=".
  // E-01 shipped the row as a <button> with router.push; a button cannot be
  // cmd-clicked into a new tab, cannot have its address copied, and shows a
  // screen reader no destination. It is an anchor now, and the click handler
  // is an enhancement layered on top of a real href.
  test("the whole row is a LINK, to that project's dashboard -- and still keyboard-operable", () => {
    const html = renderToStaticMarkup(<ProjectRow project={project()} money={money} onOpen={noop} />);
    expect(html).toContain("<a ");
    expect(html).toContain('href="/dashboard/project?projectId=prj_cedar"');
    expect(html).toContain("cursor-pointer");
    // No button anywhere in the row: two nested activatable things is how a
    // row ends up with a target that does something different from the row.
    expect(html).not.toContain("<button");
  });

  test("the href is still there with NO click handler at all -- the row works before the JS lands", () => {
    const html = renderToStaticMarkup(<ProjectRow project={project()} money={money} />);
    expect(html).toContain('href="/dashboard/project?projectId=prj_cedar"');
  });

  // R67 E-19 (R-180): "under it four tabular figures Revenue | Budget |
  // Expense | Progress".
  test("the four figures are labelled, in that order, and an absent one is the en dash not a zero", () => {
    const html = renderToStaticMarkup(
      <ProjectRow project={project({ budget: null, revenue: 12_000 })} money={money} />
    );
    expect(html).toContain('data-testid="project-row-figures"');
    const labels = [...html.matchAll(/<dt[^>]*>([^<]+)<\/dt>/g)].map((m) => m[1]);
    expect(labels).toEqual(["Revenue", "Budget", "Expense", "Progress"]);
    const values = [...html.matchAll(/<dd[^>]*>([^<]+)<\/dd>/g)].map((m) => m[1]);
    // Revenue real, Budget absent (en dash, never "AED 0.00"), Expense real,
    // Progress as a percentage rather than money.
    expect(values).toEqual(["AED 12,000.00", "–", "AED 412,000.00", "46%"]);
  });

  test("a project with no BOQ shows an en dash for Progress, not 0%", () => {
    const html = renderToStaticMarkup(<ProjectRow project={project({ percentByValue: null })} money={money} />);
    const values = [...html.matchAll(/<dd[^>]*>([^<]+)<\/dd>/g)].map((m) => m[1]);
    expect(values[3]).toBe("–");
  });

  test("prints the project name, the contract and the spend on one line", () => {
    const html = renderToStaticMarkup(<ProjectRow project={project()} money={money} onOpen={noop} />);
    expect(html).toContain("Cedar Heights Villa - Phase 1");
    expect(html).toContain("AED 2,120,500.00");
    expect(html).toContain("contract");
    expect(html).toContain("AED 412,000.00");
    expect(html).toContain("spent");
  });

  test("draws a real progress bar at the BOQ-value percentage", () => {
    const html = renderToStaticMarkup(<ProjectRow project={project()} money={money} onOpen={noop} />);
    expect(html).toContain('data-testid="project-row-bar"');
    expect(html).toContain('aria-valuenow="46"');
    expect(html).toContain("width:46%");
    expect(html).toContain("46% by BOQ value");
  });

  test("the activity-log percentage is present as SECOND, smaller text -- the two disagree on purpose", () => {
    const html = renderToStaticMarkup(<ProjectRow project={project()} money={money} onOpen={noop} />);
    expect(html).toContain("31% by activity log");
  });

  test("nothing logged reads 'No activity logged yet', never 0%", () => {
    const html = renderToStaticMarkup(<ProjectRow project={project({ percentByActivity: null })} money={money} onOpen={noop} />);
    expect(html).toContain("No activity logged yet");
    expect(html).not.toContain("0% by activity log");
  });

  test("no BOQ renders a HATCHED bar labelled 'No BOQ yet', not a 0 % bar", () => {
    const html = renderToStaticMarkup(
      <ProjectRow project={project({ percentByValue: null, value: null })} money={money} onOpen={noop} />
    );
    expect(html).toContain('data-testid="project-row-bar-hatched"');
    expect(html).toContain("No BOQ yet");
    expect(html).not.toContain('data-testid="project-row-bar"');
    // And the money that is genuinely unknown reads as the en dash.
    expect(html).toContain("–");
  });

  test("'on track' carries a tick glyph AND the word", () => {
    const html = renderToStaticMarkup(<ProjectRow project={project()} money={money} onOpen={noop} />);
    expect(html).toContain("on track");
    // lucide renders an inline <svg>; the state therefore never depends on colour alone.
    expect(html).toContain("<svg");
  });

  test("'needs you' carries the word, the glyph AND the reason", () => {
    const html = renderToStaticMarkup(
      <ProjectRow project={project({ spendOverValue: true, permitsExpiring30d: 2 })} money={money} onOpen={noop} />
    );
    expect(html).toContain("needs you");
    expect(html).toContain("spend over contract value");
    expect(html).toContain("2 permits expiring in 30 days");
  });
});

describe("projectHref", () => {
  test("points at the per-project dashboard, with the id encoded", () => {
    expect(projectHref("prj_cedar")).toBe("/dashboard/project?projectId=prj_cedar");
    expect(projectHref("a b&c")).toBe("/dashboard/project?projectId=a%20b%26c");
  });
});

describe("NoProjectsRow", () => {
  test("an org with no projects gets a ROW-SHAPED card that offers the next step, not an empty panel", () => {
    const html = renderToStaticMarkup(<NoProjectsRow />);
    expect(html).toContain("No projects yet — + New project");
    expect(html).toContain('href="/projects/new"');
  });
});
