import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";

// R-90 (recorded status: PARTIAL): "Real backend message shown in the toast".
// Recorded file_path hint: "src/components/ScopeClient.tsx surfaces
// error.message in a toast". Confirmed by direct read that hint is STALE:
// ScopeClient.tsx (the /scope LIST screen) never calls toast at all -- its
// own load() failure sets a `readError` object rendered through PaneState
// (ScopeClient.tsx L218-274), a persistent banner, not a toast. The real
// `toast.error(...)` call sites for Scope/BOQ all live in
// src/components/ScopeObjectClient.tsx (the real Object Page,
// /scope/[id]) -- L193 (budget/vendor save), L211/L214 (category
// registration), L248 (submit/approve/delete), L298 (header title save).
//
// WHY THIS SPEC DOES NOT USE /scope/new (ScopeCreateClient.tsx), THE MOST
// OBVIOUS "creating something that can fail" CANDIDATE:
//  1. src/lib/use-submit.ts (R67 D-72), which /scope/new's Save runs through,
//     explicitly RETIRED toast.error() for every create-screen refusal in
//     favour of a persistent footer message (`submit.failure` / `formFailure`)
//     -- its own header comment calls a fading toast.error() out by name as
//     the defect D-72 removes ("THE FAILURE FADED ... gone in four
//     seconds"). A refused /scope/new save is therefore shown in a BANNER,
//     never "in the toast", by design.
//  2. Even the one backend-only validation rule this task named as an
//     example -- "breakdownPercentage is required when parentItemCode is
//     set" (VERIDIAN's real rule, compliance-tracker
//     src/lib/services/construction-boq-service.ts L301-302) -- cannot reach
//     that screen's backend at all: src/lib/boq-helpers.ts's
//     lineMissingFields()/collectLines() (used by ScopeCreateClient's own
//     Save-button gating and pre-submit check) mirrors that exact rule
//     client-side, so Save stays disabled and no request is ever sent. A
//     prior session's own e2e/r81-d603-scope.spec.ts "R-90" test found the
//     same wall and worked around it with `page.route()` network
//     interception (a MOCKED 400 body) rather than a genuine backend
//     rejection -- its own header comment says so outright ("a
//     'deliberately invalid' submit could still reach the upstream writer").
//
// THE REAL, UNMOCKED TRIGGER THIS SPEC USES INSTEAD: ScopeObjectClient.tsx's
// inline Budget % editor. The `<Input type="number">` at L578-588 has NO
// min/max/step and no client-side range check at all -- any finite number
// typed there is sent straight to saveLineItemBudget() (L178-197), which
// PATCHes /api/scope/line-items/{id} and, on failure, runs
// `toast.error(err instanceof Error ? err.message : "Couldn't save
// budget/vendor")` (L193) -- a REAL toast.error(realMessage) call.
//
// THE REAL BACKEND RULE THIS TRIGGERS (compliance-tracker / VERIDIAN, the
// service PROJEXA's /api/scope/* proxies to):
//   src/lib/services/construction-boq-service.ts L1095-1096, updateLineItemBudget():
//     if (input.budgetPercentage !== undefined && (input.budgetPercentage < 0 || input.budgetPercentage > 100))
//       throw new ServiceError("budgetPercentage must be between 0 and 100", 400)
//   Caught verbatim by src/app/api/v1/construction/boq/line-items/[id]/route.ts
//   L34-35: `NextResponse.json({ error: error.message }, { status: error.status })`.
//
// THE PASS-THROUGH THIS SPEC PROVES IS NOT MASKED, hop by hop (projexa repo):
//   1. src/app/api/scope/line-items/[id]/route.ts calls callVeridian(PATCH),
//      catches the failure, calls veridianErrorResponse(err, "Failed to
//      update line item budget").
//   2. src/lib/veridian-client.ts's throwForResponse() (L578-606) parses the
//      upstream JSON body's own `error` string and hands it to
//      VeridianApiError's `message` VERBATIM (L590, L596-605) -- the
//      STORAGE_UNAVAILABLE masking branch there only fires for the literal
//      "supabaseKey is required" string, which this rule never produces.
//   3. src/lib/veridian-response.ts's classifyUpstreamFailure() (L96-109)
//      copies `err.message` straight into `failure.message`, and
//      veridianErrorResponse() (L126-141) returns `{ error: failure.message,
//      code: failure.code }` -- still the exact backend sentence, status 400.
//   4. ScopeObjectClient.tsx's saveLineItemBudget() reads `data.error` off
//      that JSON and throws `new Error(data.error)` (L189), then
//      `toast.error(err.message)` (L193) puts that exact sentence on screen.
//
// R-90 VERDICT, per this direct read: PARTIAL is a fair status, but not for
// the reason the recorded file_path implies. The mechanism is NOT broken --
// where a toast IS the refusal surface (this screen, and its sibling
// submit/approve/delete/header-save/category actions), the real backend
// sentence passes through every proxy hop unmasked and unmodified. What
// keeps R-90 from being fully met is that the flagship "create" write --
// the one a reader would most naturally picture for "a refused save shows
// the backend's words in the toast" -- was deliberately migrated OFF toasts
// entirely (D-72), so no toast exists there to check at all for a backend-
// only rejection. This spec's own assertions can only speak to the path
// they exercise (the Object Page's inline budget editor); they do not
// re-litigate the create screen, which e2e/r81-d603-scope.spec.ts already
// covers (via a mocked body, for the reason explained above).
//
// EXIT CONDITIONS:
//  1. Real user action: each test creates its own real, isolated BOQ (a
//     distinctively-named line item avoids collision with this shared
//     project's existing data) via a real authenticated POST /api/scope,
//     then drives the REAL browser to the real Object Page, types a real
//     out-of-range Budget % (150) into the real input, and blurs it -- the
//     same action a user performs.
//  2. Asserts the REAL rendered Sonner toast ([data-sonner-toast], the same
//     locator e2e/r81-d603-scope.spec.ts uses) contains the REAL backend
//     sentence "budgetPercentage must be between 0 and 100" -- not a
//     placeholder, not a generic "Something went wrong".
//  3. Re-reads the line item over the real API afterward and asserts
//     budgetPercentage was NOT written as 150 -- the refusal must leave no
//     partial write behind.
//  4. BREAK-RESTORE: NOT YET OBSERVED BY THIS SESSION (this draft has not
//     been run -- it is submitted for independent review/execution first,
//     per this task's own instruction). Plant/revert procedure: in
//     updateLineItemBudget() (compliance-tracker
//     src/lib/services/construction-boq-service.ts L1095-1096), either (a)
//     remove the range guard entirely (the PATCH would then 200 and the
//     toast/re-read assertions both go red), or (b) replace the thrown
//     message with a generic one (e.g. "Invalid input") to confirm the
//     substring assertion catches message-masking specifically. Revert and
//     confirm green again after either.
//  5. Runs against Env-1 (http://localhost:3100, real Supabase + real
//     VERIDIAN backend) -- no mocking anywhere in this file.

