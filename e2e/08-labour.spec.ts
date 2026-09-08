import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT, fieldInput, uniqueSuffix } from "./helpers";

test.use({ storageState: "playwright/.auth/ceo.json" });

// /labour ("Manpower & Attendance", LabourClient.tsx) is project-scoped
// (defaults to the org's first project, Meridian Heights, when navigated
// without ?projectId -- see resolveSelectedProject()). THREE tabs -- Roster /
// Attendance / Daily Summary (LabourClient.tsx:518-523, VALID_TABS at :168) --
// not two: "Daily Summary" (Sumeet's report 4) was added by R67 D-53 after
// this comment was written. Roster also has a real Filter (name/trade/
// company/status) and a CSV Export (LabourClient.tsx:524-539, R67 D-32/D-79),
// both stale-flagged as "not built yet" when this file's original comment was
// written; this suite still exercises only the write paths below, not those.
test.describe("labour", () => {
  test("baseline matches the real (empty) seed data for the default project", async ({ page }) => {
    const [rosterRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/labour-roster") && r.request().method() === "GET"),
      page.goto(`/labour?projectId=${DEFAULT_PROJECT.id}`),
    ]);
    const roster = (await rosterRes.json()) as { roster: { isActive: boolean }[] };
    await expect(page.getByRole("heading", { level: 1, name: "Manpower & Attendance" })).toBeVisible();

    if (roster.roster.length === 0) {
      await expect(page.getByText("No workers on the roster yet.")).toBeVisible();
      // "Mark Attendance" must be disabled with an empty roster (there's
      // nobody to mark attendance for).
      await page.getByRole("tab", { name: "Attendance" }).click();
      // STALE (would-be strict-mode violation): with an empty roster this tab
      // renders TWO buttons both accessibly named "Mark Attendance" -- the
      // header door button (LabourClient.tsx:691-702, label from
      // card-catalogue.ts's ATTENDANCE_DOOR_ID, "Mark Attendance") and the
      // PaneState empty-state action once the attendance pane loads to zero
      // rows (LabourClient.tsx:751-759, same literal text). Both are disabled
      // on the same `roster.length === 0` condition, so .first() (the header
      // button, first in DOM order) satisfies the intent without depending on
      // whether the attendance fetch has resolved yet.
      await expect(page.getByRole("button", { name: "Mark Attendance" }).first()).toBeDisabled();
    } else {
      // STALE assumption: the Roster tab's table only ever shows ACTIVE
      // workers -- filterRoster()'s default filter is status: "active"
      // (LabourClient.tsx:174/182-196), applied client-side on top of the
      // API's raw (unfiltered) roster. Comparing against the raw roster
      // length breaks the moment this project has even one deactivated
      // worker (RosterObjectClient.tsx's Reactivate/Deactivate, R67 D-33).
      const activeCount = roster.roster.filter((r) => r.isActive).length;
      await expect(page.locator("table tbody tr")).toHaveCount(activeCount);
    }

    test.info().annotations.push({
      type: "seed-data-note",
      description: `roster=${roster.roster.length} for ${DEFAULT_PROJECT.name} at test time. At authoring time this and every other project had 0 labour roster / attendance rows seeded -- a real seed-completeness gap for this in-scope module. A non-zero count here on a later run reflects this suite's own additive writes (no teardown -- see PHASE2_BATCH_B_FINDINGS.md's "repeated-run data accumulation" note), not new seed data.`,
    });
  });

  test("adding a worker and marking attendance both persist (real write chain)", async ({ page }) => {
    const [rosterBeforeRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/labour-roster") && r.request().method() === "GET"),
      page.goto(`/labour?projectId=${DEFAULT_PROJECT.id}`),
    ]);
    const rosterBefore = (await rosterBeforeRes.json()) as { roster: unknown[] };
    const workerName = `E2E Test Worker ${uniqueSuffix()}`;

    await expect(page.getByRole("heading", { level: 1, name: "Manpower & Attendance" })).toBeVisible();

    // STALE: "Add Worker" used to open a Dialog (getByRole('dialog', { name:
    // "Add Worker to Roster" })). The 2026-08-30 "Real-screen conversion"
    // (LabourClient.tsx:50-58) replaced every Roster/Attendance popup with a
    // real create route -- Add Worker now routes to /labour/new
    // (RosterCreateClient.tsx). Reached here through the shared "+ New" menu
    // (ListHeaderActions.tsx) rather than the empty-roster-only "Add Worker"
    // button (LabourClient.tsx:622-624), so this works whether or not the
    // roster is currently empty (module-create-routes.ts: labour's menu is
    // Worker / Attendance / Workers from Excel, in that order).
    await page.getByRole("button", { name: "+ New" }).click();
    await page.getByRole("menuitem", { name: "Worker", exact: true }).click();
    await page.waitForURL(/\/labour\/new(\?|$)/);

    // STALE: dialog title was "Add Worker to Roster". RosterCreateClient.tsx
    // no longer overrides CreateScreen's title (comment at :172-176: "the
    // title override is GONE"), so the archetype's own `New ${objectLabel}`
    // applies (CreateScreen.tsx:150) -- "New Worker".
    await expect(page.getByRole("heading", { level: 1, name: "New Worker" })).toBeVisible();

    await fieldInput(page, "Name").fill(workerName);
    // STALE: Trade was "Trade (optional)". R67 D-53 (RosterCreateClient.tsx:
    // 89-100) made Trade REQUIRED -- an untraded worker fell into an
    // "Uncategorised trade" bucket on the Daily Summary report -- so the
    // field now reads plain "Trade", with no "(optional)" suffix
    // (CreateScreen.tsx:185 only appends that suffix for `!field.required`).
    await fieldInput(page, "Trade").fill("Mason");
    // STALE mechanism: Daily Rate is a "money" field (RosterCreateClient.tsx:
    // 129-140), rendered as a currency-prefixed box (MoneyInput,
    // src/components/ui/money-input.tsx:32-58) inside an extra wrapper div,
    // so the Label's immediate sibling (what fieldInput() locates) is that
    // wrapper, not the `<input>` itself -- drill in explicitly.
    await fieldInput(page, "Daily Rate").locator("input").fill("850");

    // STALE: the submit button read "Add Worker". Every create screen now
    // shares one archetype whose primary names what's still missing
    // (save-label.ts: saveLabel("Save", missing), R67 D-67/D-73) and reads
    // plain "Save" once Name, Trade and Daily Rate are all filled.
    const [rosterRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/labour-roster") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save", exact: true }).click(),
    ]);
    expect(rosterRes.status()).toBe(201);

    // STALE: there is no "Worker added to roster" toast any more. R67 D-72
    // replaced every create screen's toast with a real navigation --
    // RosterCreateClient.tsx's onSuccess (:160-164) routes to the new
    // worker's own Object Page via createdHref(), so the real evidence of a
    // persisted write is landing on /labour/<id>, not a transient message.
    await page.waitForURL(/\/labour\/[^/?]+\?created=/);

    // Confirm the row exists back on the list from a fresh GET (not the
    // create screen's own optimistic state).
    const [rosterAfterAddRes] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/labour-roster") && r.request().method() === "GET"),
      page.goto(`/labour?projectId=${DEFAULT_PROJECT.id}`),
    ]);
    const rosterAfterAdd = (await rosterAfterAddRes.json()) as { roster: { name: string; trade: string | null }[] };
    expect(rosterAfterAdd.roster.length).toBe(rosterBefore.roster.length + 1);
    const createdWorker = rosterAfterAdd.roster.find((r) => r.name === workerName);
    expect(createdWorker?.trade).toBe("Mason");
    await expect(page.getByRole("row", { name: new RegExp(workerName) })).toBeVisible();

    // STALE: "Mark Attendance" used to open an inline form on the Attendance
    // tab. Same 2026-08-30 conversion routes it to /labour/attendance/new
    // (AttendanceCreateClient.tsx), reached the same way, through "+ New".
    await page.getByRole("tab", { name: "Attendance" }).click();
    await page.getByRole("button", { name: "+ New" }).click();
    const attendanceItem = page.getByRole("menuitem", { name: "Attendance", exact: true });
    // Enabled now that the roster is non-empty -- LabourClient.tsx:537 keys
    // createDisabledReasons.Attendance off `roster.length === 0`.
    await expect(attendanceItem).toBeEnabled();
    await attendanceItem.click();
    await page.waitForURL(/\/labour\/attendance\/new(\?|$)/);
    await expect(page.getByRole("heading", { level: 1, name: "Mark Attendance" })).toBeVisible();

    await fieldInput(page, "Worker").click();
    await page.getByRole("option", { name: workerName }).click();
    // STALE mechanism: Status used to be clicked open then picked via
    // getByRole('option'), matching a Radix-style listbox. CreateScreen.tsx:
    // 218-238 renders it as a plain native <select> -- Playwright's own
    // guidance for a native select is selectOption(), not click + role
    // option (the native popup isn't part of the page's a11y tree the way a
    // custom listbox is).
    await fieldInput(page, "Status").selectOption({ label: "Half Day" });
    // STALE: label was "Hours Worked (optional)" (with a space before the
    // parenthetical) -- CreateScreen.tsx:185 appends the "(optional)" marker
    // as a sibling <span> with no separating space, so the rendered text is
    // "Hours Worked(optional)"; the old literal string was never actually a
    // substring match even before Trade's required-ness changed. Matching on
    // the plain field name is correct either way (fieldInput() uses a
    // substring hasText match).
    await fieldInput(page, "Hours Worked").fill("4");

    // STALE: submit button read "Record" -- same shared archetype as the
    // roster form above, so it's "Save" here too (only Worker was missing).
    const [attRes] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/attendance") && r.request().method() === "POST"),
      page.getByRole("button", { name: "Save", exact: true }).click(),
    ]);
    expect(attRes.status(), await attRes.text().catch(() => "")).toBe(201);

    // STALE: no "Attendance recorded" toast either. AttendanceCreateClient.tsx's
    // onSuccess (:137-149) pushes a shell-chain receipt and replaces back to
    // the Attendance tab -- confirm by the URL landing and by the row itself.
    await page.waitForURL(/\/labour\?.*tab=attendance/);

    const attRow = page.getByRole("row", { name: new RegExp(workerName) });
    await expect(attRow).toBeVisible();
    await expect(attRow.getByText("half day")).toBeVisible();
  });
});
