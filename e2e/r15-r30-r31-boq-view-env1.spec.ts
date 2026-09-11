import { test, expect, type Page } from "@playwright/test";

// R-30 (BOQ): "Sumeet can SEE line items of a BOQ".
// R-31 (BOQ): "Sub-task rows indented and labelled % of parent".
// R-15 (BOQ): "Running total of child percentages shown per parent".
// All three are real UI/VISUAL requirements about the same real screen, so
// this spec drives a real browser against it rather than asserting on API
// JSON alone (unlike r33's spec in this batch, which is a pure computed-value
// requirement).
//
// RECORDED file_path HINT WAS STALE, CONFIRMED BY DIRECT READ. The hint named
// "src/components/ScopeObjectClient.tsx (the BOQ 'View' dialog)". That was
// true of the OLD ScopeClient.tsx, but ScopeObjectClient.tsx's own header
// comment (L1-13) records the 2026-08-30 "real-screen conversion": it is now
// a real Object Page ROUTE, GET /scope/[id]
// (src/app/(app)/scope/[id]/page.tsx passes boqId straight through to
// ScopeObjectClient, no dialog involved), replacing that old View dialog
// popup entirely. This spec navigates the real route, not a dialog.
//
// Confirmed directly in ScopeObjectClient.tsx (line numbers as read this
// session):
//  - R-30: L519-631. Every real line item renders as its own real <TableRow>
//    inside a real <table> (L522, via components/ui/table.tsx's TableCell,
//    a genuine <td>) -- the ONLY branch that shows anything else is
//    `rows.length === 0` (L519-520, "This BOQ has no line items."). So for a
//    BOQ that genuinely has line items, each one's own description is real,
//    visible page text -- nothing is collapsed or requires an extra click to
//    reveal.
//  - R-31: L544 `const isSub = !!r.parentLineItemId;`. The description
//    <TableCell>'s className (L555) is
//    `isSub ? "pl-8 text-ct-muted" : "font-medium text-ct-navy"` -- `pl-8` is
//    the real Tailwind left-padding utility that visually indents a sub-task
//    row under its parent; a root row never carries it. The SAME cell, when
//    `isSub && r.breakdownPercentage`, appends (L558)
//    `{r.breakdownPercentage}% of parent` -- the real "% of parent" label.
//  - R-15: L546-550 computes, for every ROOT row only,
//    `childPercentSum(...)` (src/lib/boq-helpers.ts L140-146: sums every
//    child's own breakdownPercentage whose parentItemCode matches this root's
//    itemCode). L559 renders it right there on the root's own cell as
//    `(children: {childSum}%)` whenever non-null. This is the SAME real
//    running-total concept BoqLineGrid.tsx's CREATE form shows (there:
//    "Children: X% of 100%", BoqLineGrid.tsx L126-130) -- confirming, by
//    direct read of ScopeObjectClient.tsx and not by assumption, that R-15 IS
//    genuinely satisfied by THIS view too, not only by create/edit.
//
// NOT VERIFIABLE FROM THIS REPO'S SOURCE (flagged honestly rather than
// guessed at):
//  1. The exact numeric STRING breakdownPercentage round-trips as (e.g.
//     whether a stored "40" comes back "40" or "40.00") -- the service/DB
//     layer that writes compliance.construction_boq_line_items lives in the
//     separate "compliance-tracker"/VERIDIAN repo, not present here (the same
//     gap r33's own header notes for construction-reports-service.ts). This
//     spec's percentage assertions therefore tolerate an optional decimal
//     tail via regex rather than assuming an exact string.
//  2. Whether the Finance account (Deepak Joshi, PROJEXA local role
//     "member") can itself CREATE a BOQ via POST /api/scope. api/scope/
//     route.ts (POST, read this session) has no local role check at all --
//     it forwards straight to VERIDIAN -- and the one role-gated BOQ action
//     actually found in this repo is Approve (api/scope/[id]/approve/
//     route.ts: "Manager-role gating happens server-side in VERIDIAN
//     (requireRoleOrScope)"), not Create. So it is plausible but NOT
//     confirmed that Finance can create a BOQ. If it turns out Finance
//     cannot, the Finance block below's own creation step (not its view
//     assertions) is what would need changing to read a CEO-created BOQ
//     instead.
//
// EXIT CONDITIONS:
//  1. Real user action: each role block creates its OWN real, isolated BOQ
//     (distinctive itemCodes/descriptions so it cannot collide with, or be
//     confused for, any other real data in this shared project) with one
//     root line and TWO weighted sub-task lines under it, via real
//     authenticated API calls (same page.request.post("/api/scope", ...)
//     convention as r33/r21-r24/r22/r23-c13 in this batch), then navigates to
//     the real BOQ Object Page a user's own click into that BOQ would land
//     on.
//  2. Asserts real RENDERED UI, not just API responses: every line item's
//     description is visible (R-30); a sub-task's own real <td> carries the
//     real `pl-8` indentation class AND its own real "X% of parent" label,
//     distinct from the root's un-indented cell (R-31); the root's own real
//     cell shows the real running total of BOTH children's percentages
//     summed together, not just one of them (R-15).
//  3. Exercised under at least two real roles (CEO and Finance), per this
//     window's UI-test brief for "at least two roles" -- Finance repeats the
//     full read scenario against its own real BOQ, proving the view (and its
//     indentation/labels/running-total) is not accidentally CEO-only.
//  4. BREAK-RESTORE: NOT YET OBSERVED BY THIS SESSION. Same RAM/CI blocker as
//     the rest of this batch (0.62GB free at write time, D72, no Env-1 CI job
//     yet -- see r33/r21-r24/r22's own notes). Plant/revert sketch: in
//     ScopeObjectClient.tsx's row render, remove the `pl-8` branch and/or the
//     `% of parent` / `(children: ...)` spans (L555-559) -- confirm the
//     R-31/R-15 assertions below go red, then revert and confirm green
//     again. R-30's assertion would need the `rows.length === 0` branch
//     forced instead (or the row map removed) to go red the same way.
//  5. Runs against Env-1 -- blocked from actually running until the CI job
//     exists, same as condition 4.

