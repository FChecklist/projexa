import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { deliveryShellData as shellData } from "./delivery-test-seed";
import { seedOrgKinds } from "./finance-test-seed";
import {
  loadAccounting, loadBudget, loadBudgets, loadEmployee, loadEmployees, loadSalesDoc, loadSalesDocs, loadSalesHub,
} from "./erp-b-adapter";

// Accounting, budgets, quotations, sales orders, invoices, the sales hub and employees read from the laptop's own copy: tolerant of junk
// rows, a hidden money column is never shown (even when a row carries a value), a kind the role is not sent says "not_allowed", a kind not
// copied to the end is "not_synced", one person's database never serves another's, and nothing here ever touches the network.

let fetchSpy: ReturnType<typeof spyOn>;
beforeEach(() => { fetchSpy = spyOn(globalThis, "fetch"); });
afterEach(() => { expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore(); });

const CUSTOMERS = { kind: "customers", rows: [{ id: "c1", customer_name: "Lakeview Developers" }, { id: "c2", customer_name: "Asha Interiors" }] };
const CURRENCIES = { kind: "currencies", rows: [{ id: "inr", code: "INR", symbol: "R", is_base_currency: true }, { id: "aed", code: "AED", name: "Dirham", is_base_currency: false }] };

describe("Accounting", () => {
  test("accounts by number with their depth, fiscal years newest first, junk rows skipped", async () => {
    const idb = new IDBFactory();
    await seedOrgKinds(idb, [
      { kind: "accounts", rows: [
        { id: "a2", account_name: "Cash", account_number: "1110", parent_account_id: "a1", root_type: "asset", account_type: "cash", is_group: false },
        { id: "a1", account_name: "Current Assets", account_number: "1100", root_type: "asset", is_group: true },
        { id: "a3", account_name: "Loop A", account_number: "9000", parent_account_id: "a4" },
        { id: "a4", account_name: "Loop B", account_number: "9001", parent_account_id: "a3", is_frozen: true },
        null, 7, { id: "x1" }, { account_name: "no id" },
      ] },
      { kind: "fiscal_years", rows: [{ id: "f1", year_name: "FY 2025-26", start_date: "2025-04-01", end_date: "2026-03-31", is_closed: true }, { id: "f2", year_name: "FY 2026-27", start_date: "2026-04-01T00:00:00Z", is_closed: false }, { id: "f3" }] },
    ]);
    const r = await loadAccounting(shellData(idb));
    if (r.accounts.state !== "local" || r.fiscalYears.state !== "local") throw new Error("expected local");
    expect(r.accounts.rows.map((a) => [a.id, a.depth])).toEqual([["a1", 0], ["a2", 1], ["a3", 12], ["a4", 12]]); // a parent cycle is cut at 12, never hangs
    expect(r.accounts.rows.find((a) => a.id === "a4")!.isFrozen).toBe(true);
    expect(r.fiscalYears.rows.map((y) => y.id)).toEqual(["f2", "f1"]);
    expect(r.fiscalYears.rows[0]).toMatchObject({ startDate: "2026-04-01", endDate: null, isClosed: false });
  });

  test("a role that is not sent the kinds, and a laptop that has not copied them", async () => {
    const idb = new IDBFactory();
    await seedOrgKinds(idb, [{ kind: "customers", rows: [] }], { listed: ["customers"] });
    expect(await loadAccounting(shellData(idb))).toEqual({ accounts: { state: "not_allowed" }, fiscalYears: { state: "not_allowed" } });
    const idb2 = new IDBFactory();
    await seedOrgKinds(idb2, [{ kind: "accounts", rows: [], synced: false }, { kind: "fiscal_years", rows: [], synced: false }]);
    expect(await loadAccounting(shellData(idb2))).toEqual({ accounts: { state: "not_synced" }, fiscalYears: { state: "not_synced" } });
  });
});

