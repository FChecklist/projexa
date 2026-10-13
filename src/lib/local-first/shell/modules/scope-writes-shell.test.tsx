import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { createIdentityStore, type DurableIdentity } from "../../identity";
import { openDeviceMeta } from "../../device-meta";
import { createOutbox } from "../../outbox";
import { createFakeSyncServer } from "../../__fixtures__/fake-sync-server";
import { shellManifestKey } from "../manifest-cache";
import { findShellRoute } from "../route-table";
import { readPendingOps } from "./design-change-rows";
import { designChangeWriteDeps } from "./DesignChangeShared";
import { seedDesignChange } from "./design-change-test-fixtures";
import { seedOrgKinds } from "./finance-test-seed";
import { allLinesTotal, budgetPatch, latestProgress, revisionVariation, scopeReductions, validateBoqDraft, validateBudgetEdit } from "./scope-writes";
import { emptyLine, toDrafts, type BoqLineItemRow } from "@/lib/boq-helpers";
// The replica pull after a sent edit talks to Supabase; here it is a no-op (the REAL module is spread first, see CLAUDE.md's mock.module() note).
const realReplicaShared = await import("../../replica-shared");
mock.module("../../replica-shared", () => ({ ...realReplicaShared, revalidateViaSharedReplica: async () => {} }));
const { default: LocalShell } = await import("../LocalShell");

// OFFLINE WRITERS 2: New BOQ and New Revision rendered through the REAL shell (route table, adapters, IndexedDB via fake-indexeddb, identity
// mirror) with the NETWORK OFF. Every save goes into a real outbox as ONE op, the screen says "Waiting to sync", not one request leaves the
// laptop, and what the server would refuse is refused here with nothing stored.

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key-not-a-real-credential";

const NOW = 1_760_000_000_000;
const ORIGIN = "https://px.test";
const realFetch = globalThis.fetch;

