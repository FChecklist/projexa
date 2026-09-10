import { test, expect } from "@playwright/test";

// R-91 (Error Visibility): "Cold start Failed to fetch on first submit".
// Recorded closure_state=BLOCKED, same shared root cause as the rest of the
// eleven (F-2026-0910-PM-068). file_path corrected from
// veridian-client.ts (a different, server-side-only fetch layer) to
// src/lib/use-submit.ts -- the client-side hook every create screen's submit
// now goes through (R67 D-72).
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
// PIPELINE STATUS AS OF THIS COMMIT: NOT YET GREEN IN CI -- same Env-1 CI job
// dependency as the rest of the eleven.
test.use({ storageState: "playwright/.auth/ceo.json" });

test("R-91: a fetch that never reaches the server shows a real, attributed message, not raw browser noise", async ({ page }) => {
  await page.goto("/scope/new", { waitUntil: "networkidle" });

  await page.getByLabel("Title").fill(`R-91 env1 spec ${Date.now()}`);
  // Field selector is ScopeCreateClient.tsx's own aria-label ("Item code,
  // line N"), confirmed by direct read.
  await page.getByLabel("Item code, line 1").fill("R91-ROOT");

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
});
