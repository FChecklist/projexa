import { test, expect } from "@playwright/test";
import { DEFAULT_PROJECT } from "./helpers";

// PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION
// SUCCESS_CRITERIA: "entering progress data with the network disabled
// queues it locally; re-enabling network triggers a real sync that lands
// the data server-side."
//
// NOT YET RUN against the live site at authoring time: projexa-ai.com/login
// currently serves compliance-tracker's own login UI instead of PROJEXA's
// (a pre-existing prod deployment issue, first documented in the
// immediately-prior PR's PROGRESS.md/ai-os/PIVOT_CHART_TECH_DECISION doc,
// re-confirmed live during this task via a direct curl of /login). That
// blocks auth.setup.ts's real login flow for every spec in this suite, not
// just this one. This file is the real, durable artifact -- it will run
// correctly once that routing issue is fixed and this PR's offline-queue
// code is deployed. In the meantime, the real work-progress-queue.ts
// module (enqueue/sync/retry logic) is unit-tested directly against a real
// IndexedDB in src/lib/offline/work-progress-queue.test.ts -- see that
// file's header for why that's a genuine substitute, not a weaker stand-in.
//
// STALENESS FIX (this pass): the mechanism below was written against a
// dialog-based "Log Progress" flow that does not exist in the current
// source. The Daily Entry tab is a fixed two-pane layout -- the entries
// table on the left, WorkProgressFormClient mounted INLINE on the right,
// with no button/dialog between them
// (src/components/WorkProgressPageClient.tsx:134-165). Concretely, against
// the real source:
//   * No getByRole('dialog') anywhere in this module -- the form is
//     FormScreen's own full pane, always on screen
//     (src/components/WorkProgressFormClient.tsx:467-649).
//   * Field labels are real htmlFor/id pairs for Activity, Date, Quantity
//     done, % complete and Entry basis (form-field.tsx's R52 fix, wired
//     through this form's `(props) => ...` render props) -- so
//     page.getByLabel(...) resolves them directly; helpers.ts's fieldByLabel
//     xpath-sibling workaround (written for the older no-htmlFor pattern)
//     isn't needed here and isn't used below. Labels are sentence-cased on
//     screen ("Quantity done", "% complete"), not Title Case.
//   * DEFAULT_PROJECT (Meridian Heights) is seeded with an approved BOQ
//     (scripts/phase1-seed-compliance-tracker-batch1.mjs:255-277), which
//     makes BOTH Activity and BOQ line item REQUIRED on this project
//     (src/lib/work-progress-form-fields.ts's requiredProgressFields()) --
//     the original test filled neither, which would leave "Log Entry"
//     permanently disabled and the whole scenario unrunnable regardless of
//     the dialog/page question.
//   * The offline indicator is a plain running-count banner ("N entries
//     queued on this device, will sync automatically.",
//     WorkProgressFormClient.tsx:459-465), not a testid'd queue widget with
//     a per-entry breakdown -- there is no per-entry "7 qty, 55%" line
//     anywhere in the real UI, so that assertion is replaced with the
//     persistent "You're offline" message the same submit path sets
//     (WorkProgressFormClient.tsx:401-404) plus the real count banner.
// No data-testid attributes exist anywhere in this module or its offline
// queue (grepped src/components/WorkProgressFormClient.tsx and
// src/lib/offline/work-progress-queue.ts for "work-progress-submit" /
// "work-progress-queue" -- zero matches); every locator below is real
// text/role/label evidence read from current source, not invented.
test.use({ storageState: "playwright/.auth/siteSupervisor.json" });

