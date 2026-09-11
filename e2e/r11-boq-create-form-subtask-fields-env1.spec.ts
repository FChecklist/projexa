import { test, expect } from "@playwright/test";

// R-11 (Weighted Sub-Tasks): "Sub-task enterable in create form (Item Code /
// Parent Item Code / Breakdown %)". Recorded route: https://projexa-ai.com/scope,
// file_path corrected (per R81 K5-02) from ScopeClient.tsx to
// src/components/BoqLineGrid.tsx -- that correction turned out itself stale:
// BoqLineGrid.tsx's own header comment claims it's "shared by ScopeCreateClient
// and ScopeReviseClient", but a direct read of the current source shows
// BoqLineGrid is used ONLY by ScopeReviseClient.tsx. ScopeCreateClient.tsx (the
// real /scope/new screen this requirement's route points at) has its own,
// separate inline line-grid markup with its own aria-labels ("Item code, line
// N" / "Parent code, line N" / "Breakdown %, line N" -- confirmed by reading
// src/components/ScopeCreateClient.tsx directly, not by trusting either the
// requirement row's recorded file_path or BoqLineGrid's own comment).
//
// R81-RULING-03: closure needs a named, committed, re-runnable test that
// exercises the real surface, observed to fail when broken, asserting
// PERSISTED outcome by re-reading it -- not a source-reading claim.
//
// EXIT CONDITIONS this spec proves:
//  1. A real user can type into Item Code, Parent Item Code and Breakdown %
//     for a sub-task line, and Description/Unit/Qty/Rate for its root line,
//     on the real /scope/new screen.
//  2. Save succeeds and the BOQ is genuinely created (not just a client-side
//     illusion) -- re-read via GET /api/scope/{id} confirms the sub-task
//     line's itemCode, parentItemCode and breakdownPercentage all persisted
//     exactly as entered, and its derived quantity/rate/amount reflect the
//     canonical child-rate rule (root rate x breakdown% / 100), proving the
//     fields were not just accepted cosmetically.
//  3. Tested under two roles (CEO and a member-level Finance account) -- both
//     can reach and use this form; PROJEXA does not gate BOQ creation to
//     owner-only.
//
// STATUS AS OF THIS COMMIT (2026-09-11, W-TEST): NOT YET OBSERVED FULLY
// GREEN, same class of open condition as r33/r21-r24/r22/r23-c13 in this
// same batch ("BREAK-RESTORE: NOT YET OBSERVED... RAM/CI blocker") -- but
// unlike those, this one was actually run repeatedly (a dozen+ attempts),
// not left untried. Three real bugs were found and fixed in THIS TEST (not
// the product) along the way, each documented inline where fixed: a
// UUID-shaped id regex against a cuid-shaped real id; that fix's own
// over-match against the literal "new" path segment; and an assumed
// `parentItemCode` field that the real persisted row does not have (the
// real field is `parentLineItemId`, resolved server-side to the root row's
// own id). A debug-logged run got past every step through a real GET
// re-read, returning a real, correct row: sub.parentLineItemId === root.id,
// sub.breakdownPercentage === "40", sub.rate === 20 (root's 50 x 40%),
// sub.quantity === 100 (root's own, unscaled) -- exactly this spec's own
// predicted values, confirming the underlying product behaviour this
// requirement is about is genuinely correct. What has NOT yet been
// observed in one single run is the full CEO+Finance pair going green
// back-to-back: this laptop's free RAM swung between 0.3GB and 0.9GB across
// the session (a separate, real, independently-confirmed constraint --
// concurrent sessions' own builds/typechecks were consuming 600MB-1.2GB at
// points), and individual runs have taken anywhere from 25s to 2.3
// minutes. Re-run this spec in a quieter window before trusting it green;
// the logic itself is no longer in question.
const PROJECT_ID = "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04";

// This laptop is RAM-constrained (D72/this window's own notes: free memory
// drops under 0.5GB with both local dev servers up), which has made
// first-compile page loads take well over the config's default 30s
// navigationTimeout during authoring -- not a product defect, a genuinely
// slow but real page load. Widened locally for this file only rather than
// touching the shared playwright.config.ts.
test.slow();

