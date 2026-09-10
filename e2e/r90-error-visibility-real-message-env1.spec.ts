import { test, expect } from "@playwright/test";

// R-90 (Error Visibility): "Real backend message shown in the toast".
// Recorded closure_state=BLOCKED, same shared root cause as the rest of the
// eleven (F-2026-0910-PM-068).
//
// CORRECTION TO THE DB EVIDENCE, filed as F-2026-0910-W-TEST-001 (kt/
// FINDINGS.W-TEST.jsonl): the recorded evidence says ScopeClient.tsx passes
// `data.error` to the toast VERBATIM/unwrapped. That code path no longer
// exists. The real create form (ScopeCreateClient.tsx, route /scope/new) now
// goes through src/lib/use-submit.ts (R67 D-72's twelve-screen unification),
// whose "refused" case WRAPS the backend reason:
//   `Could not save the ${object} — ${terminate(reason)} Nothing was saved.`
// This spec tests the CURRENT real mechanism -- a genuine, specific backend
// reason surfaces to the user (not a generic, interchangeable failure
// message) -- rather than the stale exact-wrapping claim.
//
// The failure is triggered for real: a BOQ is submitted with a real title and
// one root line item, plus a second line whose parentItemCode references a
// code that does not exist among the lines being submitted. Client-side
// validation (collectLines/lineMissingFields, read directly in
// src/lib/boq-helpers.ts) only checks each line's OWN required fields, never
// cross-line parent-reference resolution -- so this reaches the real
// server-side refusal, not a client-side "not-sent" short-circuit.
//
// PIPELINE STATUS AS OF THIS COMMIT: NOT YET GREEN IN CI -- same Env-1 CI job
// dependency as the rest of the eleven (this one additionally needs ct's
// backend up, since /api/scope proxies to it).
test.use({ storageState: "playwright/.auth/ceo.json" });

test("R-90: a real, specific backend refusal reaches the user, not a generic message", async ({ page }) => {
  await page.goto("/scope/new", { waitUntil: "networkidle" });

  await page.getByLabel("Title").fill(`R-90 env1 spec ${Date.now()}`);

  // Root line: a real item code, no parent. Field selectors are
  // ScopeCreateClient.tsx's own aria-labels ("Item code, line N" / "Parent
  // code, line N"), confirmed by direct read -- BoqLineGrid.tsx is a
  // separate, unrelated component, not used by this create form.
  await page.getByLabel("Item code, line 1").fill("R90-ROOT");

  // Second line: a sub-task whose parent code does not exist among the
  // submitted lines -- an unresolvable reference, real server-side rejection
  // territory (evidence for this requirement already cites this exact class
  // of real backend message: "Unresolvable parentItemCode reference(s)
  // among: ...").
  const addLineButton = page.getByRole("button", { name: /add line/i });
  await addLineButton.click();
  await page.getByLabel("Item code, line 2").fill("R90-SUB");
  await page.getByLabel("Parent code, line 2").fill("R90-NONEXISTENT-PARENT");

  await page.getByRole("button", { name: /^save$/i }).click();

  // D58 falsifiability note (manual break-restore, not yet run -- this
  // pipeline is blocked on the Env-1 CI job): planting a defect means
  // temporarily hardcoding submitFailure's "refused" message to a generic
  // "Something went wrong" in use-submit.ts, confirming this assertion goes
  // red, then reverting.
  const alert = page.getByRole("alert");
  await expect(alert, "a real server refusal must surface in the failure region").toBeVisible({ timeout: 15_000 });
  const message = (await alert.textContent()) ?? "";
  expect(message, "the failure must be wrapped in the current real refused-submit format").toMatch(/Could not save the boq/i);
  expect(message, "the failure must end with the real submit-failure closer, proving it reached use-submit.ts's real path").toMatch(/Nothing was saved\.?$/i);
  // The reason between the em dash and the closer must be more than the
  // "no reason given" fallback (terminate()'s own default text) -- proving a
  // REAL, specific backend reason came through, not an empty/generic one.
  expect(message, "the reason must be a real, specific backend message, not the no-reason fallback").not.toMatch(/the server gave no reason/i);
  expect(message.length, "the reason must carry real content beyond the fixed wrapper text").toBeGreaterThan("Could not save the boq —  Nothing was saved.".length);
});
