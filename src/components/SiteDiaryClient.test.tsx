/// <reference types="bun-types" />
// Owner work order PROJEXA-E2E-001, section 5 item 3: "/site-diary -- Empty
// while Work Progress holds the same history." Re-investigated end to end
// (compliance-tracker's listSiteDiaries() service call, called directly
// against the live Supabase project) -- construction_site_diaries genuinely
// has 5 real rows for org=projexa_demo_org / project=projexa_demo_project
// ("Villa 21 - Whitefield"), alongside 35 real work-progress entries for the
// same project. The table and the query were never empty or wrong.
// The real defect: this screen never named which project it was showing, so
// resolveSelectedProject()'s documented, deliberate first-project fallback
// (src/lib/project-selection.ts) could silently land a viewer on a DIFFERENT
// project that genuinely has zero diary entries, and the empty state gave no
// hint that was what had happened -- indistinguishable from "PROJEXA has no
// site diary feature". site-diary/page.tsx now passes `projectName` +
// `resolvedByFallback` down (same D-13/D-20/D-32 convention already proven
// out on DocumentsClient/LabourClient/ChangeOrdersClient, PR #299), and
// these tests are this component's half of that fix: the empty state must
// name the project, and must say so out loud when nobody chose it.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/site-diary",
}));

const mod = await import("./SiteDiaryClient");
const SiteDiaryClient = mod.default;

const DIARY_ENTRY = {
  id: "diary-1",
  diaryDate: "2026-07-11",
  weather: "Clear",
  workDone: "Bathroom fitting installation started",
  labourCount: 12,
  issues: null,
};

const realFetch = globalThis.fetch;
let requested: string[] = [];

/** `/api/site-diary` answers with `diaries`. */
function stubFetch(diaries: unknown[]) {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("/api/site-diary?")) {
      return new Response(JSON.stringify({ diaries }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

beforeEach(() => {
  requested = [];
  push.mockClear();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("SiteDiaryClient -- empty state names the project (PROJEXA-E2E-001 section 5 item 3)", () => {
  test("with projectName but no resolvedByFallback: plain, project-scoped message, no fallback admission", async () => {
    stubFetch([]);
    const { getByText, queryByText } = render(
      <SiteDiaryClient projectId="p1" projectName="Business Bay Corporate HQ" />
    );

    await waitFor(() => expect(getByText("No diary entries yet for Business Bay Corporate HQ.")).toBeDefined());
    expect(queryByText(/auto-selected/i)).toBeNull();
  });

  test("with resolvedByFallback=true: the empty state admits the project was picked FOR the user, not by them", async () => {
    stubFetch([]);
    const { getByText } = render(
      <SiteDiaryClient projectId="p1" projectName="Business Bay Corporate HQ" resolvedByFallback />
    );

    await waitFor(() => expect(getByText("No diary entries yet for Business Bay Corporate HQ.")).toBeDefined());
    expect(getByText(/This project was auto-selected/i)).toBeDefined();
  });

  test("with no projectName at all (prop omitted): falls back to the old, generic sentence rather than throwing", async () => {
    stubFetch([]);
    const { getByText } = render(<SiteDiaryClient projectId="p1" />);
    await waitFor(() => expect(getByText("No diary entries yet.")).toBeDefined());
  });

  test("REGRESSION: a project that genuinely HAS diary entries still renders them -- the fix must not turn a real response into an empty state", async () => {
    stubFetch([DIARY_ENTRY, { ...DIARY_ENTRY, id: "diary-2", diaryDate: "2026-07-10", workDone: "Cove lighting channel wiring completed" }]);
    const { getByText, queryByText } = render(
      <SiteDiaryClient projectId="p1" projectName="Villa 21 - Whitefield" resolvedByFallback={false} />
    );

    await waitFor(() => expect(getByText("Bathroom fitting installation started")).toBeDefined());
    expect(getByText("Cove lighting channel wiring completed")).toBeDefined();
    expect(queryByText(/No diary entries yet/i)).toBeNull();
    expect(requested.some((u) => u.includes("/api/site-diary?projectId=p1"))).toBe(true);
  });
});