const PROJECT_ID = DEFAULT_PROJECT.id;

async function warmGoto(page: import("@playwright/test").Page, url: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
      return;
    } catch (e) {
      if (attempt === 3) throw e;
      await page.waitForTimeout(3000);
    }
  }
}

async function runR90Probe(page: import("@playwright/test").Page, roleTag: string) {
  const distinctiveDescription = `R90 Spec Budget Line ${roleTag} ${Date.now()}`;

  // Real, authenticated create of a real, isolated BOQ with one real line
  // item -- same call shape as e2e/r33-category-rollup-excludes-subtasks-env1.spec.ts's
  // own setup.
  const createRes = await page.request.post("/api/scope", {
    data: {
      projectId: PROJECT_ID,
      title: `R-90 env1 spec ${roleTag} ${Date.now()}`,
      lineItems: [
        { itemCode: `R90-${roleTag.toUpperCase()}`, description: distinctiveDescription, unit: "sqm", quantity: 10, rate: 100 },
      ],
    },
  });
  expect(createRes.ok(), "BOQ creation must succeed for this spec's own setup").toBe(true);
  const created = await createRes.json();
  const boqId = created.id as string;
  expect(boqId, "the real create response must return a real BOQ id").toBeTruthy();
  const lineItem = (created.lineItems as Array<{ id: string; description: string; budgetPercentage?: string | number }>).find(
    (l) => l.description === distinctiveDescription
  );
  expect(lineItem, "the real line item must come back from the create response").toBeTruthy();
  // Real, documented default (ScopeObjectClient.tsx L581's own fallback, and
  // construction-boq-service.ts's Point 154 comment) -- confirmed against
  // the real create response rather than assumed.
  expect(Number(lineItem!.budgetPercentage ?? 25), "a fresh line item's real starting Budget % must be 25").toBe(25);

  // Real, authenticated navigation to the real Object Page for this BOQ.
  await warmGoto(page, `/scope/${boqId}`);

  const budgetInput = page.getByLabel(`Budget % for ${distinctiveDescription}`);
  await expect(budgetInput, "the real Budget % input for this spec's own line item must render").toBeVisible({ timeout: 30_000 });

  // The real, genuinely out-of-range user action: no client-side min/max
  // exists on this control (ScopeObjectClient.tsx L578-588), so this value
  // reaches the real backend unmodified.
  await budgetInput.fill("150");
  await budgetInput.press("Tab"); // real blur -- the save fires onBlur, not onChange

  // The load-bearing assertion: the REAL Sonner toast carries the REAL
  // backend sentence, not a generic failure.
  const toast = page.locator("[data-sonner-toast]").filter({ hasText: "budgetPercentage must be between 0 and 100" });
  await expect(
    toast,
    "the real Sonner toast must show VERIDIAN's own real refusal sentence, 'budgetPercentage must be between 0 and 100' -- not a placeholder or a generic failure message"
  ).toBeVisible({ timeout: 30_000 });

  // No partial write: the refusal must not have silently persisted 150.
  const reread = await page.request.get(`/api/scope/${boqId}`);
  expect(reread.ok(), "the real re-read of this BOQ must succeed").toBe(true);
  const rereadBody = await reread.json();
  const rereadLine = (rereadBody.lineItems as Array<{ id: string; budgetPercentage?: string | number }>).find(
    (l) => l.id === lineItem!.id
  );
  expect(rereadLine, "the real line item must still exist after the refused save").toBeTruthy();
  expect(
    Number(rereadLine!.budgetPercentage ?? 25),
    "a refused Budget % write must never have reached storage -- it must not read back as 150"
  ).not.toBe(150);
}

test.describe("R-90 as CEO", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("R-90: an out-of-range Budget % is refused with VERIDIAN's own real sentence, in a real toast (CEO)", async ({ page }) => {
    await runR90Probe(page, "ceo");
  });
});

test.describe("R-90 as Finance", () => {
  test.use({ storageState: "playwright/.auth/finance.json" });

  test("R-90: an out-of-range Budget % is refused with VERIDIAN's own real sentence, in a real toast (Finance)", async ({ page }) => {
    await runR90Probe(page, "finance");
  });
});