describe("Budgets (headers only, rank 3)", () => {
  const budgets = { kind: "budgets", rows: [
    { id: "b2", name: "Site overheads", fiscal_year_id: "f1", company_id: "co1", status: "submitted", action_if_exceeded: "warn", submitted_at: "2026-05-01T10:00:00Z" },
    { id: "b1", name: "Civil works", fiscal_year_id: "unknown-year", status: "draft" },
    { id: "b3", name: "  " }, { id: "b4" }, 3,
  ] };
  const years = { kind: "fiscal_years", rows: [{ id: "f1", year_name: "FY 2026-27" }] };
  const companies = { kind: "companies", rows: [{ id: "co1", company_name: "Shobha Interiors Pvt Ltd" }] };

  test("names from the organisation copy; an unknown year or company is blank, never its id; no amount anywhere", async () => {
    const idb = new IDBFactory();
    await seedOrgKinds(idb, [budgets, years, companies]);
    const r = await loadBudgets(shellData(idb, { role: "manager" }));
    if (r.state !== "local") throw new Error(`expected local, got ${r.state}`);
    expect(r.budgets.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(r.budgets[0]).toMatchObject({ fiscalYear: null, company: null, status: "draft", actionIfExceeded: null });
    expect(r.budgets[1]).toMatchObject({ fiscalYear: "FY 2026-27", company: "Shobha Interiors Pvt Ltd", submittedAt: "2026-05-01" });
    expect(JSON.stringify(r)).not.toContain("unknown-year");
    expect((await loadBudget(shellData(idb), "b2")).state).toBe("local");
    expect((await loadBudget(shellData(idb), "nope")).state).toBe("not_found");
  });

  test("a role below rank 3 is not sent budgets: not_allowed, for the list and for one budget", async () => {
    const idb = new IDBFactory();
    await seedOrgKinds(idb, [budgets], { listed: ["customers"] });
    expect(await loadBudgets(shellData(idb, { role: "member" }))).toEqual({ state: "not_allowed" });
    expect(await loadBudget(shellData(idb, { role: "member" }), "b1")).toEqual({ state: "not_allowed" });
  });
});

const QUOTES = (over: unknown[] = []) => ({
  kind: "quotations",
  rows: [
    { id: "q1", quotation_number: 1001, customer_id: "c1", quotation_date: "2026-09-01", valid_till: "2026-09-30", status: "sent", grand_total: "250000.50", version: 2, revision_of: "q0", currency_id: "inr" },
    { id: "q2", quotation_number: "1002", customer_id: "c2", quotation_date: "2026-09-10T08:00:00Z", status: "pending_approval", grand_total: null, currency_id: "aed" },
    { id: "q3", quotation_number: 1003, customer_id: "ghost", quotation_date: "2026-09-05", status: "weird_new_status", grand_total: "not-a-number" },
    { id: "q4", status: "draft" }, null, "junk",
    ...over,
  ],
});

describe("Quotations, sales orders and invoices (header rows)", () => {
  test("newest first, customer names from the organisation copy (an unknown customer is not shown as an id), money as sent, a bad total is null, junk skipped", async () => {
    const idb = new IDBFactory();
    await seedOrgKinds(idb, [QUOTES(), CUSTOMERS, CURRENCIES]);
    const r = await loadSalesDocs(shellData(idb, { role: "manager" }), "quotations");
    if (r.state !== "local") throw new Error(`expected local, got ${r.state}`);
    expect(r.docs.map((d) => d.id)).toEqual(["q2", "q3", "q1"]);
    expect(r.docs.find((d) => d.id === "q1")).toMatchObject({ number: "1001", customerName: "Lakeview Developers", total: 250000.5, version: 2, due: "2026-09-30", currency: { code: "INR" } });
    expect(r.docs.find((d) => d.id === "q2")).toMatchObject({ number: "1002", date: "2026-09-10", total: null, currency: { code: "AED" } });
    const q3 = r.docs.find((d) => d.id === "q3")!;
    expect(q3).toMatchObject({ customerName: null, total: null, status: "weird_new_status" });
    expect(JSON.stringify(r)).not.toContain("ghost");
    expect(r.statuses).toEqual(["pending_approval", "sent", "weird_new_status"]);
  });

  test("a hidden money column is dropped even when the row still carries a value", async () => {
    const idb = new IDBFactory();
    await seedOrgKinds(idb, [{ kind: "invoices", hidden: ["subtotal", "tax_amount", "grand_total", "outstanding_amount"], rows: [
      { id: "i1", invoice_number: 7, customer_id: "c1", posting_date: "2026-09-02", status: "paid", subtotal: 99999, tax_amount: 88888, grand_total: 77777, outstanding_amount: 66666 },
    ] }, CUSTOMERS]);
    const r = await loadSalesDocs(shellData(idb, { role: "member" }), "invoices");
    if (r.state !== "local") throw new Error("unreachable");
    expect(r.hidden).toEqual({ subtotal: true, tax_amount: true, grand_total: true, outstanding_amount: true });
    expect(r.docs[0]).toMatchObject({ subtotal: null, tax: null, total: null, outstanding: null });
    expect(JSON.stringify(r.docs)).not.toMatch(/99999|88888|77777|66666/);
  });

  test("an invoice's customer comes from customer_id, else client_id; links only to headers that are on the laptop", async () => {
    const idb = new IDBFactory();
    await seedOrgKinds(idb, [
      { kind: "invoices", rows: [
        { id: "i1", invoice_number: 1, client_id: "c2", posting_date: "2026-09-02", sales_order_id: "s1", status: "submitted", grand_total: 10 },
        { id: "i2", invoice_number: 2, customer_id: "c1", posting_date: "2026-09-03", sales_order_id: "s-missing", status: "draft" },
      ] },
      { kind: "sales_orders", rows: [{ id: "s1", so_number: 55, customer_id: "c2", order_date: "2026-08-30", quotation_id: "q1", status: "confirmed" }] },
      QUOTES(), CUSTOMERS,
    ]);
    const d = shellData(idb);
    const i1 = await loadSalesDoc(d, "invoices", "i1");
    const i2 = await loadSalesDoc(d, "invoices", "i2");
    if (i1.state !== "local" || i2.state !== "local") throw new Error("unreachable");
    expect(i1.doc.customerName).toBe("Asha Interiors");
    expect(i1.related.salesOrderOnLaptop).toBe(true);
    expect(i2.related.salesOrderOnLaptop).toBe(false);
    const so = await loadSalesDoc(d, "sales_orders", "s1");
    if (so.state !== "local") throw new Error("unreachable");
    expect(so.related).toMatchObject({ quotationOnLaptop: true, invoicedFrom: ["i1"] });
    const q = await loadSalesDoc(d, "quotations", "q1");
    if (q.state !== "local") throw new Error("unreachable");
    expect(q.related).toMatchObject({ orderedFrom: ["s1"], revisionOnLaptop: false });
    expect(await loadSalesDoc(d, "quotations", "nope")).toEqual({ state: "not_found", kind: "quotations" });
  });

  test("the sales hub counts headers per kind and carries each kind's own state; no money anywhere", async () => {
    const idb = new IDBFactory();
    await seedOrgKinds(idb, [QUOTES(), { kind: "invoices", rows: [], synced: false }], { listed: ["quotations", "invoices"] });
    const hub = await loadSalesHub(shellData(idb));
    expect(hub.kinds.map((k) => [k.kind, k.state])).toEqual([["quotations", "local"], ["sales_orders", "not_allowed"], ["invoices", "not_synced"]]);
    expect(hub.kinds[0]).toMatchObject({ count: 3 });
    expect(JSON.stringify(hub)).not.toContain("250000");
  });

  test("a role that is not sent the kind: not_allowed; another person's database contributes nothing", async () => {
    const idb = new IDBFactory();
    await seedOrgKinds(idb, [QUOTES()], { listed: ["customers"] });
    expect(await loadSalesDocs(shellData(idb, { role: "viewer" }), "quotations")).toEqual({ state: "not_allowed" });
    const idb2 = new IDBFactory();
    await seedOrgKinds(idb2, [QUOTES()], { userId: "u2" });
    expect((await loadSalesDocs(shellData(idb2), "quotations")).state).toBe("not_synced");
  });
});

describe("Employees (HR)", () => {
  const EMPLOYEES = { kind: "employees", rows: [
    // date_of_birth / emergency contact / tax slab are NOT in the kind; a row that carries them anyway must not leak them into the result
    { id: "e1", user_id: "u9", employee_code: "E-009", job_title: "Site Engineer", employment_type: "full_time", date_of_joining: "2024-06-01", employment_status: "active", company_id: "co1", date_of_birth: "1990-01-01", emergency_contact_phone: "9999999999", income_tax_slab_id: "slab-1" },
    { id: "e2", user_id: "u8", employee_code: "E-008", employment_status: "on_leave" },
    { id: "e3", user_id: "ghost", job_title: "Accountant" },
    { id: "e4", user_id: "ghost2" }, null, 5,
  ] };
  const PEOPLE = { kind: "org_people", rows: [{ id: "u9", name: "Meera Shah", email: "meera@example.com" }, { id: "u8", name: "Arun Das" }] };
  const COMPANIES = { kind: "companies", rows: [{ id: "co1", company_name: "Shobha Interiors Pvt Ltd" }] };

  test("name from the organisation's people, sorted by name, never the date of birth, emergency contact or tax slab", async () => {
    const idb = new IDBFactory();
    await seedOrgKinds(idb, [EMPLOYEES, PEOPLE, COMPANIES]);
    const r = await loadEmployees(shellData(idb));
    if (r.state !== "local") throw new Error(`expected local, got ${r.state}`);
    expect(r.employees.map((e) => e.id)).toEqual(["e2", "e1", "e3"]);
    expect(r.employees.find((e) => e.id === "e1")).toMatchObject({ name: "Meera Shah", code: "E-009", company: "Shobha Interiors Pvt Ltd", status: "active" });
    expect(r.employees.find((e) => e.id === "e3")).toMatchObject({ name: null, jobTitle: "Accountant" });
    const dump = JSON.stringify(r);
    expect(dump).not.toMatch(/1990-01-01|9999999999|slab-1|meera@example.com/);
    expect(Object.keys(r.employees[0]!)).not.toEqual(expect.arrayContaining(["dateOfBirth"]));
  });

  test("one employee by user id or profile id; not found; not allowed", async () => {
    const idb = new IDBFactory();
    await seedOrgKinds(idb, [EMPLOYEES, PEOPLE]);
    expect((await loadEmployee(shellData(idb), "u9")).state).toBe("local");
    expect((await loadEmployee(shellData(idb), "e1")).state).toBe("local");
    expect(await loadEmployee(shellData(idb), "zzz")).toEqual({ state: "not_found" });
    const idb2 = new IDBFactory();
    await seedOrgKinds(idb2, [EMPLOYEES], { listed: ["customers"] });
    expect(await loadEmployees(shellData(idb2, { role: "viewer" }))).toEqual({ state: "not_allowed" });
  });
});
