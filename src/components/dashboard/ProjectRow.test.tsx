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

const money = (v: number | string | null | undefined) =>
  v === null || v === undefined ? "–" : `AED ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  test("the whole row is a button -- so it is reachable and operable from the keyboard", () => {
    const html = renderToStaticMarkup(<ProjectRow project={project()} money={money} onOpen={noop} />);
    expect(html).toContain('<button');
    expect(html).toContain('type="button"');
    expect(html).toContain("cursor-pointer");
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