test.describe("offline work-progress capture + sync", () => {
  test("logging progress while offline queues it locally; reconnecting syncs it server-side", async ({ page, context }) => {
    // WorkProgressPageClient's Daily Entry tab fetches its two reads
    // (entries, activities) client-side after mount -- same race
    // helpers.ts's gotoAndCapture() exists for, applied manually here since
    // two distinct endpoints need to have landed before the form's Activity
    // picker and the baseline row count are both trustworthy
    // (src/lib/work-progress-reads.ts:128-153).
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/work-progress/activities") && r.request().method() === "GET"),
      page.waitForResponse((r) => r.url().includes("/api/work-progress?") && r.request().method() === "GET"),
      page.goto(`/work-progress?projectId=${DEFAULT_PROJECT.id}`),
    ]);

    // Real, current DOM fact: PageHeading renders <h1>Work Progress</h1>
    // with no `project`/`context` prop here (src/app/(app)/work-progress/
    // page.tsx:134), so its accessible name is the bare string -- but
    // FormScreen ALSO renders an <h1>, "Log Work Progress"
    // (WorkProgressFormClient.tsx:470, node_modules/@fchecklist/
    // veridian-ui-kit/src/screens/FormScreen.tsx:71), now that the form is
    // inline instead of inside a not-yet-opened dialog. Playwright's
    // role-name matching is substring by default, so an unscoped
    // name: "Work Progress" matches BOTH level-1 headings and throws a
    // strict-mode violation; exact: true is required to hit only the page's
    // own heading.
    await expect(page.getByRole("heading", { level: 1, name: "Work Progress", exact: true })).toBeVisible();

    const beforeCount = await page.locator("table tbody tr").count();

    // Activity: a real shadcn/Radix Select with a correctly htmlFor'd label
    // (WorkProgressFormClient.tsx:489-500) -- required always, and required
    // here specifically because Meridian Heights has a BOQ (see header note).
    await page.getByLabel("Activity").click();
    await page.getByRole("option").first().click();

    // BOQ line item: the one field on this form whose FormField render prop
    // drops `props` (WorkProgressFormClient.tsx:549, `{() => (...)}` rather
    // than `{(props) => (...)}` for every other field), so the label's
    // htmlFor points at an id no control in the DOM actually carries --
    // page.getByLabel("BOQ line item") finds nothing here, a real (if minor)
    // accessibility gap, not a stale assumption; see suspectedRealBugs. The
    // control itself is BoqLinePicker's SearchSelect, which carries its own
    // fixed aria-label of "BOQ line" regardless of the FormField's visible
    // text (BoqLinePicker.tsx:27, SearchSelect.tsx:129-130) -- selectable by
    // role+name on that instead. Seed data has no BOQ line hierarchy
    // (scripts/phase1-seed-compliance-tracker-batch1.mjs:253-277 inserts a
    // flat list, no parent/child), so every option here is expected
    // selectable; disabled: false is kept anyway in case a parent line is
    // ever introduced upstream.
    await page.getByRole("combobox", { name: "BOQ line" }).click();
    await page.getByRole("option", { disabled: false }).first().click();

    await page.getByLabel("Quantity done").fill("7");
    await page.getByLabel("% complete").fill("55");

    // Confirms the four fills above actually satisfied every required field
    // (Date and Entry basis are pre-filled -- todayIso() / "DELTA" --
    // WorkProgressFormClient.tsx:138) before the offline branch is
    // exercised; the button's own text is "Log Entry", not "Log Progress"
    // (src/lib/work-progress-form-fields.ts's submitLabelFor()).
    await expect(page.getByRole("button", { name: "Log Entry", exact: true })).toBeEnabled();

    await context.setOffline(true);

    await page.getByRole("button", { name: "Log Entry", exact: true }).click();

    // Real, visible "queued, will sync" state -- not a silent failure. Two
    // independent pieces of real evidence for it: the persistent message
    // FormScreen renders through MessageArea (role="status",
    // node_modules/@fchecklist/veridian-ui-kit/src/screens/parts/
    // MessageArea.tsx), set verbatim by handleSubmit's offline branch
    // (WorkProgressFormClient.tsx:401-404); and the queued-count banner
    // above the fields (WorkProgressFormClient.tsx:459-465). Neither is the
    // testid'd "work-progress-queue"/"work-progress-queue-item" pair or the
    // "7 qty, 55%" per-entry line this test used to look for -- the real UI
    // has no per-entry queue list, only a running count.
    await expect(page.getByText("You're offline -- progress saved on this device, will sync automatically")).toBeVisible();
    await expect(page.getByText("1 entry queued on this device, will sync automatically.")).toBeVisible();

    // The real entries table is unchanged -- nothing landed server-side yet.
    await expect(page.locator("table tbody tr")).toHaveCount(beforeCount);

    await context.setOffline(false);
    // The queue's own `online` event listener drains it -- no manual
    // action from the user required (WorkProgressFormClient.tsx:414-420).
    await expect(page.getByText("1 entry queued on this device, will sync automatically.")).toBeHidden({ timeout: 20_000 });

    await page.reload();
    await expect(page.locator("table tbody tr")).toHaveCount(beforeCount + 1);
    await expect(page.locator("table tbody tr").filter({ hasText: "55%" })).toHaveCount(1);
  });
});