const PROJECT_ID = "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04";

/** A percentage as it should appear in the UI, tolerant of an unverified decimal tail (see note above). */
function pctPattern(value: number): string {
  return `${value}(\\.\\d+)?`;
}

/**
 * Creates a real, isolated BOQ (one root line + two weighted sub-tasks) via
 * real authenticated API calls, then asserts R-30/R-31/R-15 against the real
 * rendered Object Page -- shared between the CEO and Finance role blocks
 * below so each one exercises the identical real scenario end to end.
 */
async function createAndViewBoq(page: Page, tag: string) {
  const rootDesc = `R-15/R-30/R-31 spec: root line (${tag})`;
  const sub1Desc = `R-15/R-30/R-31 spec: sub-task Alpha 40% (${tag})`;
  const sub2Desc = `R-15/R-30/R-31 spec: sub-task Bravo 25% (${tag})`;

  const createRes = await page.request.post("/api/scope", {
    data: {
      projectId: PROJECT_ID,
      title: `R-15-R30-R31 env1 spec (${tag}) ${Date.now()}`,
      lineItems: [
        { itemCode: `R15${tag}-ROOT`, description: rootDesc, unit: "sqm", quantity: 20, rate: 1000 },
        { itemCode: `R15${tag}-SUBA`, description: sub1Desc, unit: "sqm", quantity: 8, rate: 1000, parentItemCode: `R15${tag}-ROOT`, breakdownPercentage: 40 },
        { itemCode: `R15${tag}-SUBB`, description: sub2Desc, unit: "sqm", quantity: 5, rate: 1000, parentItemCode: `R15${tag}-ROOT`, breakdownPercentage: 25 },
      ],
    },
  });
  expect(createRes.ok(), `BOQ creation must succeed for this spec's own ${tag} setup`).toBe(true);
  const created = await createRes.json();
  const boqId: string = created.id;
  expect(boqId, "the real created BOQ must come back with a real id").toBeTruthy();

  // The real user action under test: open the real BOQ Object Page, the same
  // route a click into this BOQ from /scope would land on.
  await page.goto(`/scope/${boqId}`, { waitUntil: "networkidle" });

  // R-30: every real line item's own description is real, visible page text.
  await expect(page.getByText(rootDesc), "the root line's own description must be visible").toBeVisible();
  await expect(page.getByText(sub1Desc), "sub-task Alpha's own description must be visible").toBeVisible();
  await expect(page.getByText(sub2Desc), "sub-task Bravo's own description must be visible").toBeVisible();

  // R-31: a sub-task row's own <td> carries the real `pl-8` indentation
  // class and its own real "X% of parent" label; the root row's own <td>
  // never carries that indentation class.
  const rootCell = page.locator("td.font-medium.text-ct-navy", { hasText: rootDesc });
  await expect(rootCell, "the root line's own cell must render (un-indented, font-medium/text-ct-navy)").toBeVisible();
  await expect(
    page.locator("td.pl-8", { hasText: rootDesc }),
    "the root line must NOT be indented -- pl-8 is a sub-task-only class"
  ).toHaveCount(0);

  const sub1Cell = page.locator("td.pl-8", { hasText: sub1Desc });
  await expect(sub1Cell, "sub-task Alpha's own cell must carry the real pl-8 indentation class").toBeVisible();
  await expect(sub1Cell, "sub-task Alpha must be labelled with its own real % of parent").toContainText(new RegExp(`${pctPattern(40)}% of parent`));

  const sub2Cell = page.locator("td.pl-8", { hasText: sub2Desc });
  await expect(sub2Cell, "sub-task Bravo's own cell must carry the real pl-8 indentation class").toBeVisible();
  await expect(sub2Cell, "sub-task Bravo must be labelled with its own real % of parent").toContainText(new RegExp(`${pctPattern(25)}% of parent`));

  // R-15: the root's own cell shows the real running total of BOTH
  // children's percentages summed together (40 + 25 = 65) -- not just one
  // child's share, which would be the under-count defect this requirement
  // exists to catch.
  await expect(
    rootCell,
    "the root line must show the real running total of its children's percentages (40% + 25% = 65%)"
  ).toContainText(new RegExp(`children:\\s*${pctPattern(65)}%`));
}

test.describe("R-15/R-30/R-31: BOQ line items, sub-task indentation and running child-% total (CEO)", () => {
  test.use({ storageState: "playwright/.auth/ceo.json" });

  test("CEO can see a BOQ's line items, with sub-tasks indented/labelled and a running child-% total on the root", async ({ page }) => {
    await createAndViewBoq(page, "CEO");
  });
});

test.describe("R-15/R-30/R-31: BOQ line items, sub-task indentation and running child-% total (Finance)", () => {
  test.use({ storageState: "playwright/.auth/finance.json" });

  test("Finance can see a BOQ's line items, with sub-tasks indented/labelled and a running child-% total on the root", async ({ page }) => {
    await createAndViewBoq(page, "FIN");
  });
});
