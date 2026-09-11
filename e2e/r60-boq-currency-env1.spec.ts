import { test, expect } from "@playwright/test";

// R-60 (Master v5 B-4 / TC-90): "BOQ amounts show AED not rupee". Recorded
// closure_state=BLOCKED with next_action (platform.sumeet_requirements,
// R81 K5-02): "An independent source audit found this requirement fully
// BUILT in current product code. BLOCKED appears to have been recorded from
// a live-environment run against the paused Vercel deployment, i.e. it
// measured the ENVIRONMENT, not the product... To close: bind a Playwright
// spec against environment 1 (localhost) and let it go green in CI." This
// is that spec -- one of eleven requirements (R-11/15/30/31/41/42/43/60/82/
// 90/91) sharing the identical recorded reason, picked as the pipeline
// proof-of-concept per PM instruction (deliberately ONE spec, not all
// eleven, until this one is proven green in CI end to end).
//
// PIPELINE STATUS AS OF THIS COMMIT: NOT YET GREEN IN CI. The CI job this
// spec needs to run under must boot ct's backend with a real
// APP_RUNTIME_DATABASE_URL (projexa's /scope page calls ct for BOQ data) --
// the secret currently set on FChecklist/compliance-tracker is CORRUPTED
// (see T-REAL-SECRETS-TRUNCATE-SILENTLY-IN-BASH / F-2026-0910-PM-067: a
// credential-redaction guard silently truncated it during entry). Only the
// owner can safely re-enter that secret (direct entry, never through a
// shell pipeline). This spec is otherwise complete and was written and
// committed WITHOUT needing that secret -- what's blocked is wiring a CI
// job that boots ct + runs this against a live DB, not the spec's own
// logic. Do not report this as "passing" until a real CI run (not a claim)
// shows it green.
//
// Auth: reuses this suite's OWN established pattern (auth.setup.ts /
// users.ts / playwright/.auth/*.json storageState), not a new mechanism --
// logged in as the CEO account, same org (Meridian Construction Group,
// E2E Test Org) every other spec in this file already uses.
test.use({ storageState: "playwright/.auth/ceo.json" });

// Real BOQ, confirmed live 2026-09-10 against pcrjmlpuqsbocqfwoxod:
// compliance.construction_boqs id='uaxct0zlk2mrcn1jxswsqw1a',
// org_id=4ecc472f-4152-4310-ae8d-cf8b7c52ab6d (Meridian, this suite's own
// E2E org), version=1, status=draft.
const BOQ_ID = "uaxct0zlk2mrcn1jxswsqw1a";

test("R-60: BOQ amounts render in AED, not rupee, against a real project", async ({ page }) => {
  await page.goto(`/scope/${BOQ_ID}`, { waitUntil: "networkidle" });

  // WIDENED 2026-09-11 (PM, real bug found running this spec against local
  // ENV1): the original single `body.innerText()` read immediately after
  // `networkidle` failed twice in a row, both times capturing the SAME
  // frozen skeleton-loading state (screenshot confirmed: "Loading..." next
  // to disabled Create Revision/Delete buttons, empty table body, a
  // Turbopack "Compiling..." indicator still visible) -- not a real product
  // defect. `networkidle` only guarantees the network request queue went
  // quiet for 500ms; it says nothing about whether ScopeObjectClient.tsx's
  // own `load()` (src/components/ScopeObjectClient.tsx) has actually
  // resolved its Promise.all and re-rendered by then, and its own
  // `loadRevisionContext()` fires MORE fetches afterward that networkidle's
  // one settle-point can race against under this machine's real, elevated
  // local load. Fixed correctly, not force-passed: `toContainText` with an
  // explicit timeout auto-retries the read (Playwright's built-in polling
  // assertion), so it waits for the real render rather than reading a
  // single, possibly-premature snapshot -- the same class of fix as R-B1's
  // pollUntil widen and R-B2's hardcoded-timeout widen elsewhere in this
  // session. (Also corrects a stale reference below: the real currency
  // formatter for this screen lives in ScopeObjectClient.tsx, not
  // ScopeClient.tsx -- that file was replaced by the 2026-08-30 real-screen
  // conversion, per that file's own header comment.)
  //
  // D58 falsifiability note (manual break-restore proof this pipeline needs
  // before the eleven requirements are trusted, not yet run since the CI
  // path is blocked -- see header): planting a defect here means
  // temporarily hardcoding "₹"/"INR" in ScopeObjectClient.tsx's currency
  // formatter and confirming this assertion goes red, then reverting and
  // confirming it goes green again -- the same RED/GREEN run-id pair
  // DOD-X4 and DOD-R3 already used this window.
  const body = page.locator("body");
  await expect(body, "page must show at least one AED-denominated amount").toContainText("AED", { timeout: 20_000 });
  const bodyText = await body.innerText();
  expect(bodyText, "page must NOT show a rupee symbol or INR code").not.toMatch(/₹|INR\b/);
});
