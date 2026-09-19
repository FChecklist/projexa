import { test, expect, type Page } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";

// Owner directive "Merge 6" (2026-09-19): /workspace/[id]'s Progress section
// (src/components/ProjectWorkspaceClient.tsx, id="progress") embeds the REAL
// WorkProgressReportClient unchanged, passed the new `embedded` boolean prop
// (skips syncing filter state to the URL -- see that component's own header
// comment on why: its normal "the URL is the state" behaviour would
// router.replace/push the WHOLE workspace page away to /work-progress on
// first mount otherwise).
//
// This spec's job, per the assignment that produced it, is NOT to re-derive
// whether the WPR's underlying business logic is correct -- every requirement
// below was already CLOSED against the WPR's own standalone /work-progress
// page (PRs #287-290). It is to verify that EMBEDDING the report inside the
// new workspace page didn't break anything observable, and to say plainly,
// rather than fake, what this embed genuinely cannot newly exercise.
//
// Requirement-by-requirement disposition for the 11 ids this spec owns:
//
//   NEWLY EXERCISED, through this page, by a real test below:
//     R-41 (Previous/Current/Total % columns)
//     R-42 (Previous/Current/Total Qty columns)
//     R-43 (Cum/Current/Balance Amt columns -- rendered here as the same
//           Previous/Current/Total(-or-Balance) Amount band; "Balance" is a
//           user-selectable third-column mode, not a fourth column)
//     R-51 (dashboard completion badge reflects the real percentByValue)
//
//   NOT NEWLY EXERCISED -- declared here, not faked:
//     R-40 (record partial progress against a weighted sub-task)
//     R-46 (progress recorded twice keeps history, no double count)
//     R-47 (progress above 100% rejected or capped)
//       Reason: recording a progress entry happens on WorkProgressFormClient,
//       mounted only inside WorkProgressPageClient, which is the "Daily
//       Entry" tab of the STANDALONE /work-progress page
//       (src/app/(app)/work-progress/[id]/page.tsx). ProjectWorkspaceClient.tsx
//       imports and embeds ONLY WorkProgressReportClient (the read-only
//       Report tab's own component) inside #progress -- confirmed by reading
//       its import list directly, `WorkProgressFormClient`/
//       `WorkProgressPageClient` appear nowhere in that file. There is no
//       entry-recording control reachable from /workspace/[id] at all, so
//       R-40/R-46/R-47 cannot be newly exercised through this page. The test
//       below ("entry recording is not reachable...") makes this an
//       executable, re-checkable fact instead of a comment that can go stale.
//
//     R-44 (parent cum qty = SUM(child cum qty x breakdown %))
//     R-45 (parent % complete = cum amount / total amount)
//       Reason: pure aggregation math inside src/lib/work-progress-report.ts,
//       already unit-tested there (work-progress-report.test.ts) and exercised
//       by the exact same ScopeTable/computeGrandTotal render path on the
//       standalone /work-progress page's own Report tab -- this embed changes
//       WHERE that component mounts, not what it computes. Nothing about
//       embedding can newly break arithmetic that is identical code either way.
//
//     R-48 (daily progress report with photos)
//       Reason: photo capture/attachment is a Daily Entry (WorkProgressFormClient)
//       concern, same reachability gap as R-40/46/47 above.
//
//     R-52 (only the LATEST revision is counted)
//       Reason: BOQ-version resolution ("availableBoqs", auto-pick of the
//       latest non-superseded BOQ) is server-side report computation, unit-
//       and route-tested independently of which page mounts the component.
//
// GAP FOUND while authoring this spec: WorkProgressReportClient's own
// "Third column" <Select> (data-testid="third-column-mode") renders its
// currently-selected option's label ("Total") inside the SelectTrigger via
// SelectValue -- an UNSCOPED getByText("Total", { exact: true }) inside
// #progress therefore matches both that trigger and the 3 real table header
// cells (4 matches, not 3). Scoping to the table's own <thead> (a real
// semantic element -- src/components/ui/table.tsx renders TableHeader as a
// plain <thead>) resolves it, the same class of trap the existing
// sumeet-project-workspace-env1.spec.ts documents for CardTitle/nav-pill text.

