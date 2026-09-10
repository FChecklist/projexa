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

  // D58 falsifiability note (manual break-restore proof this pipeline needs
  // before the eleven requirements are trusted, not yet run since the CI
  // path is blocked -- see header): planting a defect here means
  // temporarily hardcoding "₹"/"INR" in ScopeClient.tsx's currency
  // formatter and confirming this assertion goes red, then reverting and
  // confirming it goes green again -- the same RED/GREEN run-id pair
  // DOD-X4 and DOD-R3 already used this window.
  const bodyText = await page.locator("body").innerText();
  expect(bodyText, "page must show at least one AED-denominated amount").toContain("AED");
  expect(bodyText, "page must NOT show a rupee symbol or INR code").not.toMatch(/₹|INR\b/);
});
