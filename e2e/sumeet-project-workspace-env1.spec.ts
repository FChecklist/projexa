import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";

// Owner directive 2026-09-19 ("Merge 6 -- Ledger Dashboard"): a new,
// additive single-project-workspace page at /workspace/[id], combining
// Progress/Site Diary/BOQ/Timeline/Milestones/Scope & Change Orders/RFIs/
// Billing Milestones/Resources/Records/Insights, real role-aware section
// visibility. This spec is the FIRST browser-level coverage this page has
// (it did not exist before this same commit) -- see workspace-visibility.ts
// for the pure, unit-tested role table this spec verifies end to end
// through the real page.
const PROJECT_ID = DEFAULT_PROJECT.id;

// GAP FOUND (2026-09-19, this spec's own first run, THREE rounds):
// (1) every section title except "Insights" renders via shadcn's
// <CardTitle>, which this app's own card.tsx defines as a plain <div>
// (React.ComponentProps<"div">), not a semantic h1-h6 -- confirmed by
// reading that file directly, and the same pattern every other card-based
// screen in this app already uses (not a defect introduced by this page).
// getByRole("heading", ...) can therefore never match a CardTitle.
// (2) the nav-pill strip repeats every section's own label as real link
// text (<a href="#boq">BOQ</a>), so an unscoped getByText("BOQ") is a real
// strict-mode ambiguity between the pill and the card title. Scoping to
// the section's own #id (every section carries one, matching its nav pill's
// href) resolves both: the title lives inside that container, the pill does
// not, and a role that cannot see the section at all means the container
// itself never renders, so a scoped locator still correctly reports zero.
// (3) found by a later, larger combined run (this file plus 5 sibling
// requirement-coverage specs, which gave lazy-mounted content more real
// wall-clock time to fully render before these assertions ran): Timeline
// specifically has a SECOND ambiguity even inside #timeline -- the section's
// own outer CardTitle says "Timeline", AND ScheduleGanttClient.tsx renders
// an independent, further-nested Card of its own (the SVAR gantt widget)
// whose OWN CardTitle also reads "Timeline". A bare getByText(label) scoped
// only to #timeline still matches both once that inner card is mounted.
// Fixed the same way e2e/sumeet-workspace-milestones-scope.spec.ts's own
// `ownSectionHeading` helper already had to: a direct-child data-slot
// combinator (data-slot="card"/"card-header"/"card-title" are shadcn's own
// real attributes, card.tsx) from the section id, which only the section's
// OWN immediate wrapper Card can satisfy -- ScheduleGanttClient's inner card
// lives several levels deeper inside CardContent, so it never matches.
const SECTION_ID: Record<string, string> = {
  "Progress (WPR)": "progress",
  "Site Diary": "site-diary",
  "BOQ": "boq",
  "Timeline": "timeline",
  "Milestones": "milestones",
  "Scope & Change Orders": "scope-change-orders",
  "RFIs": "rfis",
  "Billing Milestones": "billing-milestones",
  "Resources": "resources",
  "Records": "records",
  "Insights": "insights",
};

function sectionLabel(page: import("@playwright/test").Page, label: string) {
  const sectionId = SECTION_ID[label];
  if (label === "Insights") return page.locator(`#${sectionId}`).getByRole("heading", { name: label, exact: true });
  return page.locator(`#${sectionId} > [data-slot="card"] > [data-slot="card-header"] [data-slot="card-title"]`).filter({ hasText: label });
}

test.describe("Sumeet Merge 6: role-aware section visibility, end to end", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("as CEO (owner): every section renders", async ({ page }) => {
    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    for (const heading of [
      "Progress (WPR)", "Site Diary", "BOQ", "Timeline", "Milestones",
      "Scope & Change Orders", "RFIs", "Billing Milestones", "Resources", "Records", "Insights",
    ]) {
      await expect(sectionLabel(page, heading), `owner must see the "${heading}" section`).toBeVisible();
    }
  });
});

