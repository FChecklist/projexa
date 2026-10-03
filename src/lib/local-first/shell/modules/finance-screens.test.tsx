import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { createIdentityStore, type DurableIdentity } from "../../identity";
import { openDeviceMeta } from "../../device-meta";
import { shellManifestKey } from "../manifest-cache";
import { seedDelivery, type SeedPair } from "./delivery-test-seed";
import { seedOrgKinds } from "./finance-test-seed";

// Expenses, Billing Milestones and Customers, rendered inside the REAL shell (route table, adapters, IndexedDB via fake-indexeddb,
// identity mirror) with the NETWORK OFF: they open from the laptop's own copy, never print a hidden money value, offer no write they
// cannot keep, say a calm true thing when something is not there, and not one request leaves the laptop. A module of this group
// the sync service has no data for (invoices) gets the shell's own "not on this laptop yet" answer, also with no request.

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

const PAIRS = (hide: boolean): SeedPair[] => [
  {
    projectId: "p1", kind: "expenses", hidden: hide ? ["amount", "description"] : [],
    // a hidden amount the row still carries (never trusted over the marker): 7777 and "secret quote" must never appear on screen
    rows: [
      { id: "e1", expense_head: "Site tools", expense_date: "2026-09-20", amount: hide ? 7777 : 1250, description: hide ? "secret quote 7777" : "Drill bits" },
      { id: "e2", expense_head: "Fuel", expense_date: "2026-09-25", amount: hide ? 7777 : 300, description: null, is_rework: true },
    ],
  },
  {
    projectId: "p1", kind: "progress_claims", hidden: hide ? ["customer_id", "interim_bill_id", "retention_percent"] : [],
    rows: [
      { id: "k1", milestone_description: "Foundation complete", status: "submitted", scheduled_date: "2026-09-01", customer_id: "c1", interim_bill_id: hide ? "bill-9" : null, drafted_at: "2026-09-02T08:00:00Z" },
      { id: "k2", milestone_description: "Slab cast", status: "rejected", scheduled_date: "2026-10-01", customer_id: "c1", rejection_reason: "Quantities disputed" },
    ],
  },
];

async function seedLaptop(role: string, opts: { hide?: boolean; customers?: boolean } = {}) {
  await seedDelivery(idb, PAIRS(Boolean(opts.hide)), { projectIds: ["p1", "p2"], at: NOW });
  await seedOrgKinds(idb, opts.customers === false ? [{ kind: "cost_visibility", rows: [] }] : [
    {
      kind: "customers", hidden: opts.hide ? ["credit_limit"] : [],
      rows: [
        { id: "c1", customer_name: "Lakeview Developers", is_active: true, credit_limit: opts.hide ? 9999 : 500000 },
        { id: "c2", customer_name: "Asha Interiors", is_active: false, credit_limit: null },
      ],
    },
  ], { at: NOW });
  const device = await openDeviceMeta(idb);
  await device.meta.setMeta(shellManifestKey("u1"), { at: NOW, user: { id: "u1", name: "Asha Rao", role, org_id: "orgA" }, projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }, { id: "p2", name: "Annexe", status: "active" }] });
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

