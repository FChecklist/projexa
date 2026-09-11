import { test, expect } from "@playwright/test";

// R-22 (Revisions): "Removing a line WITH progress is BLOCKED". Recorded
// file_path: createBoqRevision 409 scope reduction. Same underlying guard as
// R-23/R-C13 (compliance-tracker src/lib/services/construction-boq-service.ts,
// createBoqRevision's scope-reduction check, findScopeReductionViolations).
//
// EXIT CONDITIONS (per PM task, this window):
//  1. REAL USER ACTION: this spec creates its own real BOQ + real progress
//     entry via real authenticated API calls (page.request, same session
//     cookies as `page` -- not a fixture, not seeded out-of-band), then
//     removes that progressed line through the REAL revise form
//     (ScopeReviseClient.tsx's own "Remove" button) and clicks the real
//     Save button. Necessary because a live check this window (SQL against
//     compliance.construction_work_progress_entries, Meridian E2E org) found
//     ZERO existing line items with recorded progress anywhere in this org --
//     there is no pre-existing real data to point at, so this spec makes its
//     own, through the real API surface a user's own click would hit.
//  2. Asserts the guard FIRES with a real, specific reason (the actual
//     scopeBlock message + the real conflicts[] row naming this exact line),
//     not just a computed value.
//  3. BREAK-RESTORE: NOT YET OBSERVED BY THIS SESSION. Machine RAM was 0.62GB
//     free of 7.82GB when this was written -- D72 forbids a local dev-server
//     boot under that condition, and no Env-1 CI job exists yet to run this
//     in. Exact plant/revert procedure documented below so the next session
//     (or CI, once it exists) can execute it without re-deriving it:
//       PLANT: in createBoqRevision() (construction-boq-service.ts), change
//       the scope-reduction guard's condition from `violations.length > 0` to
//       `violations.length > Number.MAX_SAFE_INTEGER` (the exact plant PR
//       #1667 already used for R-C13's service-level test) -- expect this
//       spec's assertions below to fail (no 409, no scopeBlock text).
//       REVERT: `git revert --no-edit <plant-sha>` -- expect this spec to
//       pass again, unchanged.
//  4. Runs against Env-1 (localhost), a real browser, real HTTP, real
//     Postgres -- not a mock. (Blocked from actually running until the Env-1
//     CI job exists -- see condition 3.)
test.use({ storageState: "playwright/.auth/ceo.json" });

// A real project in the Meridian E2E org, confirmed live 2026-09-10 to exist
// and belong to org_id=4ecc472f-4152-4310-ae8d-cf8b7c52ab6d (same project
// R-41/42/43's specs use).
const PROJECT_ID = "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04";

test("R-22: removing a BOQ line already recorded as progressed on site is blocked, against a real project", async ({ page }) => {
  // Setup: create a real BOQ with two lines (the second exists only so
  // removing the first does not hit BoqLineGrid's own "last line" disable
  // guard, which is a separate, correct piece of UX, not the thing under
  // test here).
  const boqTitle = `R-22 env1 spec ${Date.now()}`;
  const createRes = await page.request.post("/api/scope", {
    data: {
      projectId: PROJECT_ID,
      title: boqTitle,
      lineItems: [
        { itemCode: "R22-PROGRESSED", description: "R-22 spec: line with real recorded progress", unit: "sqm", quantity: 100, rate: 50 },
        { itemCode: "R22-KEEP", description: "R-22 spec: untouched line", unit: "sqm", quantity: 20, rate: 10 },
      ],
    },
  });
  expect(createRes.ok(), "BOQ creation must succeed for this spec's own setup").toBe(true);
  const created = await createRes.json();
  const boqId: string = created.id;
  const progressedLine = (created.lineItems as Array<{ id: string; itemCode: string }>).find((l) => l.itemCode === "R22-PROGRESSED");
  expect(progressedLine, "the progressed line must come back from the real create response, not be assumed").toBeTruthy();

  // REAL BUG FOUND AND FIXED IN THIS TEST (not the product), 2026-09-11:
  // this spec originally posted {projectId, boqId, boqLineItemId, ...}
  // WITHOUT activityId, on the assumption (never actually run until now)
  // that boqId alone was sufficient -- r41-r42-r43's spec had already
  // flagged this exact ambiguity by name (its own "PAYLOAD AMBIGUITY" note,
  // citing this file's old shape as one of two candidate payloads) but
  // could not settle it from source alone. A real run against Env-1 settled
  // it: POST /api/work-progress without activityId returns a real 400,
  // {"error":"activityId is required","code":null} -- confirmed by a
  // temporary debug log of the real response body, removed after diagnosis.
  // Fixed the same way r41-r42-r43 already does: create a real activity
  // first and send both activityId and boqId.
  const activityRes = await page.request.post("/api/work-progress/activities", {
    data: { projectId: PROJECT_ID, name: `R22 spec activity ${Date.now()}` },
  });
  expect(activityRes.ok(), "activity creation must succeed for this spec's own setup").toBe(true);
  const activityBody = await activityRes.json();
  const activityId: string | undefined = activityBody.id ?? activityBody.activity?.id;
  expect(activityId, "the real activity id must come back from the create response").toBeTruthy();

  // Real progress entry against that exact line, through the real API a
  // Daily Entry form submission hits.
  const progressRes = await page.request.post("/api/work-progress", {
    data: {
      projectId: PROJECT_ID,
      boqId,
      boqLineItemId: progressedLine!.id,
      activityId,
      entryDate: new Date().toISOString().slice(0, 10),
      quantityDone: 40,
      percentComplete: 40,
      entryBasis: "DELTA",
    },
  });
  expect(progressRes.ok(), "logging real progress must succeed for this spec's own setup").toBe(true);

  // The real user action under test: remove the progressed line from a
  // revision and try to save. BoqLineGrid.tsx renders each line as a <div>
  // row (not a <table>), so rows are addressed by their own real aria-labels
  // ("Line N Item Code" etc.), confirmed by direct read, rather than a <tr>
  // selector. Line 1 is verified to actually be the progressed line (created
  // first in this spec's own setup payload above) before removing it, rather
  // than assumed from array order alone.
  await page.goto(`/scope/${boqId}/revise`, { waitUntil: "networkidle" });
  await expect(page.getByLabel("Line 1 Item Code"), "line 1 must really be the progressed line before this spec removes it").toHaveValue("R22-PROGRESSED");
  await page.getByRole("button", { name: /^remove$/i }).first().click();
  await page.getByRole("button", { name: /^save$/i }).click();

  // Condition 2: the guard's real, specific refusal.
  const scopeBlock = page.locator("p.text-px-error").first();
  await expect(scopeBlock, "a real scope-reduction refusal must be shown, not a silent success").toBeVisible({ timeout: 15_000 });
  const bodyText = await page.locator("body").innerText();
  expect(bodyText, "the conflicts table must name the exact real line this spec progressed").toContain("R22-PROGRESSED");
});
