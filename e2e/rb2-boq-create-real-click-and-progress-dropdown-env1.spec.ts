import { test, expect, type Page } from "@playwright/test";

// R-B2 (demoted CLOSED -> OPEN, D129): its only prior closure evidence,
// e2e/demo-gate-smoke.spec.ts (compliance-tracker repo), drives
// page.request.post("/api/scope", ...) / .../work-progress directly -- it
// never touches the real browser UI, so it cannot prove what the row is
// actually about. W-PROD traced the fault history and handed this session
// two concrete, real-click assertions to close it properly (platform.
// r43_faults R46M13_TC10_01 / R46M13_TC30_01). This spec is that.
//
// PREMISE CORRECTION, found while grounding this spec (Explore agent, this
// session, 2026-09-11) -- W-PROD's framing assumed a `confirmBoqCreated()`
// function and a "BOQ created" TOAST that could show a false positive.
// NEITHER EXISTS: grepped the whole repo, zero matches for
// confirmBoqCreated. ScopeCreateClient.tsx imports `toast` from "sonner"
// (line 48) but never calls it -- a dead import. Success and failure are
// BOTH rendered as real in-page state, never a toast:
//   - SUCCESS: the real onSuccess callback (ScopeCreateClient.tsx L224-245)
//     validates data.id is present AND data.lineItems.length >=
//     sentLineCount.current (the number of VALID lines actually posted) --
//     any check failing throws, which use-submit.ts (L348-359) turns into a
//     real "unconfirmed" failure rendered in-page, NOT a false "created"
//     state. On real success it calls router.replace(), a real navigation.
//   - FAILURE: a real !res.ok is caught in use-submit.ts (L329-341) and
//     rendered as a real in-page alert: "Could not save the boq -- {reason}
//     Nothing was saved." (same banner r11's spec already observed live).
// So TC-10's real, provable claim is: success is signalled ONLY by a real
// navigation to a real, independently re-readable BOQ id -- never by an
// isolated success indicator that could lie while nothing was actually
// saved. This is the STRONGER version of "no false-positive toast" (there
// being no toast to falsify is not a gap -- the in-page validation this
// spec exercises is the real mechanism doing that job).
//
// TC-10 (R46M13_TC10_01): create a parent (100 qty x 50 rate = 5000) with
// THREE weighted children (40/35/25%) through the REAL /scope/new form --
// real clicks, not page.request. Asserts:
//   1. The Save button only ever reads bare "Save" once the form is
//      genuinely complete (createSaveLabel(), same check r11's spec uses).
//   2. Real navigation to /scope/{id} on save -- a cuid-shaped id (~24
//      lowercase alphanumeric chars), not a UUID (r11's own hard-won fix).
//   3. The real Object Page (fresh render right after save) shows all four
//      real lines, the three children indented (pl-8) and labelled "{pct}%
//      of parent", the root labelled "(children: {sum}%)".
//   4. A HARD RELOAD of the /scope LIST page (not the object page) shows
//      this exact BOQ's title as a real link row -- proving persistence
//      survives a fresh page load, not just the immediate post-save render.
//
// TC-30 (R46M13_TC30_01): the real "Log Work Progress" -> Daily Entry form's
// BOQ-line-item dropdown must actually offer the JUST-CREATED BOQ's own
// line items, not silently stay locked to whatever pickCurrentBoq() (approved
// > submitted > highest version) would have defaulted to -- the original bug
// PROJEXA PR #148 fixed. A fresh BOQ is draft/version 1, which pickCurrentBoq
// will NOT normally win against any existing approved/submitted BOQ in the
// project, so this spec does NOT rely on auto-selection: it creates a SECOND,
// distinct real BOQ (via a real authenticated API call -- cheap, and this is
// PURELY setup, the same convention r33/r21-r24/r22 already use for their own
// setup) so the project provably has >1 BOQ, uses the real BOQ <Select>
// (only rendered when boqs.length > 1, WorkProgressFormClient.tsx L502-517)
// to explicitly choose EACH BOQ in turn, and asserts the BoqLinePicker's real
// option list changes to match whichever BOQ is currently selected --
// TC-10's own root item code appears when TC-10's BOQ is selected, and does
// NOT appear when the second BOQ is selected instead. This is the real,
// falsifiable claim the original bug violated (one project-wide "active" BOQ
// locked in for every case).
//
// EXIT CONDITIONS:
//  1. Real user action throughout TC-10 (page.getByLabel(...).fill(...),
//     real button clicks) -- not page.request for the thing under test.
//  2. Asserts real rendered UI (Object Page markup, list page markup,
//     dropdown option text), not API JSON, for both TC-10 and TC-30's core
//     claims.
//  3. BREAK-RESTORE: NOT YET OBSERVED BY THIS SESSION -- same RAM/no-Env-1-
//     CI-job blocker as the rest of this batch (see r15-r30-r31's identical
//     note; PR compliance-tracker#1677 will close the CI half once the owner
//     adds its 2 missing secrets, per PM 2026-09-11). Plant/revert sketch,
//     TC-10: in ScopeCreateClient.tsx's onSuccess, change the
//     `savedLineItems < sentLineCount.current` guard to always pass (e.g.
//     `false`) -- confirm this spec's own navigation/rendered-line
//     assertions still pass even when they shouldn't (proving the guard
//     matters), or more directly: in WorkProgressFormClient.tsx, hardcode
//     `boqId` in BoqLinePicker's props to the FIRST boq's id regardless of
//     `selectedBoqId` -- confirm TC-30's "switching BOQ changes the option
//     list" assertion goes red, then revert.
//  4. Runs against Env-1 (http://localhost:3100) -- drafted for the first
//     real run the RAM window allows, not yet observed at authoring time.
test.use({ storageState: "playwright/.auth/ceo.json", navigationTimeout: 90_000, actionTimeout: 45_000 });