describe("Expenses, Billing Milestones and Customers open OFFLINE from the laptop's own copy", () => {
  test("Expenses: rows newest first with amounts as recorded, no total added up, logging is the server's", async () => {
    await seedLaptop("manager");
    go("/local/expenses?projectId=p1");
    const { findByTestId, getAllByTestId, getByTestId } = render(<LocalShell />);
    expect((await findByTestId("expenses")).getAttribute("data-state")).toBe("local");
    const rows = getAllByTestId("expenses-row").map((r) => r.textContent!);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Fuel");
    expect(rows[0]).toContain("rework");
    expect(rows[1]).toContain("Site tools");
    expect(rows[1]).toContain("1,250");
    expect(rows[1]).toContain("Drill bits");
    const text = getByTestId("expenses").textContent!;
    expect(text).toContain("2 expenses logged");
    expect(text).not.toContain("1,550"); // 1250 + 300: money is never added up on the laptop
    expect(getByTestId("server-only").textContent).toContain("It will be available here when you are connected.");
    expect(fetchCalls).toEqual([]);
    expect(noDialog()).toBe(true);
  });

  test("Expenses for a role without cost: 'Hidden for your role', never the amount or the description a row carries", async () => {
    await seedLaptop("member", { hide: true });
    go("/local/expenses?projectId=p1");
    const { findAllByTestId, getByTestId } = render(<LocalShell />);
    const first = (await findAllByTestId("expenses-row"))[0]!.textContent!;
    expect(first).toContain("Hidden for your role");
    const text = getByTestId("expenses").textContent!;
    expect(text).not.toMatch(/7,?777/);
    expect(text).not.toContain("secret quote");
    expect(fetchCalls).toEqual([]);
  });

  test("Billing Milestones: claims with status, customer name and recorded steps; read-only (no button moves a claim)", async () => {
    await seedLaptop("manager");
    go("/local/billing-milestones?projectId=p1");
    const { findByTestId, getAllByTestId, getByTestId } = render(<LocalShell />);
    expect((await findByTestId("billing")).getAttribute("data-state")).toBe("local");
    const rows = getAllByTestId("billing-row");
    expect(rows[0]!.textContent).toContain("Slab cast");
    expect(rows[0]!.textContent).toContain("Rejected");
    expect(rows[0]!.textContent).toContain("Quantities disputed");
    expect(rows[0]!.textContent).toContain("Lakeview Developers");
    expect(rows[1]!.getAttribute("data-status")).toBe("submitted");
    expect(getAllByTestId("billing-steps")[0]!.textContent).toContain("Drafted");
    expect(getByTestId("billing").querySelectorAll("button")).toHaveLength(0);
    expect(getByTestId("server-only").textContent).toContain("approving, rejecting or invoicing");
    expect(fetchCalls).toEqual([]);
    expect(noDialog()).toBe(true);
  });

  test("Billing Milestones for a role that may not see the customer: the customer and the invoice link stay hidden", async () => {
    await seedLaptop("member", { hide: true });
    go("/local/billing-milestones?projectId=p1");
    const { findAllByTestId, getByTestId } = render(<LocalShell />);
    const rows = await findAllByTestId("billing-row");
    expect(rows[0]!.textContent).toContain("Customer hidden for your role");
    const text = getByTestId("billing").textContent!;
    expect(text).not.toContain("Lakeview");
    expect(getByTestId("billing").querySelector('a[href*="highlight"]')).toBeNull();
    expect(fetchCalls).toEqual([]);
  });

  test("Customers: sorted rows, search narrows them, the credit limit is shown to a manager", async () => {
    await seedLaptop("manager");
    go("/local/customers");
    const { findAllByTestId, getByTestId, queryAllByTestId } = render(<LocalShell />);
    const rows = await findAllByTestId("customers-row");
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining("Asha Interiors"), expect.stringContaining("Lakeview Developers")]);
    expect(rows[1]!.textContent).toContain("500,000");
    fireEvent.input(getByTestId("customers-search"), { target: { value: "lake" } });
    await waitFor(() => expect(queryAllByTestId("customers-row")).toHaveLength(1));
    expect(queryAllByTestId("customers-row")[0]!.textContent).toContain("Lakeview");
    fireEvent.input(getByTestId("customers-search"), { target: { value: "zzz" } });
    await waitFor(() => expect(getByTestId("customers-empty")).not.toBeNull());
    expect(fetchCalls).toEqual([]);
  });

  test("Customers for a role without cost: the credit limit says 'Hidden for your role', never its value", async () => {
    await seedLaptop("member", { hide: true });
    go("/local/customers");
    const { findAllByTestId, getByTestId } = render(<LocalShell />);
    expect((await findAllByTestId("customers-row"))[0]!.textContent).toContain("Hidden for your role");
    expect(getByTestId("customers").textContent).not.toMatch(/9,?999/);
    expect(fetchCalls).toEqual([]);
  });

  test("Customers for a role that is not sent customer master data: a plain sentence, no rows", async () => {
    await seedLaptop("viewer", { customers: false });
    go("/local/customers");
    const { findByTestId, queryAllByTestId } = render(<LocalShell />);
    const screen = await findByTestId("customers");
    expect(screen.getAttribute("data-state")).toBe("not_allowed");
    expect(screen.textContent).toContain("Your role does not include the organisation's customers");
    expect(queryAllByTestId("customers-row")).toHaveLength(0);
    expect(fetchCalls).toEqual([]);
  });

  test("a project whose expenses were never copied says so calmly (no rows, no error dialog)", async () => {
    await seedLaptop("manager");
    go("/local/expenses?projectId=p2");
    const { findByTestId } = render(<LocalShell />);
    const screen = await findByTestId("expenses");
    expect(screen.getAttribute("data-state")).toBe("not_synced");
    expect(noDialog()).toBe(true);
    expect(fetchCalls).toEqual([]);
  });

  test("a module of this group with no data kind in the sync service (invoices) gets the shell's own honest answer, offline, with no request", async () => {
    await seedLaptop("manager");
    for (const path of ["/local/invoices", "/local/payroll", "/local/sales-orders"]) {
      go(path);
      const { findByTestId, unmount } = render(<LocalShell />);
      const screen = await findByTestId("local-shell-not-here");
      expect(screen.textContent).toContain("not saved on this laptop yet");
      unmount();
    }
    expect(fetchCalls).toEqual([]);
  });
});
