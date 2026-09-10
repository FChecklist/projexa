import { test, expect } from "@playwright/test";

// R-23 (Revisions): "Reducing qty on a line WITH progress is BLOCKED"
// (file_path: createBoqRevision) AND R-C13 (Scope/Variations): "Negative
// variation must be checked against WPR in case work is already done"
// (file_path: createBoqRevision 409 scope reduction). Deliberately ONE spec
// for both ids, not two near-identical files: R-C13's own DB status text
// says it "CONFIRMS R-22/R-23" -- it is the same guard, the same trigger
// (a quantity reduction on an already-progressed line), verified by direct
// read of createBoqRevision()'s single scope-reduction check. Splitting this
// into two files would manufacture the exact near-duplicate citation the
// scorecard's own c5 gate exists to catch (same reasoning already applied to
// R-01+R-02 sharing one file, and to NOT splitting R-B1/R-B2).
//
// R-C13's EXISTING evidence (construction-boq-service.test.ts, describe
// block ~line 1261) is real and already break-restore-observed (PR #1667,
// RED 34497162055 / GREEN 34498067557) but calls createBoqRevision()
// DIRECTLY against an in-memory fakeDb -- confirmed by direct read of the
// test file's own header comment. That satisfies conditions 2 and 3 at the
// SERVICE layer only; it is not a real user action and not Env-1 (condition
// 1 and 4 both fail). This spec supplies those two, against a real BOQ this
// spec creates itself (a live check this window found zero existing
// progressed line items anywhere in the Meridian E2E org to point at
// instead).
//
// EXIT CONDITIONS:
//  1. Real user action: real BOQ + real progress entry via real authenticated
//     API calls, then a real quantity reduction through the real revise form.
//  2. Asserts the real refusal + the real conflicts[] row for this line.
//  3. BREAK-RESTORE: NOT YET OBSERVED BY THIS SESSION for the ROUTE/Env-1
//     layer (R-C13's SERVICE-layer cycle above is real but does not count for
//     this spec's own condition 4). Same RAM/CI blocker as R-22's spec (see
//     its header) -- 0.62GB free RAM at write time, D72 forbids a local boot,
//     no Env-1 CI job exists yet. Plant/revert procedure is IDENTICAL to
//     R-22's spec (same single guard, same file): change
//     `violations.length > 0` to `violations.length > Number.MAX_SAFE_INTEGER`
//     in createBoqRevision(), confirm this spec goes red (no 409), then
//     `git revert --no-edit <plant-sha>` and confirm green again.
//  4. Runs against Env-1 -- blocked from actually running until the CI job
//     exists, same as condition 3.
test.use({ storageState: "playwright/.auth/ceo.json" });

// Same real project as R-22's spec.
const PROJECT_ID = "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04";

test("R-23 / R-C13: reducing the quantity of a progressed BOQ line is blocked, against a real project", async ({ page }) => {
  const boqTitle = `R-23-C13 env1 spec ${Date.now()}`;
  const createRes = await page.request.post("/api/scope", {
    data: {
      projectId: PROJECT_ID,
      title: boqTitle,
      lineItems: [
        { itemCode: "R23C13-PROGRESSED", description: "R-23/R-C13 spec: line with real recorded progress", unit: "sqm", quantity: 100, rate: 50 },
      ],
    },
  });
  expect(createRes.ok(), "BOQ creation must succeed for this spec's own setup").toBe(true);
  const created = await createRes.json();
  const boqId: string = created.id;
  const progressedLine = (created.lineItems as Array<{ id: string; itemCode: string }>).find((l) => l.itemCode === "R23C13-PROGRESSED");
  expect(progressedLine, "the progressed line must come back from the real create response, not be assumed").toBeTruthy();

  const progressRes = await page.request.post("/api/work-progress", {
    data: {
      projectId: PROJECT_ID,
      boqId,
      boqLineItemId: progressedLine!.id,
      entryDate: new Date().toISOString().slice(0, 10),
      quantityDone: 45,
      percentComplete: 45,
      entryBasis: "DELTA",
    },
  });
  expect(progressRes.ok(), "logging real progress must succeed for this spec's own setup").toBe(true);

  // The real user action under test: cut this line's quantity from 100 to
  // 60 -- a real negative variation (-40 qty) on a line already 45% done.
  await page.goto(`/scope/${boqId}/revise`, { waitUntil: "networkidle" });
  await page.getByLabel("Line 1 Qty").fill("60");
  await page.getByRole("button", { name: /^save$/i }).click();

  const scopeBlock = page.locator("p.text-px-error").first();
  await expect(scopeBlock, "a real scope-reduction refusal must be shown, not a silent success").toBeVisible({ timeout: 15_000 });
  const bodyText = await page.locator("body").innerText();
  expect(bodyText, "the conflicts table must name the exact real line this spec progressed").toContain("R23C13-PROGRESSED");
});