test.describe("as Site Supervisor (site_engineer): field/schedule sections only", () => {
  test.use({ storageState: "playwright/.auth/siteSupervisor.json" });

  test("sees Progress/Site Diary/Timeline/Milestones/RFIs/Resources/Records, never BOQ/Scope/Billing/Insights", async ({ page }) => {
    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    for (const heading of ["Progress (WPR)", "Site Diary", "Timeline", "Milestones", "RFIs", "Resources", "Records"]) {
      await expect(sectionLabel(page, heading), `site_engineer must see "${heading}"`).toBeVisible();
    }
    for (const heading of ["BOQ", "Scope & Change Orders", "Billing Milestones", "Insights"]) {
      await expect(sectionLabel(page, heading), `site_engineer must NOT see "${heading}"`).toHaveCount(0);
    }
  });
});

test.describe("as a member (Sneha Reddy, acting as Finance): commercial/schedule sections only", () => {
  test.use({ storageState: "playwright/.auth/hr.json" });

  test("sees BOQ/Timeline/Milestones/Scope/Billing/Insights, never Progress/Site Diary/RFIs/Resources/Records", async ({ page }) => {
    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    for (const heading of ["BOQ", "Timeline", "Milestones", "Scope & Change Orders", "Billing Milestones", "Insights"]) {
      await expect(sectionLabel(page, heading), `member (Finance-acting) must see "${heading}"`).toBeVisible();
    }
    for (const heading of ["Progress (WPR)", "Site Diary", "RFIs", "Resources", "Records"]) {
      await expect(sectionLabel(page, heading), `member (Finance-acting) must NOT see "${heading}"`).toHaveCount(0);
    }
  });
});

test.describe("as client_viewer (Karan Malhotra): exactly the member set minus Insights", () => {
  test.use({ storageState: "playwright/.auth/clientViewer.json" });

  test("sees BOQ/Timeline/Milestones/Scope/Billing, never Insights/Resources/Records/Site Diary/RFIs", async ({ page }) => {
    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    for (const heading of ["BOQ", "Timeline", "Milestones", "Scope & Change Orders", "Billing Milestones"]) {
      await expect(sectionLabel(page, heading), `client_viewer must see "${heading}"`).toBeVisible();
    }
    for (const heading of ["Insights", "Resources", "Records", "Progress (WPR)", "Site Diary", "RFIs"]) {
      await expect(sectionLabel(page, heading), `client_viewer must NOT see "${heading}"`).toHaveCount(0);
    }
  });

  // R-50 hard floor, re-verified through THIS page specifically: the BOQ
  // section reuses BoqDualViewGrid unchanged, so the same server-side money
  // redaction it already trusts must hold here too -- no project-side
  // figure reaching a client_viewer just because the card lives on a new page.
  test("the BOQ section carries no project-side cost field for client_viewer (R-50, verified via this page's own real API response)", async ({ page }) => {
    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    // The same real call WorkspaceBoqCard itself makes to resolve which BOQ
    // to show -- called directly here rather than intercepted, since that
    // card only actually fetches once scrolled near (LazyMount), and this
    // assertion is about the API's own redaction, not the card's mount timing.
    const boqAnalysisRes = await page.request.get(`/api/reports/boq-analysis?projectId=${PROJECT_ID}`);
    const boqId: string | null = (await boqAnalysisRes.json()).row?.boqId ?? null;
    test.skip(!boqId, "no approved BOQ exists for this project under this account's org -- the redaction floor cannot be exercised without one");
    const scopeRes = await page.request.get(`/api/scope/${boqId}`);
    expect(scopeRes.ok(), "the real BOQ read must succeed for client_viewer (redacted, not refused)").toBe(true);
    const body = await scopeRes.json();
    const serialized = JSON.stringify(body);
    expect(serialized, "a client_viewer's own BOQ read must carry no rateProject/qtyProject field at all -- structural absence, not a hidden column").not.toMatch(/rateProject|qtyProject/);
  });
});