const PROJECT_ID = DEFAULT_PROJECT.id;

async function openProgressSection(page: Page) {
  await page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" });
  const section = page.locator("#progress");
  // Sections mount lazily (LazyMount, IntersectionObserver-based).
  await section.scrollIntoViewIfNeeded();
  await expect(
    section.getByTestId("wpr-caption"),
    "the embedded report must actually auto-run inside the workspace page, the same as it does on its own standalone /work-progress route"
  ).toBeVisible({ timeout: 20_000 });
  return section;
}

/**
 * R-41/R-42/R-43: the real Previous/Current/Total(-or-Balance) columns across
 * the Percent, Quantity and Amount bands, with real (non-placeholder) figures
 * -- verified against the ACTUAL rendered ScopeTable, scoped to this page's
 * embedded instance rather than the standalone /work-progress page's own copy
 * of the same component.
 */
async function assertEmbeddedColumnsShowRealData(page: Page) {
  const section = await openProgressSection(page);

  const noBoq = section.getByText("No BoQ line items for this project yet.", { exact: true });
  test.skip(
    (await noBoq.count()) > 0,
    "this project has no approved BOQ lines for the WPR to report against -- the column structure cannot be exercised without one"
  );

  // Scoped to <thead> specifically -- see the GAP FOUND note above the file's
  // own header comment for why an unscoped match over-counts "Total".
  const headerRow = section.locator("thead");
  await expect(headerRow.getByText("Previous", { exact: true }), "R-41/R-42/R-43: one Previous column per band (Percent, Quantity, Amount)").toHaveCount(3);
  await expect(headerRow.getByText("Current", { exact: true }), "R-41/R-42/R-43: one Current column per band").toHaveCount(3);
  // Default thirdColumnMode is "total", so the third column reads "Total" in
  // all three bands until the reader switches to Balance.
  await expect(headerRow.getByText("Total", { exact: true }), "R-41/R-42/R-43: the third column, defaulted to Total, once per band").toHaveCount(3);
  await expect(headerRow.getByText("PO Qty", { exact: true })).toBeVisible();
  await expect(headerRow.getByText("Rate", { exact: true })).toBeVisible();

  // amt-total (Rate x PO Qty) is NEVER touched-gated -- it always renders a
  // real computed figure regardless of whether any progress entry exists in
  // the window, so it is a safe, always-present proof the embed is passing
  // real row data through, not an empty/placeholder shell.
  const amtTotalTexts = await section.getByTestId("amt-total").allTextContents();
  expect(amtTotalTexts.length, "at least one BOQ line must render").toBeGreaterThan(0);
  expect(amtTotalTexts.some((t) => /\d/.test(t)), "the Amt column must show a real computed number, not a placeholder").toBe(true);

  const noProgress = section.getByTestId("wpr-no-progress");
  test.skip(
    (await noProgress.count()) > 0,
    "no progress entries fall inside this report's auto-resolved window -- the Previous/Current/Total cells are legitimately blank here, not broken"
  );

  // At least one real, non-placeholder value in each Previous/Current/Total
  // cell family, across percent, quantity and amount -- proving the embed
  // carries real recorded progress through, not just the static BOQ shell
  // checked above.
  for (const testId of ["pct-prev", "pct-current", "pct-third", "qty-prev", "qty-current", "qty-third", "amt-prev", "amt-current", "amt-third"]) {
    const texts = await section.getByTestId(testId).allTextContents();
    expect(texts.some((t) => /\d/.test(t)), `expected at least one real, non-placeholder value in the "${testId}" column`).toBe(true);
  }
}

test.describe("Merge 6: embedded WPR shows real Previous/Current/Total columns, as owner (R-41/R-42/R-43)", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("owner sees the real % / Qty / Amt bands with real figures inside #progress", async ({ page }) => {
    await assertEmbeddedColumnsShowRealData(page);
  });
});

