import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { deliveryShellData as shellData, seedDelivery, type SeedPair } from "./delivery-test-seed";
import { seedOrgKinds } from "./finance-test-seed";
import { loadBilling } from "./billing-adapter";
import { loadCustomers } from "./customers-adapter";
import { loadExpenses } from "./expenses-adapter";

// Expenses, Billing Milestones and Customers read from the laptop's own copy: tolerant of junk rows, a hidden money column is never
// shown (even when a row carries a value), a project or kind that was not copied to the end is "not_synced", one person's database
// never serves another's, and nothing here ever touches the network.

let fetchSpy: ReturnType<typeof spyOn>;
beforeEach(() => { fetchSpy = spyOn(globalThis, "fetch"); });
afterEach(() => { expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore(); });

const expenses = (hidden: string[] = [], over: SeedPair["rows"] = []): SeedPair => ({
  projectId: "p1", kind: "expenses", hidden,
  rows: [
    { id: "e1", expense_head: "Site tools", expense_date: "2026-09-20", amount: "1250.50", description: "Drill bits", is_rework: false },
    { id: "e2", expense_head: "Rework", expense_date: "2026-09-25T10:00:00Z", amount: 300, description: null, is_rework: true },
    { id: "e3", expense_head: "Fuel", expense_date: "2026-09-25", amount: "not-a-number", description: "Generator" },
    ...over,
  ],
});

describe("Expenses", () => {
  test("newest first, amounts as the server recorded them, a bad amount is null (never 0); junk rows are skipped", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [expenses([], [null, 7, { id: "x1" }, { id: "x2", expense_head: "No date" }, { id: "", expense_head: "h", expense_date: "2026-01-01" }])]);
    const r = await loadExpenses(shellData(idb), "p1");
    if (r.state !== "local") throw new Error(`expected local, got ${r.state}`);
    expect(r.expenses.map((e) => e.id)).toEqual(["e2", "e3", "e1"]);
    expect(r.expenses.find((e) => e.id === "e1")).toMatchObject({ head: "Site tools", date: "2026-09-20", amount: 1250.5, description: "Drill bits", isRework: false });
    expect(r.expenses.find((e) => e.id === "e2")).toMatchObject({ date: "2026-09-25", isRework: true, description: null });
    expect(r.expenses.find((e) => e.id === "e3")!.amount).toBeNull();
    expect(r.amountHidden).toBe(false);
  });

  test("a role whose amount and description are hidden never gets either, even when a row still carries them", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [expenses(["amount", "description"])]);
    const r = await loadExpenses(shellData(idb, { role: "member" }), "p1");
    if (r.state !== "local") throw new Error("unreachable");
    expect(r.amountHidden).toBe(true);
    expect(r.descriptionHidden).toBe(true);
    expect(r.expenses.length).toBe(3);
    expect(r.expenses.every((e) => e.amount === null && e.description === null)).toBe(true);
  });

  test("not synced / no project / another person's database", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [{ ...expenses(), synced: false }]);
    expect(await loadExpenses(shellData(idb), "p1")).toEqual({ state: "not_synced", projectId: "p1" });
    expect(await loadExpenses(shellData(idb), null)).toEqual({ state: "no_project" });
    const idb2 = new IDBFactory();
    await seedDelivery(idb2, [expenses()], { userId: "u2" });
    expect((await loadExpenses(shellData(idb2), "p1")).state).toBe("not_synced");
  });
});

const CUSTOMERS = [
  { id: "c1", customer_name: "Lakeview Developers", is_active: true, credit_limit: "500000", default_payment_terms_days: 30 },
  { id: "c2", customer_name: "Asha Interiors", is_active: false, credit_limit: null },
  { id: "c3", customer_name: "  ", credit_limit: 5 },
  { id: "c4", credit_limit: 5 },
];
const claims = (hidden: string[] = []): SeedPair => ({
  projectId: "p1", kind: "progress_claims", hidden,
  rows: [
    { id: "k1", milestone_description: "Foundation complete", status: "invoiced", scheduled_date: "2026-09-01", customer_id: hidden.includes("customer_id") ? null : "c1", interim_bill_id: hidden.includes("interim_bill_id") ? null : "b1", drafted_at: "2026-09-02T08:00:00Z", invoiced_at: "2026-09-10T08:00:00Z" },
    { id: "k2", milestone_description: "Slab cast", status: "rejected", scheduled_date: "2026-10-01", customer_id: hidden.includes("customer_id") ? null : "c2", rejection_reason: "Quantities disputed", rejected_at: "2026-10-02T08:00:00Z" },
    { id: "k3", milestone_description: "Plinth", status: "weird_new_status", scheduled_date: null, customer_id: "unknown-customer" },
    { id: "k4", status: "drafted" },
  ],
});