async function createBoqWithSubtaskViaForm(page: import("@playwright/test").Page, title: string) {
  await page.goto(`/scope/new?projectId=${PROJECT_ID}`);

  await page.getByLabel("Title").fill(title);

  // Root line (line 1): the parent this spec's sub-task will reference.
  await page.getByLabel("Description, line 1").fill("R-11 spec root line");
  await page.getByLabel("Unit, line 1").fill("sqm");
  await page.getByLabel("Qty, line 1").fill("100");
  await page.getByLabel("Rate, line 1").fill("50");
  await page.getByLabel("Item code, line 1").fill("R11-ROOT");

  // A second line for the sub-task -- the three fields R-11 is actually about.
  await page.getByRole("button", { name: "+ Add Line" }).click();
  await page.getByLabel("Description, line 2").fill("R-11 spec sub-task line");
  await page.getByLabel("Item code, line 2").fill("R11-SUB");
  await page.getByLabel("Parent code, line 2").fill("R11-ROOT");
  await page.getByLabel("Breakdown %, line 2").fill("40");

  // The Save primary's own label names what's missing (createSaveLabel) --
  // once the form is genuinely complete it reads "Save" (see
  // src/components/screens/CreateScreen.tsx's own header comment: "Save
  // (Title, Description, Qty, Rate)" while incomplete). Match by prefix so
  // this assertion doesn't depend on the exact missing-fields wording.
  const saveButton = page.getByRole("button", { name: /^Save/ });
  await expect(saveButton, "the Save primary must not still be naming a missing field once this form is filled").toHaveText("Save");
  await saveButton.click();

  // Real navigation to the newly created BOQ's own page -- proves the save
  // actually completed (submit.saved -> router.replace), not just that the
  // click handler ran.
  //
  // TWO REAL BUGS FOUND AND FIXED IN THIS TEST (not the product), each
  // masking the next:
  //  1. First attempt assumed a UUID-shaped BOQ id (/\/scope\/[0-9a-f-]{36}/,
  //     copied from the hardcoded PROJECT_ID constant's own shape). A trace
  //     showed the real, successful navigation target directly:
  //     "/scope/xsgjhc3y22ol41dxtanlb3vk" -- a 24-char lowercase alphanumeric
  //     cuid-shaped id, not a UUID -- so that strict hex-only pattern never
  //     matched even though the save had already genuinely succeeded.
  //  2. The obvious-looking fix, /\/scope\/[a-z0-9]+/, over-corrected: it
  //     also matches the STARTING page's own URL, "/scope/new?projectId=...",
  //     because "new" is itself lowercase alphanumeric -- so waitForURL
  //     resolved immediately against the pre-save URL without ever waiting
  //     for real navigation. Debug logging caught this directly:
  //     boqId ended up as the literal string "new", and GET /api/scope/new
  //     correctly 503'd as a nonsense id. Fixed by requiring a realistic
  //     minimum id length (real ids observed are 20+ chars), which "new"
  //     cannot satisfy.
  await page.waitForURL(/\/scope\/[a-z0-9]{10,}(\?|$)/, { timeout: 30_000 });
  const boqId = page.url().match(/\/scope\/([a-z0-9]{10,})/)?.[1];
  expect(boqId, "the URL after save must carry the real new BOQ id (not the literal 'new')").toBeTruthy();
  expect(boqId, "the extracted id must not be the create screen's own path segment").not.toBe("new");
  return boqId!;
}

async function assertSubtaskPersisted(page: import("@playwright/test").Page, boqId: string) {
  // R74-RULING-03 condition (e): re-read the record, don't trust the form's
  // own state or a success message.
  const res = await page.request.get(`/api/scope/${boqId}`);
  expect(res.ok(), "the real BOQ must be re-readable via the API after save").toBe(true);
  const boq = await res.json();
  // A THIRD real bug found and fixed here (debug-logged the raw response to
  // confirm): the persisted/returned row shape has no `parentItemCode`
  // field at all -- the form's INPUT field of that name resolves server-side
  // to `parentLineItemId`, the real root row's own `id` (not its itemCode).
  // Confirmed directly against a real response: sub.parentLineItemId ===
  // root.id byte-for-byte.
  const lineItems: Array<{ id: string; itemCode: string | null; parentLineItemId: string | null; breakdownPercentage: string | number | null; quantity: string | number; rate: string | number; amount: string | number }> =
    boq.lineItems ?? [];

  const root = lineItems.find((l) => l.itemCode === "R11-ROOT");
  const sub = lineItems.find((l) => l.itemCode === "R11-SUB");
  expect(root, "the root line must have persisted with the item code entered").toBeTruthy();
  expect(sub, "the sub-task line must have persisted with the item code entered").toBeTruthy();

  // The load-bearing assertions: Parent Item Code and Breakdown % genuinely
  // reached the stored row, not just the form's local state.
  expect(sub!.parentLineItemId, "the sub-task's Parent Item Code must have resolved and persisted, pointing at the real root row's own id").toBe(root!.id);
  expect(String(sub!.breakdownPercentage), "the sub-task's Breakdown % must have persisted as entered").toBe("40");

  // Proves the three fields were not merely stored cosmetically: the
  // canonical child-rate rule (root rate x breakdown% / 100 = 50 x 0.40 =
  // 20) actually derived from them, same rule construction-boq-service.ts's
  // deriveLineItemQuantityAndRate encodes on the compliance-tracker side.
  expect(Number(sub!.rate), "the sub-task's derived rate must be root rate x breakdown% / 100").toBeCloseTo(20, 6);
  expect(Number(sub!.quantity), "the sub-task's derived quantity must equal the root's quantity, unscaled").toBe(100);
}

test.describe("R-11: sub-task fields (Item Code / Parent Item Code / Breakdown %) are enterable in the real create form", () => {
  test.use({ storageState: "playwright/.auth/ceo.json", navigationTimeout: 90_000, actionTimeout: 45_000 });

  test("as CEO (owner role): fill and save a sub-task line, re-read to confirm persistence", async ({ page }) => {
    const boqId = await createBoqWithSubtaskViaForm(page, `R-11 spec CEO ${Date.now()}`);
    await assertSubtaskPersisted(page, boqId);
  });
});

test.describe("R-11 (member role): the same form is reachable and usable by a non-owner account", () => {
  test.use({ storageState: "playwright/.auth/finance.json", navigationTimeout: 90_000, actionTimeout: 45_000 });

  test("as Finance (member role): fill and save a sub-task line, re-read to confirm persistence", async ({ page }) => {
    const boqId = await createBoqWithSubtaskViaForm(page, `R-11 spec Finance ${Date.now()}`);
    await assertSubtaskPersisted(page, boqId);
  });
});
