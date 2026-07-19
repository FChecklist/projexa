import type { Locator, Page } from "@playwright/test";

// Real, verified DOM fact (confirmed via Playwright accessibility snapshots
// while iterating on this suite against the live site): every form in this
// app follows the exact same shadcn pattern --
//   <div className="space-y-1.5"><Label>Field Name</Label><Input/></div>
// -- with NO `htmlFor`/`id` association between Label and Input (grep of
// src/components/ui/label.tsx + every *Client.tsx form confirms this is
// systemic, not a one-off). `page.getByLabel(...)` therefore never matches
// anything in this app. This helper locates the real control the same way
// a sighted user would -- the form element immediately following the
// label text within their shared wrapper -- instead.
export function fieldByLabel(scope: Locator, labelText: string): Locator {
  return scope.getByText(labelText, { exact: true }).first().locator("xpath=following-sibling::*[1]");
}

// The persistent app shell (sidebar project switcher `<select>`-like
// combobox, mounted once in (app)/layout.tsx) renders BEFORE any page's
// own content in the DOM, so an unscoped `page.getByRole("combobox").first()`
// silently grabs the project switcher instead of the page's own filter --
// a real trap this suite hit repeatedly while iterating. Scope real
// in-page filter controls to the active tab panel (Radix Tabs renders
// `[role=tabpanel]` for the active tab) or a dialog instead of the bare page.
export function activeTabPanel(page: Page): Locator {
  return page.getByRole("tabpanel");
}

// Same underlying gap as fieldByLabel() above (no htmlFor/id association
// anywhere), reached independently while authoring Batch B -- a `Page`-scoped
// variant using `label` tag matching + xpath sibling rather than
// `getByText().first()`, since Batch B's dialogs are simple and this reads
// slightly more precisely for that case. Kept as a distinct name (not
// merged into fieldByLabel above) specifically so neither batch's
// already-verified spec files need to change their call sites.
export function fieldInput(page: Page, labelText: string | RegExp): Locator {
  return page.locator("label", { hasText: labelText }).locator("xpath=following-sibling::*[1]");
}

// Real project ids/names for the seeded "Meridian Construction Group (E2E
// Test Org)" -- confirmed live via /api/projects during Phase 2 authoring
// (see PHASE2_BATCH_B_FINDINGS.md). The first project ("Meridian Heights")
// is what every project-scoped page (labour/ffe/floor-plans/mood-boards/
// documents) resolves to when navigated without a `?projectId=` param, per
// resolveSelectedProject()'s projects[0] fallback (src/lib/project-selection.ts:36)
// -- though see PHASE2_BATCH_B_FINDINGS.md's "Batch A test-project pollution"
// note for why this suite stopped relying on that default resolution.
export const PROJECTS = {
  meridianHeights: { id: "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04", name: "Meridian Heights - Residential Tower A" },
  emeraldBusinessPark: { id: "c37a232d-5535-4630-afdc-9cc78c792bd5", name: "Emerald Business Park - Phase 1" },
  riversideSchool: { id: "6d51a606-dfc5-4a04-81f2-2b5e2a1686d5", name: "Riverside Public School Renovation" },
  highwayWarehouse: { id: "43b11bc8-59a9-4f0e-b91e-758de05db50a", name: "Highway Logistics Warehouse Complex" },
};

export const DEFAULT_PROJECT = PROJECTS.meridianHeights;

export async function apiGet<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(path);
  if (!res.ok()) {
    throw new Error(`GET ${path} => ${res.status()} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

// Navigates and returns the JSON body of the page's OWN client-side fetch
// (matched by urlSubstring) instead of a separately-timed page.request.get()
// issued before navigation. Every module in this suite fetches its data
// client-side in a useEffect after mount (see PHASE2_BATCH_B_FINDINGS.md's
// per-module notes) -- a pre-fetch taken moments before goto() races
// against whatever the page's own fetch sees, and on a live, shared,
// concurrently-written-to org (this suite's own earlier runs' leftover
// writes, or sibling E2E batches) that race is real, not theoretical.
// Capturing the exact response the page rendered from eliminates it.
export async function gotoAndCapture<T>(page: Page, path: string, urlSubstring: string): Promise<T> {
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(urlSubstring) && r.request().method() === "GET"),
    page.goto(path),
  ]);
  return response.json() as Promise<T>;
}

// A unique-enough suffix for this test run's created rows, so re-runs
// against the same live, persistent org don't collide on unique-ish fields
// (vendor/item names aren't enforced-unique server-side, but distinct names
// make it possible to tell this run's rows apart in the live data if anyone
// looks) and repeated runs can each find *their own* created row rather
// than an earlier run's leftover one.
export function uniqueSuffix(): string {
  return `${process.env.PLAYWRIGHT_RUN_TAG ?? "e2e"}-${Math.random().toString(36).slice(2, 8)}`;
}
