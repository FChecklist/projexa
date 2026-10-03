import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { createIdentityStore, type DurableIdentity } from "../../identity";
import { openDeviceMeta } from "../../device-meta";
import { shellManifestKey } from "../manifest-cache";
import { seedOrgKinds } from "./finance-test-seed";

// ERP B (accounting, budgets, quotations, sales orders, invoices, the sales hub, employees and HR), rendered inside the REAL shell (route
// table, adapters, IndexedDB via fake-indexeddb, identity mirror) with the NETWORK OFF: they open from the laptop's own copy, never print
// a hidden money value, say a calm true thing when a role is not sent a kind, never show what the employee kind leaves out, and not one
// request leaves the laptop.

let idb: IDBFactory;
const realReplicaShared = await import("../../replica-shared");
mock.module("../../replica-shared", () => ({ ...realReplicaShared, revalidateViaSharedReplica: async () => {} }));
const { default: LocalShell } = await import("../LocalShell");

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key-not-a-real-credential";

const NOW = 1_760_000_000_000;
const ORIGIN = "https://px.test";
const realFetch = globalThis.fetch;
let fetchCalls: string[];

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}
function go(path: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${ORIGIN}${path}`);
}

const identity = (role: string): DurableIdentity => ({
  userId: "u1", email: "asha@example.com", name: "Asha Rao", orgId: "orgA", role, lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 },
});

const CUSTOMERS = [{ id: "c1", customer_name: "Lakeview Developers" }, { id: "c2", customer_name: "Asha Interiors" }];

type Opts = { hide?: boolean; listed?: string[] };
async function seedLaptop(role: string, opts: Opts = {}) {
  const hide = Boolean(opts.hide);
  const hidden = (cols: string[]) => (hide ? cols : []);
  await seedOrgKinds(idb, [
    { kind: "customers", rows: CUSTOMERS },
    { kind: "companies", rows: [{ id: "co1", company_name: "Shobha Interiors Pvt Ltd" }] },
    { kind: "org_people", rows: [{ id: "u9", name: "Meera Shah", email: "meera@example.com" }] },
    { kind: "accounts", rows: [{ id: "a1", account_name: "Current Assets", account_number: "1100", root_type: "asset", is_group: true }, { id: "a2", account_name: "Cash", account_number: "1110", parent_account_id: "a1", root_type: "asset", account_type: "cash" }] },
    { kind: "fiscal_years", rows: [{ id: "f1", year_name: "FY 2026-27", start_date: "2026-04-01", end_date: "2027-03-31", is_closed: false }] },
    { kind: "budgets", rows: [{ id: "b1", name: "Civil works", fiscal_year_id: "f1", company_id: "co1", status: "submitted", action_if_exceeded: "warn" }] },
    // a hidden money value the row still carries (never trusted over the marker): 55555 / 66666 / 77777 must never appear on screen
    { kind: "quotations", hidden: hidden(["grand_total"]), rows: [
      { id: "q1", quotation_number: 1001, customer_id: "c1", quotation_date: "2026-09-01", valid_till: "2026-09-30", status: "sent", grand_total: hide ? 55555 : 250000, version: 2 },
      { id: "q2", quotation_number: 1002, customer_id: "c2", quotation_date: "2026-09-10", status: "draft", grand_total: 1200 },
    ] },
    { kind: "sales_orders", hidden: hidden(["grand_total"]), rows: [{ id: "s1", so_number: 55, customer_id: "c1", order_date: "2026-09-12", quotation_id: "q1", status: "confirmed", grand_total: hide ? 66666 : 180000 }] },
    { kind: "invoices", hidden: hidden(["subtotal", "tax_amount", "grand_total", "outstanding_amount"]), rows: [
      { id: "i1", invoice_number: 7, customer_id: "c1", posting_date: "2026-09-15", due_date: "2026-10-15", status: "partially_paid", sales_order_id: "s1", subtotal: hide ? 77777 : 100000, tax_amount: hide ? 77777 : 18000, grand_total: hide ? 77777 : 118000, outstanding_amount: hide ? 66666 : 40000 },
    ] },
    { kind: "employees", rows: [
      { id: "e1", user_id: "u9", employee_code: "E-009", job_title: "Site Engineer", employment_type: "full_time", date_of_joining: "2024-06-01", employment_status: "active", company_id: "co1", date_of_birth: "1990-01-01", emergency_contact_phone: "9999999999", income_tax_slab_id: "slab-x" },
      { id: "e2", user_id: "u8", employee_code: "E-008", employment_status: "on_leave", job_title: "Accountant" },
    ] },
  ], { at: NOW, ...(opts.listed ? { listed: opts.listed } : {}) });
  const device = await openDeviceMeta(idb);
  await device.meta.setMeta(shellManifestKey("u1"), { at: NOW, user: { id: "u1", name: "Asha Rao", role, org_id: "orgA" }, projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }] });
  device.close();
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identity(role));
}

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
  setOnline(false);
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  setOnline(true);
});

const noDialog = () => document.querySelector('[role="dialog"], [role="alertdialog"], [role="alert"]') === null;
const NOT_SENT = ["customers", "cost_visibility"]; // what a viewer is sent: none of the ERP kinds

describe("ERP B screens open OFFLINE from the laptop's own copy", () => {
  test("Accounting: the chart of accounts and the fiscal years; journal entries are the server's", async () => {
    await seedLaptop("manager");
    go("/local/accounting");
    const { findByTestId, getAllByTestId, getByTestId } = render(<LocalShell />);
    expect((await findByTestId("accounting")).getAttribute("data-state")).toBe("local");
    const rows = getAllByTestId("accounts-row").map((r) => r.textContent!);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Current Assets");
    expect(rows[1]).toContain("Cash");
    expect(getByTestId("fiscal-years-row").textContent).toContain("FY 2026-27");
    expect(getByTestId("server-only").textContent).toContain("Journal entries and their lines");
    expect(getByTestId("server-only").textContent).toContain("It will be available here when you are connected.");
    expect(fetchCalls).toEqual([]);
    expect(noDialog()).toBe(true);
  });

  test("Budgets: header rows with names, no amount; a budget's own page opens from the laptop", async () => {
    await seedLaptop("manager");
    go("/local/finance/budgets");
    const { findAllByTestId, getByTestId, findByTestId, unmount } = render(<LocalShell />);
    const row = (await findAllByTestId("budgets-row"))[0]!.textContent!;
    expect(row).toContain("Civil works");
    expect(row).toContain("FY 2026-27");
    expect(row).toContain("Shobha Interiors Pvt Ltd");
    expect(getByTestId("server-only").textContent).toContain("Budget lines and the annual amount are on the server");
    unmount();
    go("/local/budgets/b1");
    render(<LocalShell />);
    expect((await findByTestId("budget-object")).getAttribute("data-state")).toBe("local");
    expect(fetchCalls).toEqual([]);
  });

  test("Budgets for a role below rank 3: the calm 'not available to your role' answer, no rows", async () => {
    await seedLaptop("member", { listed: ["customers", "accounts", "quotations"] });
    go("/local/finance/budgets");
    const { findByTestId, queryAllByTestId } = render(<LocalShell />);
    const screen = await findByTestId("budgets");
    expect(screen.getAttribute("data-state")).toBe("not_allowed");
    expect(screen.textContent).toContain("Your role does not include the organisation's budgets");
    expect(queryAllByTestId("budgets-row")).toHaveLength(0);
    expect(fetchCalls).toEqual([]);
    expect(noDialog()).toBe(true);
  });

  test("Quotations: newest first with totals as sent, search and status narrow them, a row opens its own page, nothing is added up", async () => {
    await seedLaptop("manager");
    go("/local/quotations");
    const { findAllByTestId, getByTestId, queryAllByTestId, findByTestId, unmount } = render(<LocalShell />);
    const rows = (await findAllByTestId("quotations-row")).map((r) => r.textContent!);
    expect(rows[0]).toContain("#1002");
    expect(rows[1]).toContain("Lakeview Developers");
    expect(rows[1]).toContain("250,000");
    expect(getByTestId("quotations").textContent).not.toContain("251,200");
    expect(getByTestId("server-only").textContent).toContain("Line items");
    fireEvent.input(getByTestId("quotations-search"), { target: { value: "lake" } });
    await waitFor(() => expect(queryAllByTestId("quotations-row")).toHaveLength(1));
    fireEvent.input(getByTestId("quotations-search"), { target: { value: "" } });
    fireEvent.input(getByTestId("quotations-status"), { target: { value: "draft" } });
    await waitFor(() => expect(queryAllByTestId("quotations-row")).toHaveLength(1));
    expect(queryAllByTestId("quotations-row")[0]!.getAttribute("data-status")).toBe("draft");
    unmount();
    go("/local/quotations/q1");
    render(<LocalShell />);
    const facts = (await findByTestId("quotations-object-facts")).textContent!;
    expect(facts).toContain("250,000");
    expect(facts).toContain("Lakeview Developers");
    expect(getByTestId("quotations-object-related").textContent).toContain("A sales order made from this quotation");
    expect(fetchCalls).toEqual([]);
  });

  test("Quotations, sales orders and invoices for a role without cost: 'Hidden for your role', never a value a row still carries", async () => {
    await seedLaptop("member", { hide: true });
    for (const [path, id] of [["/local/quotations", "quotations"], ["/local/sales-orders", "sales-orders"], ["/local/invoices", "invoices"], ["/local/quotations/q1", "quotations-object"], ["/local/invoices/i1", "invoices-object"]] as const) {
      go(path);
      const { findByTestId, unmount } = render(<LocalShell />);
      const text = (await findByTestId(id)).textContent!;
      expect(text).toContain("Hidden for your role");
      expect(text).not.toMatch(/55,?555|66,?666|77,?777/);
      unmount();
    }
    expect(fetchCalls).toEqual([]);
    expect(noDialog()).toBe(true);
  });

  test("Invoices: total and outstanding as sent, status in words, the link to its sales order, lines on the server", async () => {
    await seedLaptop("manager");
    go("/local/invoices/i1");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    const facts = (await findByTestId("invoices-object-facts")).textContent!;
    expect(facts).toContain("118,000");
    expect(facts).toContain("40,000");
    expect(facts).toContain("partially paid");
    expect(getByTestId("invoices-object-related").querySelector('a[href="/sales-orders/s1"]')).not.toBeNull();
    expect(getByTestId("server-only").textContent).toContain("Line items");
    expect(fetchCalls).toEqual([]);
  });

  test("Sales hub: how many of each, links to the lists, leads are the server's", async () => {
    await seedLaptop("manager");
    go("/local/sales");
    const { findAllByTestId, getByTestId } = render(<LocalShell />);
    const cards = (await findAllByTestId("sales-card")).map((c) => c.textContent!);
    expect(cards[0]).toContain("Quotations");
    expect(cards[0]).toContain("2 on this laptop");
    expect(cards[1]).toContain("1 on this laptop");
    expect(cards[2]).toContain("1 on this laptop");
    expect(getByTestId("sales-note").textContent).toContain("Leads and opportunities are on the server");
    expect(getByTestId("sales").querySelector('a[href="/invoices"]')).not.toBeNull();
    expect(fetchCalls).toEqual([]);
  });

  test("Employees and HR share one screen; the date of birth, emergency contact and tax slab are never on it", async () => {
    await seedLaptop("manager");
    for (const [path, title] of [["/local/employees", "Employees"], ["/local/hr", "HR"]] as const) {
      go(path);
      const { findAllByTestId, getByTestId, unmount } = render(<LocalShell />);
      const rows = (await findAllByTestId("employees-row")).map((r) => r.textContent!);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toContain("E-008");
      expect(rows[1]).toContain("Meera Shah");
      expect(rows[1]).toContain("Site Engineer");
      const text = getByTestId("employees").textContent!;
      expect(text).toContain(title);
      expect(text).not.toMatch(/1990|9999999999|slab-x|meera@example/);
      expect(text).toContain("2 people on this laptop");
      unmount();
    }
    go("/local/employees/u9");
    const { findByTestId } = render(<LocalShell />);
    const facts = (await findByTestId("employee-facts")).textContent!;
    expect(facts).toContain("E-009");
    expect(facts).not.toMatch(/1990|9999999999|slab-x/);
    expect(fetchCalls).toEqual([]);
  });

  test("a viewer is sent none of these kinds: every screen answers calmly, with no rows and no request", async () => {
    await seedLaptop("viewer", { listed: NOT_SENT });
    for (const [path, id] of [["/local/accounting", "accounting"], ["/local/finance/budgets", "budgets"], ["/local/quotations", "quotations"], ["/local/sales-orders", "sales-orders"], ["/local/invoices", "invoices"], ["/local/employees", "employees"], ["/local/hr", "employees"], ["/local/quotations/q1", "quotations-object"], ["/local/employees/u9", "employee-object"]] as const) {
      go(path);
      const { findByTestId, unmount } = render(<LocalShell />);
      const screen = await findByTestId(id);
      expect(screen.getAttribute("data-state")).toBe("not_allowed");
      expect(screen.textContent).toContain("Your role does not include");
      expect(screen.querySelectorAll("tr, dd")).toHaveLength(0);
      unmount();
    }
    go("/local/sales");
    const { findAllByTestId } = render(<LocalShell />);
    expect((await findAllByTestId("sales-card")).every((c) => c.getAttribute("data-state") === "not_allowed")).toBe(true);
    expect(fetchCalls).toEqual([]);
    expect(noDialog()).toBe(true);
  });

  test("a create screen is never read as an object whose id is 'new'; offline it explains, with no request", async () => {
    await seedLaptop("manager");
    for (const path of ["/local/quotations/new", "/local/invoices/credit-notes", "/local/employees/new", "/local/finance/budgets/new"]) {
      go(path);
      const { findByTestId, unmount } = render(<LocalShell />);
      const screen = await findByTestId("documents-server-only");
      expect(screen.textContent).toContain("It will open when you are connected.");
      unmount();
    }
    expect(fetchCalls).toEqual([]);
  });

  test("modules that are not synced (payroll, recruitment, leads) keep the shell's own honest answer", async () => {
    await seedLaptop("manager");
    for (const path of ["/local/payroll", "/local/recruitment", "/local/sales/leads"]) {
      go(path);
      const { findByTestId, unmount } = render(<LocalShell />);
      expect((await findByTestId("local-shell-not-here")).textContent).toContain("not saved on this laptop yet");
      unmount();
    }
    expect(fetchCalls).toEqual([]);
  });
});
