import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY, doneKey } from "../../replica";
import { ORG_PROJECT } from "../../sync-client";
import { seedPerson, shellData } from "./documents-test-fixtures";
import { loadFfeItem, loadFfeItems, loadDiaries, loadPunchList, loadRfi, loadRfis, loadSubmittals, toLocalFfeItem, toLocalRfi } from "./site-records";
import { loadFfeItemWithVendor } from "./ffe-adapter";
import { loadVendor, loadVendors, toLocalVendor } from "./vendors-adapter";

// Rows have EXACTLY the shape the sync service sends (compliance-tracker drizzle/0643: snake_case, money NULL when hidden).
const rfi = (id: string, over: Record<string, unknown> = {}) => ({
  id, number: Number(id.slice(-1)), subject: `Subject ${id}`, question: "Is the lintel 150 or 200?", status: "open", ball_in_court: "architect",
  due_date: "2026-05-01", answer: null, created_at: "2026-04-01T08:00:00Z", ...over,
});
const ffe = (id: string, over: Record<string, unknown> = {}) => ({
  id, item_name: `Chair ${id}`, room_or_area: "Lobby", category: "furniture", quantity: "4", status: "specified", lead_time_days: 21, unit_cost: "1200.50", unit_price: 1800, vendor_id: "ven-1", ...over,
});
const none: ReadonlySet<string> = new Set();
const ctx = { hidden: none, waiting: none };

describe("replica rows are untrusted input", () => {
  test("an RFI needs an id and a subject; wrong types become null, never coerced", () => {
    expect(toLocalRfi({ id: "r1" }, ctx)).toBeNull();
    expect(toLocalRfi([], ctx)).toBeNull();
    const r = toLocalRfi(rfi("r1", { number: "x", due_date: 7, status: 3 }), ctx)!;
    expect([r.number, r.dueDate, r.status]).toEqual([null, null, null]);
    expect(toLocalRfi(rfi("r2"), ctx)).toMatchObject({ id: "r2", number: 2, subject: "Subject r2", dueDate: "2026-05-01", waiting: false });
  });
  test("a field the role may not see is dropped even if a stale row still carries it", () => {
    expect(toLocalRfi(rfi("r1", { answer: "secret" }), { hidden: new Set(["answer"]), waiting: none })!.answer).toBeNull();
  });
  test("FF&E money: numbers and numeric text are read; hidden cost is null AND flagged, even when the row still carries it", () => {
    const shown = toLocalFfeItem(ffe("f1"), ctx)!;
    expect([shown.unitCost, shown.unitPrice, shown.quantity, shown.costHidden]).toEqual([1200.5, 1800, 4, false]);
    const hidden = toLocalFfeItem(ffe("f1"), { hidden: new Set(["unit_cost", "unit_price", "vendor_id"]), waiting: none })!;
    expect([hidden.unitCost, hidden.unitPrice, hidden.vendorId, hidden.costHidden, hidden.vendorHidden]).toEqual([null, null, null, true, true]);
    expect(toLocalFfeItem(ffe("f1", { unit_cost: "abc" }), ctx)!.unitCost).toBeNull();
  });
});

describe("lists and objects read from the laptop", () => {
  test("RFIs: by number, junk skipped; waiting marks a temp row and a dirty row", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [
      { projectId: "p1", data: rfi("r3") }, { projectId: "p1", data: rfi("r1") }, { projectId: "p1", data: { id: "junk" } },
      { projectId: "p1", data: rfi("local-9", { number: null }) }, { projectId: "p1", data: rfi("r2"), dirty: "op-1" },
    ], { kinds: ["rfis"] });
    const r = await loadRfis(shellData(idb), "p1");
    if (r.state !== "local") throw new Error(r.state);
    expect(r.rows.map((x) => x.id)).toEqual(["r1", "r2", "r3", "local-9"]);
    expect(r.rows.map((x) => x.waiting)).toEqual([false, true, false, true]);
  });
  test("states: no project, not synced, another person's database, wrong kind", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [{ projectId: "p1", data: rfi("r1") }], { kinds: ["rfis"] });
    expect(await loadRfis(shellData(idb), null)).toEqual({ state: "no_project" });
    expect(await loadRfis(shellData(idb), "p2")).toEqual({ state: "not_synced", projectId: "p2" });
    expect(await loadRfis(shellData(idb, "u2"), "p1")).toEqual({ state: "not_synced", projectId: "p1" });
    expect(await loadSubmittals(shellData(idb), "p1")).toEqual({ state: "not_synced", projectId: "p1" });
    expect(await loadRfi(shellData(idb), "nope", "p1")).toEqual({ state: "not_found", projectId: "p1" });
  });
  test("an object is found across the person's projects without ?projectId=", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [{ projectId: "p2", data: rfi("r5") }], { kinds: ["rfis"], done: ["p1", "p2"] });
    const r = await loadRfi(shellData(idb), "r5", null);
    expect(r.state === "local" && r.projectId).toBe("p2");
  });
  test("punch list, diaries (latest day first) and FF&E (by name)", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [
      { projectId: "p1", kind: "punch_list", data: { id: "x1", number: 2, description: "Paint touch-up", status: "open", priority: "high" } },
      { projectId: "p1", kind: "punch_list", data: { id: "x2", number: 1, description: "Door gap", status: "ready_for_review" } },
      { projectId: "p1", kind: "site_diaries", data: { id: "d1", diary_date: "2026-04-01", weather: "Clear", labour_count: 12 } },
      { projectId: "p1", kind: "site_diaries", data: { id: "d2", diary_date: "2026-04-03T00:00:00Z", labour_count: "x" } },
      { projectId: "p1", kind: "site_diaries", data: { id: "d3", diary_date: "not a date" } },
      { projectId: "p1", kind: "ffe_items", data: ffe("f2", { item_name: "Table" }) }, { projectId: "p1", kind: "ffe_items", data: ffe("f1") },
    ], { kinds: ["punch_list", "site_diaries", "ffe_items"] });
    const p = await loadPunchList(shellData(idb), "p1");
    expect(p.state === "local" && p.rows.map((x) => x.id)).toEqual(["x2", "x1"]);
    const d = await loadDiaries(shellData(idb), "p1");
    expect(d.state === "local" && d.rows.map((x) => [x.id, x.labourCount])).toEqual([["d2", null], ["d1", 12]]);
    const f = await loadFfeItems(shellData(idb), "p1");
    expect(f.state === "local" && f.rows.map((x) => x.id)).toEqual(["f1", "f2"]);
  });
  test("FF&E: the pull's hidden_fields hide cost and vendor for the role", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [{ projectId: "p1", data: ffe("f1") }], { kinds: ["ffe_items"], hiddenFields: ["unit_cost", "unit_price", "vendor_id"] });
    const r = await loadFfeItem(shellData(idb), "f1", "p1");
    if (r.state !== "local") throw new Error(r.state);
    expect(r.item).toMatchObject({ unitCost: null, unitPrice: null, vendorId: null, costHidden: true, vendorHidden: true });
  });
});

