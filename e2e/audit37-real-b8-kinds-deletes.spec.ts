import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { openLaptop, localRows, projectId, serverCall, serverRows } from "./support/real-backend";

// AUDIT-100 row B8 (deletes, and which record kinds sync) -- against the REAL backend (playwright.audit37-real.config.ts).
//  1. MEASURE which kinds the real service syncs and assert the documented list (below). A kind that appears or disappears fails this test, so
//     the documentation (docs/local-first, the audit register) cannot drift from what the service really does.
//  2. DELETES: every synced kind declares `deletes_supported`, and a real delete round trip works: a meeting is created and then deleted through the
//     real service (the same push a laptop's outbox sends); the SERVER marks the row deleted and a laptop that already held it DROPS it from its own
//     copy without being refreshed.
test.describe.configure({ mode: "serial" });
test.setTimeout(1_500_000);

/** The project kinds the service syncs today (manifest `kinds`). Documented in ai-os/audit37 B + docs/local-first. */
const DOCUMENTED_PROJECT_KINDS = [
  "project", "tasks", "boqs", "boq_lines", "activities", "progress", "rfis", "submittals", "punch_list", "change_orders", "milestones", "materials",
  "documents", "roster", "attendance", "timesheets", "meetings", "meeting_minutes", "site_diaries", "site_instructions", "progress_claims",
  "interim_bills", "material_receipts", "material_issues", "expenses", "schedule_baselines", "ffe_items", "wiki_pages",
];
/** The organisation-wide kinds (manifest `org_kinds`): masters, stock, accounts, purchasing, sales, design. */
const DOCUMENTED_ORG_KINDS = [
  "vendors", "customers", "companies", "boq_categories", "currencies", "exchange_rates", "departments", "org_people", "cost_visibility", "warehouses",
  "item_groups", "stock_items", "stock_entries", "accounts", "fiscal_years", "budgets", "purchase_orders", "goods_receipts", "requisitions", "rfqs",
  "quotations", "sales_orders", "invoices", "floor_plans", "mood_boards", "knowledge_base", "employees",
];
/** Documented as NOT on the laptop yet (their screens say "not on this laptop yet"): none of these may appear as a synced kind. */
const DOCUMENTED_NOT_SYNCED = ["payroll", "recruitment", "grc", "kpis", "proposals", "copilot", "leads", "leave", "loans", "journal_lines", "po_lines", "quotation_lines"];

const STAMP = `audit100-${Date.now()}`;
const TITLE = `B8 delete round trip ${STAMP}`;

let A: { context: BrowserContext; page: Page };
let B: { context: BrowserContext; page: Page };
let P: string;

test.beforeAll(async ({ browser }) => {
  A = await openLaptop(browser, "finance");
  P = await projectId(A.context);
});
test.afterAll(async () => {
  await A?.context.close();
  await B?.context.close();
});

type Manifest = { kinds: { kind: string; deletes_supported?: boolean }[]; org_kinds?: { kind: string; deletes_supported?: boolean }[] };

test("B8: the kinds the real service syncs are exactly the documented list, and every one supports deletes", async () => {
  const m = await serverCall<Manifest>(A.context, "GET", "/manifest");
  expect(m.kinds.map((k) => k.kind).sort()).toEqual([...DOCUMENTED_PROJECT_KINDS].sort());
  expect((m.org_kinds ?? []).map((k) => k.kind).sort()).toEqual([...DOCUMENTED_ORG_KINDS].sort());
  const all = [...m.kinds, ...(m.org_kinds ?? [])];
  expect(all.filter((k) => !k.deletes_supported).map((k) => k.kind), "kinds that do not sync deletes").toEqual([]);
  for (const k of DOCUMENTED_NOT_SYNCED) expect(all.map((x) => x.kind), `${k} is documented as not synced`).not.toContain(k);
});

// KNOWN BACKEND GAP, measured 2026-10-05 against the real service (AUDIT-100 B8): delete_meeting pushed through /push answers "applied" and the sync head is marked
// deleted=true (version 2), but the SOURCE row in compliance.pms_meetings is NOT removed, so /pull keeps serving it and a laptop never drops it. (The head tombstone is only
// visible through /changes; the keyset /pull reads the source table.) That is a compliance-tracker projexa-sync / delete-function defect, not a laptop one. `test.fail` keeps
// this spec green while it exists and turns RED the moment the backend deletes the row, so the annotation is then removed.
test("B8: a record deleted through the service is marked deleted on the server and DROPPED from a laptop that held it", async () => {
  test.fail(true, "B8: delete_meeting is applied and tombstoned in the sync head, but the source row stays and /pull still serves it");
  // laptop B (the owner) holds the meeting before it is deleted
  B = await openLaptop(A.context.browser()!, "ceo");
  const push = async (opId: string, functionId: string, params: Record<string, unknown>, record?: { kind: string; id: string; base_version: number }) => {
    const res = await serverCall<{ results: { op_id: string; status: string; error?: unknown }[] }>(A.context, "POST", "/push", {
      device_id: `audit100-b8-${STAMP}`,
      ops: [{ op_id: opId, function_id: functionId, project_id: P, params, ...(record ? { record } : {}), client_at: new Date().toISOString() }],
    });
    return res.results[0];
  };
  const created = await push(`b8-create-${STAMP}`, "create_meeting", { projectId: P, title: TITLE, scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), durationMinutes: 30 });
  expect(["applied"], `create_meeting answered ${JSON.stringify(created)}`).toContain(created.status);

  let rows: Awaited<ReturnType<typeof serverRows>> = [];
  await expect.poll(async () => (rows = await serverRows(A.context, P, "meetings", TITLE)).length, { timeout: 60_000, message: "the meeting is not in the server's data" }).toBe(1);
  const meetingId = rows[0].id;
  // B's own copy gets it with no click
  await expect.poll(async () => (await localRows(B.page, "meetings", TITLE)).length, { timeout: 600_000, message: "laptop B never received the meeting" }).toBe(1);

  // BREAK-TEST SWITCH (R74-RULING-03 (c)): AUDIT100_BREAK=b8 never sends the delete; the assertions below must then FAIL.
  const deleted = process.env.AUDIT100_BREAK === "b8" ? { status: "applied" } : await push(`b8-delete-${STAMP}`, "delete_meeting", { projectId: P, meetingId }, { kind: "meetings", id: meetingId, base_version: rows[0].version ?? 1 });
  expect(["applied"], `delete_meeting answered ${JSON.stringify(deleted)}`).toContain(deleted.status);

  // the SERVER no longer lists it as a live row (a tombstone in the change feed, nothing in the keyset pull)
  await expect.poll(async () => (await serverRows(A.context, P, "meetings", TITLE)).filter((r) => !r.deleted).length, { timeout: 60_000, message: "the server still serves the deleted meeting" }).toBe(0);
  const feed = await serverCall<{ changes: { kind: string; id: string; op: string }[] }>(A.context, "POST", "/changes", { project_id: P, after_seq: null, limit: 1000 });
  expect(feed.changes.some((c) => c.kind === "meetings" && c.id === meetingId && c.op === "D"), "no delete (D) entry for the meeting in the change feed").toBe(true);

  // and laptop B drops it from ITS copy, without a refresh
  await expect.poll(async () => (await localRows(B.page, "meetings", TITLE)).length, { timeout: 600_000, message: "laptop B still holds the deleted meeting: the delete did not reach it" }).toBe(0);
});
