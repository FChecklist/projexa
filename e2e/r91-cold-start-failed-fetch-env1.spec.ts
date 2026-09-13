import { test, expect, type Page } from "@playwright/test";

// R-91 (Error Visibility): "Cold start Failed to fetch on first submit".
// Recorded closure_state=BLOCKED, same shared root cause as the rest of the
// eleven (F-2026-0910-PM-068). file_path corrected from
// veridian-client.ts (a different, server-side-only fetch layer) to
// src/lib/use-submit.ts -- the client-side hook every create screen's submit
// now goes through (R67 D-72).
//
// ORIGINAL AUTHORSHIP: this spec's core CEO test, its network-interception
// approach, and its reasoning were written by a prior W-TEST session
// (2026-09-10, branch w-test/env1-specs-r11-15-30-31-41-42-43-82-90-91,
// commit a470343) -- moved here verbatim, not rewritten, per PM ruling D100.
// EXTENDED 2026-09-11 (W-TEST) with a second role (Finance) to meet this
// window's own "at least two roles" UI-test bar, which the original was one
// short of.
//
// Grounded directly in source: a request that never reaches the server
// (a raw browser fetch rejection -- exactly what a cold-start "Failed to
// fetch" is) is classified by failureKind() as "unreachable" (any TypeError
// that isn't an AbortError), which submitFailure() turns into a real,
// attributed sentence: "The request never reached the server — nothing was
// saved." -- never the raw, unattributed browser string "Failed to fetch"
// itself, and never a blank/silent failure.
//
// This spec simulates the cold-start condition at the network layer (the
// same class of interception Playwright's own docs recommend for testing
// client error-handling of a real fetch rejection) rather than by literally
// racing a cold server boot, which is not reproducible on demand: page.route
// aborts the real POST to /api/scope with 'failed', so the browser's fetch()
// throws a genuine TypeError the same way an unreachable server would.
//
// ROOT-CAUSED 2026-09-13 (env1 CI fix pass): the real CI failure was NOT the
// network-abort/error-attribution logic this spec is actually about -- it
// was that the Save button never became clickable at all. This spec's own
// setup only filled Title and Item Code, never Description/Qty/Rate.
// ScopeCreateClient.tsx's own missingLineFields()/createSaveLabel() (see
// CreateScreen.tsx) name a real, incomplete line on the button itself (e.g.
// "Save (Description, Qty, Rate)") AND `disabled`-gate it until those fields
// are filled -- confirmed directly in source, and already the exact
// established discipline r11-boq-create-form-subtask-fields-env1.spec.ts's
// own sibling spec follows (it fills Description/Unit/Qty/Rate before ever
// touching the Save button, with its own comment explaining the label names
// what's missing). Because this test's locator was the STRICT
// `/^save$/i` (anchored, matching ONLY the bare word "Save"), an incomplete
// line meant the locator matched zero elements -- not a slow button, a
// button that could never satisfy this pattern -- so `.click()`'s own
// actionability wait ran out its full 15s every time. Fixed by completing
// the line the same way r11's spec does, which is also what a real user
// would have to do before Save is even enabled -- the network-abort
// mechanism and the attributed-message assertions below (this spec's real
// subject) are unchanged.
//
// PIPELINE STATUS: confirmed failing for the reason above against a real
// Env-1 CI run (compliance-tracker run 34758516701 / job 103727532493,
// 2026-09-13) -- both CEO and Finance variants hit the identical 15s
// `locator.click` timeout on the same line. Fixed here; not yet re-observed
// green (see this PR's own description for the next CI run to check).
async function assertColdStartMessageAttributed(page: Page, itemCode: string) {
  await page.goto("/scope/new", { waitUntil: "networkidle" });

  await page.getByLabel("Title").fill(`R-91 env1 spec ${Date.now()}`);
  // Field selectors are ScopeCreateClient.tsx's own aria-labels, confirmed by
  // direct read. A COMPLETE line (Description/Unit/Qty/Rate), not just Item
  // Code -- see the root-cause note above for why an incomplete line means
  // the Save button this spec waits for can never appear.
  await page.getByLabel("Description, line 1").fill("R-91 spec root line");
  await page.getByLabel("Unit, line 1").fill("sqm");
  await page.getByLabel("Qty, line 1").fill("1");
  await page.getByLabel("Rate, line 1").fill("1");
  await page.getByLabel("Item code, line 1").fill(itemCode);

  // Force the real POST to fail at the network layer -- a genuine TypeError
  // from fetch(), the same shape a cold-start unreachable server produces.
  await page.route("**/api/scope", (route) => route.abort("failed"));

  const saveButton = page.getByRole("button", { name: /^save$/i });
  await expect(saveButton, "the Save primary must not still be naming a missing field once this form is filled").toHaveText("Save");
  await saveButton.click();

  // D58 falsifiability note (manual break-restore, not yet run -- this
  // pipeline is blocked on the Env-1 CI job): planting a defect means
  // temporarily removing the `kind === "unreachable"` mapping in use-submit.ts
  // (or reverting to a raw err.message passthrough), confirming this
  // assertion goes red on raw "Failed to fetch" text, then reverting.
  //
  // FIXED 2026-09-13 (env1 CI fix pass, second round): a real Env-1 CI run
  // (compliance-tracker run 34760945921 / job 103734029724) confirmed the
  // getByRole("alert") locator is genuinely ambiguous on this app -- Next.js
  // itself renders a second, always-present `<div role="alert" aria-live=
  // "assertive" id="__next-route-announcer__">` on every page (its own
  // route-change screen-reader announcer), which shares the exact role this
  // test was matching on. Playwright's own strict-mode error surfaced both
  // real elements directly. Scoped to exclude that specific, well-known
  // Next.js internal id rather than the real, attributed failure banner this
  // spec is actually about.
  const alert = page.locator('[role="alert"]:not(#__next-route-announcer__)');
  await expect(alert, "a network-level failure must surface a real, attributed failure region, not silence").toBeVisible({ timeout: 15_000 });
  const message = (await alert.textContent()) ?? "";
  expect(message, "the user must see use-submit.ts's real, attributed 'unreachable' sentence").toMatch(/request never reached the server/i);
  expect(message, "the raw, unattributed browser string must never reach the user directly").not.toMatch(/failed to fetch/i);
}

test.describe("R-91: a fetch that never reaches the server shows a real, attributed message -- CEO", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("as CEO (owner role): a real, attributed message replaces raw browser noise", async ({ page }) => {
    await assertColdStartMessageAttributed(page, "R91-CEO-ROOT");
  });
});

test.describe("R-91: a fetch that never reaches the server shows a real, attributed message -- Finance", () => {
  test.use({ storageState: "playwright/.auth/finance.json" });

  test("as Finance (member role): the same real, attributed message replaces raw browser noise for a non-owner account", async ({ page }) => {
    await assertColdStartMessageAttributed(page, "R91-FIN-ROOT");
  });
});