describe("Billing Milestones", () => {
  test("claims newest first with customer names from the organisation copy, step dates as recorded, a junk row skipped", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [claims()]);
    await seedOrgKinds(idb, [{ kind: "customers", rows: CUSTOMERS }]);
    const r = await loadBilling(shellData(idb), "p1");
    if (r.state !== "local") throw new Error(`expected local, got ${r.state}`);
    expect(r.claims.map((c) => c.id)).toEqual(["k2", "k1", "k3"]);
    expect(r.claims.find((c) => c.id === "k1")).toMatchObject({ customerName: "Lakeview Developers", interimBillId: "b1", status: "invoiced" });
    expect(r.claims.find((c) => c.id === "k1")!.steps.map((s) => s.stage)).toEqual(["Drafted", "Invoiced"]);
    expect(r.claims.find((c) => c.id === "k2")).toMatchObject({ customerName: "Asha Interiors", rejectionReason: "Quantities disputed" });
    // an unknown customer id is "not on this laptop", never shown as the id; an unknown status is kept as it is
    expect(r.claims.find((c) => c.id === "k3")).toMatchObject({ customerName: null, status: "weird_new_status", scheduledDate: null });
    expect(r.customerNames).toBe("local");
    expect(r.customerHidden).toBe(false);
  });

  test("a role that may not see the customer or the invoice link: neither is shown, even when a row carries them", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [{ ...claims(["customer_id", "interim_bill_id", "retention_percent"]), rows: claims().rows }]);
    await seedOrgKinds(idb, [{ kind: "customers", rows: CUSTOMERS }]);
    const r = await loadBilling(shellData(idb, { role: "member" }), "p1");
    if (r.state !== "local") throw new Error("unreachable");
    expect(r.customerHidden).toBe(true);
    expect(r.claims.every((c) => c.customerName === null && c.interimBillId === null)).toBe(true);
  });

  test("without the organisation's customers the claims still list, and the reason is named", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [claims()]);
    let r = await loadBilling(shellData(idb), "p1");
    expect(r.state === "local" && r.customerNames).toBe("not_synced");
    await seedOrgKinds(idb, [], { listed: ["cost_visibility"] }); // the role's manifest does not list customers: a viewer
    r = await loadBilling(shellData(idb), "p1");
    expect(r.state === "local" && r.customerNames).toBe("not_allowed");
    expect(r.state === "local" && r.claims.length).toBe(3);
  });

  test("not synced / no project / another person's database", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [{ ...claims(), synced: false }]);
    expect(await loadBilling(shellData(idb), "p1")).toEqual({ state: "not_synced", projectId: "p1" });
    expect(await loadBilling(shellData(idb), null)).toEqual({ state: "no_project" });
    const idb2 = new IDBFactory();
    await seedDelivery(idb2, [claims()], { userId: "u2" });
    expect((await loadBilling(shellData(idb2), "p1")).state).toBe("not_synced");
  });
});

describe("Customers", () => {
  test("sorted by name; a nameless row is skipped; no flag means active; credit limit read from text", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, []);
    await seedOrgKinds(idb, [{ kind: "customers", rows: CUSTOMERS }, { kind: "currencies", rows: [{ id: "cur1", code: "INR", symbol: "₹", is_base_currency: true }] }]);
    const r = await loadCustomers(shellData(idb));
    if (r.state !== "local") throw new Error(`expected local, got ${r.state}`);
    expect(r.customers.map((c) => c.name)).toEqual(["Asha Interiors", "Lakeview Developers"]);
    expect(r.customers[1]).toMatchObject({ isActive: true, creditLimit: 500000, paymentTermsDays: 30 });
    expect(r.customers[0]).toMatchObject({ isActive: false, creditLimit: null });
    expect(r.base).toMatchObject({ code: "INR", symbol: "₹" });
    expect(r.creditHidden).toBe(false);
  });

  test("a role whose credit limit is hidden never gets one, even when a row carries it", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, []);
    await seedOrgKinds(idb, [{ kind: "customers", rows: CUSTOMERS, hidden: ["credit_limit"] }]);
    const r = await loadCustomers(shellData(idb, { role: "member" }));
    if (r.state !== "local") throw new Error("unreachable");
    expect(r.creditHidden).toBe(true);
    expect(r.customers.every((c) => c.creditLimit === null)).toBe(true);
  });

  test("a viewer (customers not in the role's kinds) is not_allowed; nothing copied is not_synced; another person's database is not_synced", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, []);
    await seedOrgKinds(idb, [{ kind: "cost_visibility", rows: [{ id: "cv", role: "manager", can_see_cost: true }] }]);
    expect(await loadCustomers(shellData(idb, { role: "viewer" }))).toEqual({ state: "not_allowed" });
    const idb2 = new IDBFactory();
    await seedDelivery(idb2, []);
    await seedOrgKinds(idb2, [{ kind: "customers", rows: CUSTOMERS, synced: false }]);
    expect(await loadCustomers(shellData(idb2))).toEqual({ state: "not_synced" });
    const idb3 = new IDBFactory();
    await seedDelivery(idb3, [], { userId: "u2" });
    await seedOrgKinds(idb3, [{ kind: "customers", rows: CUSTOMERS }], { userId: "u2" });
    expect(await loadCustomers(shellData(idb3))).toEqual({ state: "not_synced" });
  });
});