test.describe("Merge 6: embedded WPR shows real Previous/Current/Total columns, as site_engineer (R-41/R-42/R-43)", () => {
  test.use({ storageState: "playwright/.auth/siteSupervisor.json" });

  test("site_engineer sees the real % / Qty / Amt bands with real figures inside #progress", async ({ page }) => {
    await assertEmbeddedColumnsShowRealData(page);
  });
});

test.describe("Merge 6: entry recording is NOT reachable through the embedded Progress section (R-40/R-46/R-47 stay on /work-progress's Daily Entry tab)", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("the embedded card exposes only the 4 read-only report tabs, never a Daily Entry / record-progress control", async ({ page }) => {
    const section = await openProgressSection(page);

    for (const name of ["Scope-wise", "Category-wise", "Manpower-wise", "Vendor-wise"]) {
      await expect(section.getByRole("tab", { name, exact: true }), `the embed must still expose the real "${name}" report tab`).toBeVisible();
    }
    await expect(section.getByRole("tab")).toHaveCount(4);
    // The genuine negative: no Daily Entry tab, and no visible control to
    // create/record a progress entry, exists anywhere inside this section.
    await expect(section.getByRole("tab", { name: /daily entry/i }), "R-40/R-46/R-47's entry-recording UI must not be reachable from the workspace embed").toHaveCount(0);
    await expect(section.getByRole("button", { name: /record progress|new entry|add entry/i }), "no entry-recording control should exist inside the embedded report card").toHaveCount(0);
  });
});

test.describe("Merge 6: embedded WPR's own filter state survives the embed=true URL-sync fix", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("clicking a period-preset chip inside the embed updates the report's own state without navigating the host page off /workspace/<id>", async ({ page }) => {
    const section = await openProgressSection(page);

    const thisMonthChip = section.getByTestId("wpr-period-this-month");
    await thisMonthChip.click();

    // The report must re-run under the new period (its own internal state,
    // independent of the URL) -- the period line names the preset in words.
    await expect(
      section.getByTestId("wpr-period-line"),
      "the report's own internal filter state must still update on a period-chip click, even though `embedded` suppresses the URL write"
    ).toContainText("this month");
    await expect(thisMonthChip, "the clicked chip must show as active").toHaveAttribute("aria-pressed", "true");

    // The fix under test: writeParamsToUrl() becomes a no-op when embedded is
    // true (see WorkProgressReportClient.tsx's own comment on `embedded`) --
    // before this prop existed, this exact click would have router.replace'd
    // the WHOLE workspace page away to /work-progress?...
    await expect(
      page,
      "the embed must never navigate the host page to /work-progress -- that was the bug `embedded` was added to fix"
    ).toHaveURL(new RegExp(`/workspace/${PROJECT_ID}$`));
  });
});

test.describe("Merge 6: the header completion badge reflects the real dashboard percentByValue (R-51)", () => {
  test.use({ storageState: "playwright/.auth/siteSupervisor.json" });

  // The existing sumeet-project-workspace-env1.spec.ts already covers this
  // exact call as owner ("the completion badge reflects the real dashboard
  // percentByValue, not a placeholder"). This is a deliberately independent
  // build of the same real check -- a different role (site_engineer, who can
  // also see Progress per workspace-visibility.ts), and it additionally
  // pins the exact rendered wording ("N% complete"), not just that the
  // digits are present.
  test("site_engineer's completion badge shows the exact percentByValue this page's own API call returned", async ({ page }) => {
    const [dashboardRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/dashboard/project/${PROJECT_ID}`)),
      page.goto(`/workspace/${PROJECT_ID}`, { waitUntil: "networkidle" }),
    ]);
    const body = await dashboardRes.json();
    test.skip(typeof body.percentByValue !== "number", "this project's dashboard has no percentByValue yet");
    const expectedPct = Math.round(body.percentByValue);
    await expect(
      page.getByTestId("workspace-completion-badge"),
      "the badge's exact text must be the real, rounded percentByValue this page's own API call returned, worded as ProjectWorkspaceClient.tsx renders it"
    ).toHaveText(`${expectedPct}% complete`);
  });
});