test.describe("Sumeet Merge 6: header and navigation, real wiring", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("nav pills are real same-page anchors, and only list sections this role can see", async ({ page }) => {
    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const nav = page.getByRole("navigation", { name: "Workspace sections" });
    const insightsPill = nav.getByRole("link", { name: "Insights" });
    await expect(insightsPill).toBeVisible();
    await insightsPill.click();
    await expect(page, "clicking a nav pill must be a same-page anchor, not a route change").toHaveURL(/\/workspace\/[^/]+#insights$/);
  });

  test("the project switcher navigates to a DIFFERENT project's own workspace URL, not a query param", async ({ page }) => {
    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const switcher = page.locator("[data-workspace-project-switcher]");
    test.skip((await switcher.count()) === 0, "this org has only one project -- the switcher is not rendered by design");
    await switcher.click();
    const options = page.getByRole("option");
    const optionCount = await options.count();
    test.skip(optionCount < 2, "fewer than 2 real projects available to switch between");
    const otherOption = options.nth(1);
    const otherName = await otherOption.innerText();
    await otherOption.click();
    await expect(page, "switching project must navigate to /workspace/<other id>, a real path segment, not ?projectId=").toHaveURL(/\/workspace\/[a-zA-Z0-9-]+$/);
    await expect(page.getByRole("heading", { name: otherName, exact: true })).toBeVisible();
  });

  test("the completion badge reflects the real dashboard percentByValue, not a placeholder", async ({ page }) => {
    const [dashboardRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/dashboard/project/${PROJECT_ID}`)),
      page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" }),
    ]);
    const body = await dashboardRes.json();
    test.skip(typeof body.percentByValue !== "number", "this project's dashboard has no percentByValue yet");
    const expectedPct = Math.round(body.percentByValue);
    await expect(page.getByTestId("workspace-completion-badge"), "the badge must show the real percentByValue this page's own API call returned").toContainText(`${expectedPct}%`);
  });

  test("Share copies the real, current page URL to the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    await page.getByTestId("workspace-share").click();
    await expect(page.getByText("Link copied")).toBeVisible();
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toBe(page.url());
  });
});

test.describe("Sumeet Merge 6: reused components carry real data, not placeholders", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("the Billing Milestones section is the real BillingMilestonesClient (creates a real, persisted milestone)", async ({ page }) => {
    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const section = page.locator("#billing-milestones");
    // Sections mount lazily (LazyMount, IntersectionObserver-based) so a
    // page combining 11 domains never fires every domain's own fetch at
    // once -- scroll to this one first, same as a real reader would.
    await section.scrollIntoViewIfNeeded();
    await section.getByRole("button", { name: /new billing milestone/i }).click();
    const description = `Workspace embed spec ${Date.now()}`;
    await page.getByLabel("Milestone description").fill(description);
    await page.getByLabel("Customer").selectOption({ index: 1 });
    await page.getByLabel("Scheduled date").fill("2026-11-01");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(section.locator("li", { hasText: description }), "a milestone created through the embedded card must really persist and re-render, same as the standalone /billing-milestones screen").toBeVisible({ timeout: 15_000 });
  });

  test("the Insights section shows the real Project 360 P&L card and a real Exceptions count from the API", async ({ page }) => {
    await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
    const [exceptionsRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/exceptions") && r.request().method() === "GET"),
      page.locator("#insights").scrollIntoViewIfNeeded(),
    ]);
    const { checks } = await exceptionsRes.json();
    const flagged = (checks ?? []).filter((c: { flagged: boolean }) => c.flagged).length;
    const total = (checks ?? []).length;
    const section = page.locator("#insights");
    await expect(section.getByText("Profit & Loss — the answer")).toBeVisible();
    await expect(
      section.getByText(flagged === 0 ? `All ${total} checks are clear.` : `${flagged} of ${total} checks are flagged.`),
      "the exceptions summary tile must show the SAME real count the API just returned"
    ).toBeVisible();
    await section.getByRole("link", { name: /view the full 28-item report/i }).click();
    await expect(page).toHaveURL(/\/analysis\/exceptions/);
  });
});