const PROJECT_ID = "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04"; // Meridian Heights, same real project every env1 spec in this batch uses

test.describe("R-B2: real click-through BOQ creation and the Daily Entry BOQ-line dropdown (TC-10 / TC-30)", () => {
  test("TC-10: creating a parent + 3 weighted children through the real /scope/new form only ever signals success via real navigation + a real, persisted, re-readable BOQ", async ({ page }) => {
    test.slow();
    const tag = `RB2-${Date.now()}`;
    const title = `R-B2 spec (${tag})`;

    await page.goto(`/scope/new?projectId=${PROJECT_ID}`, { waitUntil: "networkidle" });
    await page.getByLabel("Title").fill(title);

    // Root line (line 1): 100 qty x 50 rate = 5000, matching the fault's own
    // TC-10 shape example.
    await page.getByLabel("Description, line 1").fill(`${tag} root`);
    await page.getByLabel("Unit, line 1").fill("sqm");
    await page.getByLabel("Qty, line 1").fill("100");
    await page.getByLabel("Rate, line 1").fill("50");
    await page.getByLabel("Item code, line 1").fill(`${tag}-ROOT`);

    // Three weighted children (40/35/25%), lines 2-4.
    const children = [
      { code: `${tag}-A`, pct: "40", desc: `${tag} child A 40%` },
      { code: `${tag}-B`, pct: "35", desc: `${tag} child B 35%` },
      { code: `${tag}-C`, pct: "25", desc: `${tag} child C 25%` },
    ];
    for (let i = 0; i < children.length; i++) {
      const lineNum = i + 2;
      await page.getByRole("button", { name: "+ Add Line" }).click();
      await page.getByLabel(`Description, line ${lineNum}`).fill(children[i].desc);
      await page.getByLabel(`Item code, line ${lineNum}`).fill(children[i].code);
      await page.getByLabel(`Parent code, line ${lineNum}`).fill(`${tag}-ROOT`);
      await page.getByLabel(`Breakdown %, line ${lineNum}`).fill(children[i].pct);
    }

    // The Save primary's own label names what's missing (createSaveLabel) --
    // once the form is genuinely complete it reads bare "Save". Same check
    // r11's spec already established as the real completeness signal.
    const saveButton = page.getByRole("button", { name: /^Save/ });
    await expect(saveButton, "the Save primary must not still be naming a missing field once this form is filled").toHaveText("Save");
    await saveButton.click();

    // Real navigation is the ONLY real success signal (no toast exists --
    // see header note). cuid-shaped id (r11's own hard-won fix: NOT a UUID,
    // and the pattern must require a minimum length so it can't match the
    // literal "new" segment of the pre-save URL).
    //
    // WIDENED 2026-09-12 (PM, real flakiness found running this spec against
    // local ENV1, same class as r11-boq-create-form-subtask-fields-env1.spec.ts's
    // own documented 90_000/45_000 navigationTimeout/actionTimeout widening):
    // test.slow() above triples Playwright's OWN internal timeouts, but does
    // NOT extend an explicit `{ timeout }` passed directly to waitForURL --
    // that stays hardcoded regardless. Confirmed via compliance-tracker's dev
    // server log this was never a real save failure: both POSTs /api/scope
    // returned 201 every time, and a same-run GET /api/v1/projexa/scope/{id}
    // was observed taking 8.0s server-side under this machine's real, elevated
    // local load (RAM pressure from the same E2E session this spec itself
    // documents needing test.slow() for) -- this test creates TWO full BOQs
    // via real click-through form-fill, heavier than its siblings, so it is
    // the one most likely to graze a 30s ceiling under load. Widened to match
    // this file's own test.slow()-implied budget rather than the pre-widening
    // default.
    await page.waitForURL(/\/scope\/[a-z0-9]{10,}(\?|$)/, { timeout: 60_000 });
    const boqId = page.url().match(/\/scope\/([a-z0-9]{10,})/)?.[1];
    expect(boqId, "the URL after save must carry the real new BOQ id (not the literal 'new')").toBeTruthy();
    expect(boqId, "the extracted id must not be the create screen's own path segment").not.toBe("new");

    // Real, freshly-rendered Object Page: all four lines visible, the three
    // children indented (pl-8) and labelled with their own real "% of
    // parent", the root labelled with the real running total (100%).
    const rootCell = page.locator("td.font-medium.text-ct-navy", { hasText: `${tag} root` });
    await expect(rootCell, "the root line's own real cell must be visible, un-indented").toBeVisible();
    await expect(rootCell, "the root's own real cell must show the running total of its children's percentages (40+35+25=100)").toContainText(/\(children:\s*100(\.\d+)?%\)/);

    for (const child of children) {
      const cell = page.locator("td.pl-8", { hasText: child.desc });
      await expect(cell, `${child.code}'s own real cell must carry the pl-8 sub-task indentation class`).toBeVisible();
      await expect(cell, `${child.code} must be labelled with its own real breakdown %`).toContainText(new RegExp(`${child.pct}(\\.\\d+)?% of parent`));
    }

    // Real persistence beyond the immediate post-save render: a HARD RELOAD
    // of the /scope LIST page (not the object page just rendered) must show
    // this exact BOQ's own title as a real link row -- this is what a false-
    // positive success (data accepted client-side, never actually saved)
    // could not survive.
    await page.goto(`/scope?projectId=${PROJECT_ID}`, { waitUntil: "networkidle" });
    // WIDENED 2026-09-12 (PM, same reasoning as this file's waitForURL widen
    // above): confirmed via compliance-tracker's dev server log the real
    // create (201) and the real list GET (200) both succeeded server-side --
    // 15s was simply tight for a full hard-reload + list render under this
    // machine's real, elevated local load, not a persistence failure.
    await expect(
      page.getByRole("link", { name: title, exact: true }),
      "the newly created BOQ's own real title must appear as a real link row in the list after a hard reload -- proving the save genuinely persisted, not just a client-side illusion"
    ).toBeVisible({ timeout: 30_000 });
  });

  test("TC-30: the Daily Entry BOQ-line dropdown offers whichever BOQ is currently selected's own real lines, not a locked-in project-wide set", async ({ page }) => {
    test.slow();
    const tag = `RB2T30-${Date.now()}`;

    // BOQ 1 (this test's own "just created" BOQ under test) -- real
    // authenticated API call for SETUP, same convention r33/r21-r24/r22 use
    // for their own setup (the UI-click path is what TC-10 above already
    // covers; re-doing it here would just be redundant, slower setup for a
    // test about the dropdown, not the create form).
    const boq1Res = await page.request.post("/api/scope", {
      data: {
        projectId: PROJECT_ID,
        title: `${tag} BOQ One`,
        lineItems: [{ itemCode: `${tag}-ONE`, description: `${tag} BOQ One root`, unit: "nos", quantity: 10, rate: 100 }],
      },
    });
    expect(boq1Res.ok(), "BOQ One creation must succeed for this spec's own setup").toBe(true);
    const boq1 = await boq1Res.json();
    expect(boq1.id, "BOQ One's real id must come back from the create response").toBeTruthy();

    // BOQ 2, distinct real lines -- guarantees the project has >1 BOQ so the
    // real BOQ <Select> actually renders (WorkProgressFormClient.tsx:
    // "with a single BOQ the choice is not a choice" -- it's hidden entirely
    // otherwise), and gives a second, real, DIFFERENT option to switch to.
    const boq2Res = await page.request.post("/api/scope", {
      data: {
        projectId: PROJECT_ID,
        title: `${tag} BOQ Two`,
        lineItems: [{ itemCode: `${tag}-TWO`, description: `${tag} BOQ Two root`, unit: "nos", quantity: 5, rate: 200 }],
      },
    });
    expect(boq2Res.ok(), "BOQ Two creation must succeed for this spec's own setup").toBe(true);
    const boq2 = await boq2Res.json();
    expect(boq2.id, "BOQ Two's real id must come back from the create response").toBeTruthy();

    await page.goto(`/work-progress?projectId=${PROJECT_ID}&tab=entry`, { waitUntil: "networkidle" });

    const dropdownLabel = "BOQ line item (required - the Work Progress Report is priced off it)";
    const lineCombobox = page.getByRole("combobox", { name: dropdownLabel });
    await expect(lineCombobox, "the real BOQ-line-item combobox must be visible on the Daily Entry tab").toBeVisible({ timeout: 20_000 });

    // The real BOQ <Select> only renders when the project has >1 BOQ --
    // guaranteed true here by the two real BOQs just created above.
    // FormField (form-field.tsx L67/89) renders <Label htmlFor={id}>BOQ</Label>
    // and spreads that same `id` onto the SelectTrigger's own render prop
    // (WorkProgressFormClient.tsx L506-509), so this select's real accessible
    // name is genuinely "BOQ", properly associated via htmlFor/id -- not
    // guessed from its rendered option text.
    const boqSelect = page.getByLabel("BOQ", { exact: true });

    async function selectBoq(title: string) {
      await boqSelect.click();
      await page.getByRole("option", { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(v`) }).click();
    }

    async function optionCodesFor(query: string): Promise<string[]> {
      await lineCombobox.click();
      await lineCombobox.fill(query);
      const listbox = page.getByRole("listbox", { name: dropdownLabel });
      await listbox.waitFor({ state: "visible", timeout: 10_000 });
      const text = await listbox.innerText();
      await page.keyboard.press("Escape");
      return text.split("\n");
    }

    // With BOQ One selected, its own root item code must be a real,
    // findable option -- and BOQ Two's must NOT be (proving the dropdown is
    // scoped to the selected BOQ, not showing every line in the project).
    await selectBoq(`${tag} BOQ One`);
    const boq1Options = await optionCodesFor(tag);
    expect(boq1Options.some((line) => line.includes(`${tag}-ONE`)), "BOQ One's own real line item must appear in the dropdown while BOQ One is selected").toBe(true);
    expect(boq1Options.some((line) => line.includes(`${tag}-TWO`)), "BOQ Two's line item must NOT appear while BOQ One is selected -- the dropdown must not silently show every BOQ's lines").toBe(false);

    // Switching the BOQ selector to BOQ Two must change which lines the
    // dropdown offers -- this is the real, falsifiable claim the original
    // bug (one project-wide "active" BOQ locked in) violated.
    await selectBoq(`${tag} BOQ Two`);
    const boq2Options = await optionCodesFor(tag);
    expect(boq2Options.some((line) => line.includes(`${tag}-TWO`)), "BOQ Two's own real line item must appear in the dropdown once BOQ Two is selected").toBe(true);
    expect(boq2Options.some((line) => line.includes(`${tag}-ONE`)), "BOQ One's line item must NOT still appear once BOQ Two is selected -- the previous BOQ's lines must not leak through").toBe(false);
  });
});
