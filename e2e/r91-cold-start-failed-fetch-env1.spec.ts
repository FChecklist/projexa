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
// PIPELINE STATUS: NOT YET GREEN IN CI (same Env-1 CI job dependency as the
// rest of the eleven) NOR observed green locally -- not re-attempted this
// pass for the same real, independently-confirmed RAM/CPU contention
// documented in R-11/R-60's own status notes (real backend calls measured
// at 8-36s under load this session). Logic grounded in source, not run.
async function assertColdStartMessageAttributed(page: Page, itemCode: string) {
  await page.goto("/scope/new", { waitUntil: "networkidle" });

  await page.getByLabel("Title").fill(`R-91 env1 spec ${Date.now()}`);
  // Field selector is ScopeCreateClient.tsx's own aria-label ("Item code,
  // line N"), confirmed by direct read.
  await page.getByLabel("Item code, line 1").fill(itemCode);

  // Force the real POST to fail at the network layer -- a genuine TypeError
  // from fetch(), the same shape a cold-start unreachable server produces.
  await page.route("**/api/scope", (route) => route.abort("failed"));

  await page.getByRole("button", { name: /^save$/i }).click();

  // D58 falsifiability note (manual break-restore, not yet run -- this
  // pipeline is blocked on the Env-1 CI job): planting a defect means
  // temporarily removing the `kind === "unreachable"` mapping in use-submit.ts
  // (or reverting to a raw err.message passthrough), confirming this
  // assertion goes red on raw "Failed to fetch" text, then reverting.
  const alert = page.getByRole("alert");
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