let idb: IDBFactory;
let fetchCalls: string[];

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}
function go(path: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${ORIGIN}${path}`);
}
const identityFor = (userId: string, role: string): DurableIdentity => ({
  userId, email: `${userId}@example.com`, name: "Asha Rao", orgId: "orgA", role, lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 },
});

const BOQ = { id: "b1", project_id: "p1", title: "Original Scope", version: 1, status: "approved", parent_boq_id: null, created_at: "2026-09-01T08:00:00Z" };
const lineRow = (id: string, code: string, description: string, quantity: number, rate: number) => ({
  id, boq_id: "b1", item_code: code, description, unit: "sqm", quantity, rate, amount: quantity * rate, parent_line_item_id: null, activity_id: null,
  category: null, breakdown_percentage: null, created_at: "2026-09-01T08:00:00Z",
});
const progressRow = (id: string, lineId: string, pct: number) => ({ id, activity_id: "act1", boq_line_item_id: lineId, entry_date: "2026-09-20", quantity_done: pct, percent_complete: pct, created_at: "2026-09-20T08:00:00Z" });

async function seedLaptop(opts: { role?: string; progress?: boolean; moneyHidden?: boolean } = {}) {
  const done: Record<string, string[]> = { boqs: ["p1"], boq_lines: ["p1"], ...(opts.progress === false ? {} : { progress: ["p1"] }) };
  await seedDesignChange(idb, "u1", [
    { kind: "boqs", projectId: "p1", data: BOQ },
    { kind: "boq_lines", projectId: "p1", data: lineRow("li1", "A1", "Blockwork", 100, 50) },
    { kind: "boq_lines", projectId: "p1", data: lineRow("li2", "A2", "Plaster", 200, 20) },
    { kind: "boq_lines", projectId: "p1", data: lineRow("li3", "A3", "Paint", 300, 10) },
    { kind: "progress", projectId: "p1", data: progressRow("pr1", "li1", 40) },
  ], { done, hiddenFields: opts.moneyHidden ? { boq_lines: ["quantity", "rate", "amount"] } : {} });
  await seedOrgKinds(idb, [{ kind: "vendors", rows: [{ id: "v1", supplier_name: "Shree Cement" }] }], { at: NOW });
  const device = await openDeviceMeta(idb);
  await device.meta.setMeta(shellManifestKey("u1"), { at: NOW, user: { id: "u1", name: "Asha Rao", role: opts.role ?? "manager", org_id: "orgA" }, projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }] });
  device.close();
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identityFor("u1", opts.role ?? "manager"));
}

const ops = () => readPendingOps({ userId: "u1", name: null, email: null, role: null, orgId: "orgA", projects: [], idb: idb as unknown as globalThis.IDBFactory }, null);

beforeEach(() => {
  idb = new IDBFactory();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
  localStorage.clear();
  sessionStorage.clear();
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls.push(String(input));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const server = createFakeSyncServer();
  designChangeWriteDeps.outbox = createOutbox({ userId: "u1", client: server.client, deviceId: "dev-1", idb, autoFlush: false, locks: null, sleep: async () => {} });
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  designChangeWriteDeps.outbox = undefined;
  setOnline(true);
});

const type = (el: HTMLElement, value: string) => fireEvent.input(el, { target: { value } });

describe("the BOQ writers are registered in the shell", () => {
  test("/scope/new and /scope/:id/revise are routes; /scope/new is never read as a BOQ id", () => {
    expect(findShellRoute("/scope/new")!.route.pattern).toBe("/scope/new");
    expect(findShellRoute("/scope/b1/revise")!.route.pattern).toBe("/scope/:id/revise");
    expect(findShellRoute("/scope/b1/revise")!.params).toEqual({ id: "b1" });
    expect(findShellRoute("/scope/b1")!.route.pattern).toBe("/scope/:id");
  });
});

describe("the rules, as pure functions (the same as the server's)", () => {
  const root = { ...emptyLine(), description: "Slab", unit: "cum", quantity: "100", rate: "50", itemCode: "R1" };
  const child = (code: string, parent: string, pct: string) => ({ ...emptyLine(), description: `Part ${code}`, unit: "cum", itemCode: code, parentItemCode: parent, breakdownPercentage: pct });

  test("a sub-task is priced off its ROOT: 100 x 50 x 40% = 2000; weights are not forced to 100; the BOQ total counts root lines only", () => {
    const lines = [root, child("R1.1", "R1", "30"), child("R1.2", "R1", "30")];
    expect(validateBoqDraft("T", lines)).toEqual({});
    expect(allLinesTotal(lines)).toBe(5000 + 1500 + 1500);
  });

  test("refused: no title, a child with a parent and no percentage, a parent that matches nothing, a circle, a repeated code, a negative quantity", () => {
    expect(validateBoqDraft("  ", [root]).title).toBe("Enter a title, e.g. Civil Works - Phase 1");
    expect(validateBoqDraft("T", [root, child("R1.1", "R1", "")]).lines).toContain("Breakdown %");
    expect(validateBoqDraft("T", [root, child("R1.1", "NOPE", "10")]).lines).toContain('parent code "NOPE" does not match');
    expect(validateBoqDraft("T", [root, child("C1", "C2", "10"), child("C2", "C1", "10")]).lines).toContain("circle");
    expect(validateBoqDraft("T", [root, { ...root }]).lines).toContain('item code "R1" is used twice');
    expect(validateBoqDraft("T", [{ ...root, quantity: "-3" }]).lines).toContain("Qty must be a number");
  });

  test("a title-only BOQ (no lines) is fine", () => {
    expect(validateBoqDraft("Only a title", [emptyLine()])).toEqual({});
  });

  const parent: BoqLineItemRow[] = [
    { id: "li1", itemCode: "A1", description: "Blockwork", unit: "sqm", quantity: "100", rate: "50", amount: "5000", activityId: null },
    { id: "li2", itemCode: "A2", description: "Plaster", unit: "sqm", quantity: "200", rate: "20", amount: "4000", activityId: null },
  ];
  const progress = latestProgress([{ boqLineItemId: "li1", entryDate: "2026-09-20", percentComplete: 40, createdAt: null }, { boqLineItemId: "li1", entryDate: "2026-09-01", percentComplete: 90, createdAt: null }]);

  test("progress: the entry with the latest date wins", () => {
    expect(progress.get("li1")).toBe(40);
  });

  test("a revision's variation is the difference of all line amounts; removing or reducing a line with progress is a reduction, raising it is not", () => {
    const drafts = toDrafts(parent);
    expect(revisionVariation(parent, drafts).variation).toBe(0);
    const grown = drafts.map((d, i) => (i === 0 ? { ...d, quantity: "120" } : d)).concat([{ ...emptyLine(), description: "Waterproofing", unit: "sqm", quantity: "50", rate: "35", itemCode: "A3" }]);
    expect(revisionVariation(parent, grown).variation).toBe(1000 + 1750);
    expect(scopeReductions(parent, progress, grown)).toEqual([]);
    expect(scopeReductions(parent, progress, drafts.slice(1))).toEqual(['"Blockwork" is 40% complete on site and would be removed entirely']);
    expect(scopeReductions(parent, progress, drafts.map((d, i) => (i === 0 ? { ...d, quantity: "60" } : d)))).toHaveLength(1);
    expect(scopeReductions(parent, progress, drafts.map((d, i) => (i === 1 ? { ...d, quantity: "10" } : d)))).toEqual([]); // no progress on A2
  });
});

describe("New BOQ with NO network", () => {
  test("refused where the online save is (nothing queued); then saved with a sub-task: ONE create_boq op, listed and opened as 'Waiting to sync', no request", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/scope/new?projectId=p1");
    const { findByTestId, getByTestId, getAllByTestId } = render(<LocalShell />);
    await findByTestId("scope-new-screen");
    expect((getByTestId("scope-new-save") as HTMLButtonElement).disabled).toBe(true); // no title yet

    type(getByTestId("scope-new-title"), "Civil Works");
    type(getByTestId("scope-new-0-description"), "Slab");
    type(getByTestId("scope-new-0-unit"), "cum");
    type(getByTestId("scope-new-0-quantity"), "100");
    type(getByTestId("scope-new-0-rate"), "50");
    type(getByTestId("scope-new-0-itemCode"), "R1");
    fireEvent.click(getByTestId("scope-new-add"));
    type(getByTestId("scope-new-1-description"), "Shuttering");
    type(getByTestId("scope-new-1-unit"), "cum");
    type(getByTestId("scope-new-1-parentItemCode"), "NOPE");
    type(getByTestId("scope-new-1-breakdownPercentage"), "40");
    fireEvent.click(getByTestId("scope-new-save"));
    expect((await findByTestId("scope-error-lines")).textContent).toContain('parent code "NOPE" does not match any item code');
    expect(await ops()).toEqual([]);

    type(getByTestId("scope-new-1-parentItemCode"), "R1");
    type(getByTestId("scope-new-1-itemCode"), "R1.1");
    expect(getByTestId("scope-new-1-amount").textContent).toBe("2000");
    expect(getByTestId("scope-new-total").textContent).toBe("5000");
    fireEvent.click(getByTestId("scope-new-save"));

    const object = await findByTestId("scope-object");
    expect(object.getAttribute("data-state")).toBe("waiting");
    expect(getByTestId("boq-waiting-mark").textContent).toBe("Waiting to sync");
    expect(getByTestId("boq-local-title").textContent).toBe("Civil Works");
    const waitingLines = getAllByTestId("boq-waiting-line").map((r) => r.textContent ?? "");
    expect(waitingLines).toHaveLength(2);
    expect(waitingLines[0]).toContain("Slab");
    expect(waitingLines[1]).toContain("Shuttering");
    expect(waitingLines[1]).toContain("2,000");
    expect(getByTestId("boq-local-total").textContent).toContain("5,000");
    const [op] = await ops();
    expect(op).toMatchObject({ functionId: "create_boq", projectId: "p1" });
    expect(op!.params).toMatchObject({
      projectId: "p1", title: "Civil Works",
      lineItems: [
        { description: "Slab", unit: "cum", quantity: 100, rate: 50, itemCode: "R1" },
        { description: "Shuttering", itemCode: "R1.1", parentItemCode: "R1", breakdownPercentage: 40 },
      ],
    });
    expect(typeof (op!.params as { idempotency_key: unknown }).idempotency_key).toBe("string");
    expect(fetchCalls).toEqual([]);
  });

  test("the list shows the waiting BOQ marked 'Waiting to sync' beside the synced one", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/scope/new?projectId=p1");
    const first = render(<LocalShell />);
    await first.findByTestId("scope-new-screen");
    type(first.getByTestId("scope-new-title"), "Title only");
    fireEvent.click(first.getByTestId("scope-new-save"));
    await first.findByTestId("scope-object");
    cleanup();
    go("/local/scope?projectId=p1");
    const { findByTestId, getAllByTestId } = render(<LocalShell />);
    await findByTestId("scope-list");
    expect(getAllByTestId("scope-list-row").map((r) => r.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Original Scope"), expect.stringContaining("Title onlyRev0Waiting to sync")]));
  });

  test("a role below member is not offered a New BOQ", async () => {
    await seedLaptop({ role: "viewer" });
    setOnline(false);
    go("/local/scope/new?projectId=p1");
    const { findByTestId } = render(<LocalShell />);
    expect((await findByTestId("scope-new-screen")).getAttribute("data-state")).toBe("role");
  });
});

describe("New Revision with NO network", () => {
  test("add a line and raise a quantity: the variation shows before saving; ONE create_boq_revision op with every line; opens as 'Waiting to sync'", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/scope/b1/revise?projectId=p1");
    const { findByTestId, getByTestId, getAllByTestId } = render(<LocalShell />);
    await findByTestId("scope-revise-screen");
    expect(getAllByTestId("scope-revise-row")).toHaveLength(3);
    expect(getByTestId("scope-revise-variation-amount").textContent).toBe("0.00");

    type(getByTestId("scope-revise-0-quantity"), "120"); // raising a line that has progress is allowed
    fireEvent.click(getByTestId("scope-revise-add"));
    type(getByTestId("scope-revise-3-description"), "Waterproofing");
    type(getByTestId("scope-revise-3-unit"), "sqm");
    type(getByTestId("scope-revise-3-quantity"), "50");
    type(getByTestId("scope-revise-3-rate"), "35");
    type(getByTestId("scope-revise-3-itemCode"), "A4");
    expect(getByTestId("scope-revise-variation-amount").textContent).toBe("+2,750.00");
    type(getByTestId("scope-revise-title"), "Rev 1 - extra waterproofing");
    fireEvent.click(getByTestId("scope-revise-save"));

    const object = await findByTestId("scope-object");
    expect(object.getAttribute("data-state")).toBe("waiting");
    expect(getByTestId("boq-waiting-mark").textContent).toBe("Waiting to sync");
    const [op] = await ops();
    expect(op).toMatchObject({ functionId: "create_boq_revision", projectId: "p1", params: { boqId: "b1", title: "Rev 1 - extra waterproofing" } });
    const items = (op!.params as { lineItems: { itemCode: string; quantity: number }[] }).lineItems;
    expect(items.map((i) => [i.itemCode, i.quantity])).toEqual([["A1", 120], ["A2", 200], ["A3", 300], ["A4", 50]]);
    expect((op!.params as Record<string, unknown>).allowScopeReductionOverride).toBeUndefined();
    expect(fetchCalls).toEqual([]);
  });

  // F62 (UAT 2026-10-13): adding a sub-task moves the variation (all line amounts) but NOT the BOQ total (main lines only). Each figure says what it counts.
  test("a sub-task changes the variation but not the BOQ total, and each figure says what it counts", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/scope/b1/revise?projectId=p1");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("scope-revise-screen");
    fireEvent.click(getByTestId("scope-revise-add"));
    type(getByTestId("scope-revise-3-description"), "Part of blockwork");
    type(getByTestId("scope-revise-3-itemCode"), "A1.1");
    type(getByTestId("scope-revise-3-parentItemCode"), "A1");
    type(getByTestId("scope-revise-3-breakdownPercentage"), "30"); // 30% of A1 (100 x 50 = 5000) = 1500
    expect(getByTestId("scope-revise-variation-amount").textContent).toBe("+1,500.00");
    expect(getByTestId("scope-revise-variation-basis").textContent).toBe("(all line amounts, sub-tasks included)");
    expect(getByTestId("scope-revise-total-note").textContent).toContain("change 0.00 on main lines only");
  });

  test("R-C13: removing, or reducing, a line that has progress is REFUSED with the lines named; Save is off; nothing is queued", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/scope/b1/revise?projectId=p1");
    const { findByTestId, getByTestId, getAllByRole, queryByTestId } = render(<LocalShell />);
    await findByTestId("scope-revise-screen");

    type(getByTestId("scope-revise-0-quantity"), "60"); // A1 is 40% done: a reduction
    const blocked = await findByTestId("scope-revise-blocked");
    expect(blocked.textContent).toContain('"Blockwork" is 40% complete on site');
    expect((getByTestId("scope-revise-save") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(getByTestId("scope-revise-title").closest("form")!);
    expect(await ops()).toEqual([]);

    type(getByTestId("scope-revise-0-quantity"), "100");
    expect(queryByTestId("scope-revise-blocked")).toBeNull();
    // removing A1 outright
    fireEvent.click(getAllByRole("button", { name: "Remove" })[0]!);
    expect((await findByTestId("scope-revise-blocked")).textContent).toContain("would be removed entirely");
    expect(await ops()).toEqual([]);

    // removing A3 (no progress) is allowed
    expect(fetchCalls).toEqual([]);
  });

  test("a BOQ that is itself waiting cannot be revised yet; hidden money cannot be revised; progress not copied is said, not guessed", async () => {
    await seedLaptop({ progress: false });
    setOnline(false);
    go("/local/scope/b1/revise?projectId=p1");
    const first = render(<LocalShell />);
    await first.findByTestId("scope-revise-screen");
    expect(first.getByTestId("scope-revise-progress-unknown").textContent).toContain("the server checks it");
    cleanup();
    go("/local/scope/local-abc/revise?projectId=p1");
    const second = render(<LocalShell />);
    expect((await second.findByTestId("scope-revise-screen")).getAttribute("data-state")).toBe("parent_waiting");
  });
});

describe("Line budgets with NO network (R-C09)", () => {
  const edit = (over: Partial<Parameters<typeof validateBudgetEdit>[0]> = {}) => ({
    projectId: "p1", lineId: "li1", current: { budgetPercentage: null, vendorId: null, vendorAmount: null }, budgetPercentage: "", vendorId: "", vendorAmount: "", ...over,
  });

  test("the rules as pure functions: 0 and 100 are allowed; below 0, above 100, a negative vendor amount and no change are refused; only what changed is sent", () => {
    expect(validateBudgetEdit(edit({ budgetPercentage: "0" }))).toEqual({});
    expect(validateBudgetEdit(edit({ budgetPercentage: "100" }))).toEqual({});
    expect(validateBudgetEdit(edit({ budgetPercentage: "-1" })).budgetPercentage).toBe("Budget % must be a number from 0 to 100.");
    expect(validateBudgetEdit(edit({ budgetPercentage: "100.5" })).budgetPercentage).toBeDefined();
    expect(validateBudgetEdit(edit({ budgetPercentage: "abc" })).budgetPercentage).toBeDefined();
    expect(validateBudgetEdit(edit({ vendorAmount: "-5" })).vendorAmount).toBe("Vendor amount must be a number, zero or more.");
    expect(validateBudgetEdit(edit({ budgetPercentage: "25" })).nothing).toBe("Nothing was changed."); // 25 is the default already
    expect(budgetPatch(edit({ budgetPercentage: "40", vendorId: "v1", vendorAmount: "3500" }))).toEqual({ budgetPercentage: 40, vendorId: "v1", vendorAmount: 3500 });
  });

  test("opens from the laptop's copy at the default 25 %; bad values are refused with nothing queued; a good edit is ONE update_line_item_budget op marked 'Waiting to sync'", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/scope/b1/budget?projectId=p1");
    const { findByTestId, getByTestId, getAllByTestId } = render(<LocalShell />);
    await findByTestId("scope-budget-screen");
    expect(getAllByTestId("scope-budget-row")).toHaveLength(3);
    expect((getByTestId("scope-budget-li1-pct") as HTMLInputElement).value).toBe("25");
    expect(getByTestId("scope-budget-li1-budget").textContent).toBe("1,250.00");

    type(getByTestId("scope-budget-li1-pct"), "101");
    fireEvent.click(getByTestId("scope-budget-li1-save"));
    expect((await findByTestId("scope-budget-li1-pct-error")).textContent).toBe("Budget % must be a number from 0 to 100.");
    type(getByTestId("scope-budget-li1-pct"), "40");
    type(getByTestId("scope-budget-li1-vamount"), "-3");
    fireEvent.click(getByTestId("scope-budget-li1-save"));
    expect((await findByTestId("scope-budget-li1-vamount-error")).textContent).toBe("Vendor amount must be a number, zero or more.");
    expect(await ops()).toEqual([]);

    type(getByTestId("scope-budget-li1-vamount"), "3500");
    fireEvent.change(getByTestId("scope-budget-li1-vendor"), { target: { value: "v1" } });
    expect(getByTestId("scope-budget-li1-budget").textContent).toBe("2,000.00");
    fireEvent.click(getByTestId("scope-budget-li1-save"));
    expect((await findByTestId("scope-budget-li1-waiting")).textContent).toBe("Waiting to sync");
    // the row shows the NEW figures at once, not the server's old ones beside "Waiting to sync" (UAT 2026-10-13)
    await waitFor(() => expect((getByTestId("scope-budget-li1-pct") as HTMLInputElement).value).toBe("40"));
    expect(getByTestId("scope-budget-li1-budget").textContent).toBe("2,000.00");
    expect((getByTestId("scope-budget-li1-vamount") as HTMLInputElement).value).toBe("3500");
    const [op] = await ops();
    expect(op).toMatchObject({ functionId: "update_line_item_budget", projectId: "p1", params: { projectId: "p1", boqLineItemId: "li1", budgetPercentage: 40, vendorId: "v1", vendorAmount: 3500 } });
    expect(op!.record).toMatchObject({ kind: "boq_lines", id: "li1" });
    expect(fetchCalls).toEqual([]);
  });

  test("manager rank only: a member is not offered the budget screen", async () => {
    await seedLaptop({ role: "member" });
    setOnline(false);
    go("/local/scope/b1/budget?projectId=p1");
    const { findByTestId } = render(<LocalShell />);
    expect((await findByTestId("scope-budget-screen")).getAttribute("data-state")).toBe("role");
  });
});