async function seedVendors(idb: IDBFactory, opts: { orgKinds: string[]; hidden?: string[]; synced?: boolean }) {
  const db = await openLocalDb(idb as never, localDbNameFor("u1"));
  await db.setMeta(MANIFEST_KEY, { userId: "u1", orgId: "orgA", projectIds: ["p1"], kinds: ["ffe_items"], orgKinds: opts.orgKinds, at: 1 });
  if (opts.synced !== false) await db.setMeta(doneKey(ORG_PROJECT, "vendors"), { at: 5, redacted: false, hiddenFields: opts.hidden ?? [] });
  await db.putRecords([
    { id: "vendors:ven-2", type: "vendors", orgId: "orgA", projectId: ORG_PROJECT, data: { id: "ven-2", supplier_name: "Bright Paints", supplier_type: "supplier", is_active: false, credit_limit: "50000" }, updatedAt: 1, serverVersion: 1 },
    { id: "vendors:ven-1", type: "vendors", orgId: "orgA", projectId: ORG_PROJECT, data: { id: "ven-1", supplier_name: "Ace Cement", trade: "civil", credit_limit: 90000, default_payment_terms_days: 30 }, updatedAt: 1, serverVersion: 1 },
    { id: "vendors:bad", type: "vendors", orgId: "orgA", projectId: ORG_PROJECT, data: { id: "bad" }, updatedAt: 1, serverVersion: 1 },
  ]);
  db.close();
}

describe("vendors (an organisation kind)", () => {
  test("listed by name; a row without a name is skipped; a missing active flag means active", async () => {
    const idb = new IDBFactory();
    await seedVendors(idb, { orgKinds: ["vendors"] });
    const r = await loadVendors(shellData(idb));
    if (r.state !== "local") throw new Error(r.state);
    expect(r.rows.map((v) => [v.name, v.isActive, v.creditLimit])).toEqual([["Ace Cement", true, 90000], ["Bright Paints", false, 50000]]);
    expect((await loadVendor(shellData(idb), "ven-1")).state).toBe("local");
    expect(await loadVendor(shellData(idb), "zzz")).toEqual({ state: "not_found" });
  });
  test("a role that does not receive vendors is told so; an unsynced list is not shown as empty", async () => {
    const a = new IDBFactory();
    await seedVendors(a, { orgKinds: [] });
    expect(await loadVendors(shellData(a))).toEqual({ state: "not_allowed" });
    const b = new IDBFactory();
    await seedVendors(b, { orgKinds: ["vendors"], synced: false });
    expect(await loadVendors(shellData(b))).toEqual({ state: "not_synced" });
  });
  test("credit limit hidden for the role stays hidden (null + flag), even when the row carries it", async () => {
    const idb = new IDBFactory();
    await seedVendors(idb, { orgKinds: ["vendors"], hidden: ["credit_limit"] });
    const r = await loadVendor(shellData(idb), "ven-1");
    if (r.state !== "local") throw new Error(r.state);
    expect([r.vendor.creditLimit, r.vendor.creditHidden]).toEqual([null, true]);
    expect(toLocalVendor({ id: "v", supplier_name: "X", credit_limit: 5 }, new Set(["credit_limit"]))!.creditLimit).toBeNull();
  });
  test("an FF&E item's vendor name comes from the vendor master; never when the vendor id is hidden", async () => {
    const idb = new IDBFactory();
    await seedPerson(idb, "u1", [{ projectId: "p1", data: ffe("f1") }], { kinds: ["ffe_items"] });
    await seedVendors(idb, { orgKinds: ["vendors"] });
    const r = await loadFfeItemWithVendor(shellData(idb), "f1", "p1");
    expect(r.state === "local" && r.item.vendorName).toBe("Ace Cement");
    const idb2 = new IDBFactory();
    await seedPerson(idb2, "u1", [{ projectId: "p1", data: ffe("f1") }], { kinds: ["ffe_items"], hiddenFields: ["vendor_id"] });
    await seedVendors(idb2, { orgKinds: ["vendors"] });
    const h = await loadFfeItemWithVendor(shellData(idb2), "f1", "p1");
    expect(h.state === "local" && h.item.vendorName).toBeNull();
  });
});
