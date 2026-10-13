import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, setDefaultTimeout, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "../../__fixtures__/fake-sync-server";
import golden from "../../__fixtures__/real-sync-rows.json";
import { createIdentityStore, type DurableIdentity } from "../../identity";
import { openDeviceMeta } from "../../device-meta";
import { createOutbox, type Outbox } from "../../outbox";
import { shellManifestKey } from "../manifest-cache";
import { seedDelivery } from "./delivery-test-seed";

// R-96 / R-98 inside the REAL shell with the NETWORK OFF: "Add a scope item" on a BOQ keeps ONE create_boq_revision (every line kept, the new one added),
// optionally because of an approved change order; a second revision while one waits is said to be impossible; a viewer is not offered it.

// the first test of a file also pays for loading the shell (several seconds on a busy laptop); bun's 5 s default is for unit tests
setDefaultTimeout(20_000);

let idb: IDBFactory;
let outbox: Outbox | null = null;
const realOutboxShared = await import("../../outbox-shared");
mock.module("../../outbox-shared", () => ({
  ...realOutboxShared,
  getSharedOutbox: () => {
    outbox ??= createOutbox({ userId: "u1", client: createFakeSyncServer().client, deviceId: "dev-1", idb, autoFlush: false, locks: null, sleep: async () => {} });
    return outbox;
  },
}));
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

type Row = Record<string, unknown>;
const line = (over: Row): Row => ({ ...(golden.boq_lines[0] as Row), boq_id: "boq-1", parent_line_item_id: null, breakdown_percentage: null, budget_percentage: 25, ...over });

async function seedLaptop(role: string) {
  await seedDelivery(idb, [
    { projectId: "p1", kind: "boqs", rows: [{ ...(golden.boqs[0] as Row), id: "boq-1", title: "Villa BOQ", status: "approved", version: 1, project_id: "p1", parent_boq_id: null }] },
    { projectId: "p1", kind: "boq_lines", rows: [line({ id: "li-a1", item_code: "A1", description: "Blockwork", unit: "sqm", quantity: 100, rate: 50, amount: 5000 })] },
    { projectId: "p1", kind: "progress", rows: [{ id: "pr1", boq_line_item_id: "li-a1", entry_date: "2026-10-01", percent_complete: 40 }] },
    { projectId: "p1", kind: "change_orders", rows: [{ id: "co-ok", number: 7, title: "Extra waterproofing", status: "approved", boq_revision_id: null }] },
  ], { userId: "u1", projectIds: ["p1"], at: NOW });
  const device = await openDeviceMeta(idb);
  await device.meta.setMeta(shellManifestKey("u1"), { at: NOW, user: { id: "u1", name: "Asha Rao", role, org_id: "orgA" }, projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }] });
  device.close();
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identity(role));
}

beforeEach(() => {
  idb = new IDBFactory();
  outbox = null;
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

const T = { timeout: 8_000 };

describe("add a scope item, offline, in the shell", () => {
  test("the BOQ screen offers it; a manager adds an item because of an approved change order: ONE create_boq_revision with every line kept and the change order named, nothing fetched", async () => {
    await seedLaptop("manager");
    go("/local/scope/boq-1?projectId=p1");
    const boq = render(<LocalShell />);
    await boq.findByTestId("boq-local-add-item", {}, T);
    expect(boq.getByTestId("boq-local-add-item").getAttribute("href")).toBe("/scope/boq-1/add-item?projectId=p1");
    cleanup();

    go("/local/scope/boq-1/add-item?projectId=p1");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("scope-additem-screen", {}, T);
    fireEvent.input(getByTestId("scope-additem-0-description"), { target: { value: "Waterproofing" } });
    fireEvent.input(getByTestId("scope-additem-0-unit"), { target: { value: "sqm" } });
    fireEvent.input(getByTestId("scope-additem-0-quantity"), { target: { value: "80" } });
    fireEvent.input(getByTestId("scope-additem-0-rate"), { target: { value: "35" } });
    fireEvent.input(getByTestId("scope-additem-0-itemCode"), { target: { value: "A3" } });
    fireEvent.input(getByTestId("scope-additem-change-order"), { target: { value: "co-ok" } });
    expect(getByTestId("scope-additem-items-total").textContent).toContain("2,800");
    fireEvent.submit(getByTestId("scope-additem-save").closest("form")!);
    await waitFor(async () => expect((await outbox!.listPending()).length).toBe(1), { timeout: 5_000 });
    const [op] = await outbox!.listPending();
    expect(op!.functionId).toBe("create_boq_revision");
    expect(op!.params).toMatchObject({ projectId: "p1", boqId: "boq-1", title: "Villa BOQ", sourceChangeOrderId: "co-ok" });
    expect((op!.params.lineItems as Row[]).map((l) => [l.itemCode, l.quantity, l.rate])).toEqual([["A1", 100, 50], ["A3", 80, 35]]);
    expect(fetchCalls).toEqual([]);
  });

  test("while a revision is waiting the screen says a BOQ can be revised only once, and saving is off; a half-typed item is refused in words", async () => {
    await seedLaptop("manager");
    go("/local/scope/boq-1/add-item?projectId=p1");
    const first = render(<LocalShell />);
    await first.findByTestId("scope-additem-screen", {}, T);
    fireEvent.submit(first.getByTestId("scope-additem-save").closest("form")!);
    await first.findByTestId("scope-additem-error", {}, T);
    expect(first.getByTestId("scope-additem-error").textContent).toContain("Write the new scope item first");
    fireEvent.input(first.getByTestId("scope-additem-0-description"), { target: { value: "Waterproofing" } });
    fireEvent.input(first.getByTestId("scope-additem-0-unit"), { target: { value: "sqm" } });
    fireEvent.input(first.getByTestId("scope-additem-0-quantity"), { target: { value: "80" } });
    fireEvent.input(first.getByTestId("scope-additem-0-rate"), { target: { value: "35" } });
    fireEvent.submit(first.getByTestId("scope-additem-save").closest("form")!);
    await waitFor(async () => expect((await outbox!.listPending()).length).toBe(1), { timeout: 5_000 });
    cleanup();

    go("/local/scope/boq-1/add-item?projectId=p1");
    const again = render(<LocalShell />);
    await again.findByTestId("scope-additem-waiting", {}, T);
    expect(again.getByTestId("scope-additem-waiting").textContent).toContain("can be revised only once");
    expect((again.getByTestId("scope-additem-save") as HTMLButtonElement).disabled).toBe(true);
    cleanup();

    go("/local/scope/boq-1/revise?projectId=p1");
    const revise = render(<LocalShell />);
    await revise.findByTestId("scope-revise-waiting", {}, T);
    expect((revise.getByTestId("scope-revise-save") as HTMLButtonElement).disabled).toBe(true);
    expect(revise.getByTestId("scope-revise-change-order")).toBeTruthy();
  });

  test("a viewer is told their role can read but not change a BOQ", async () => {
    await seedLaptop("viewer");
    go("/local/scope/boq-1/add-item?projectId=p1");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("scope-additem-screen", {}, T);
    expect(getByTestId("scope-additem-screen").getAttribute("data-state")).toBe("role");
    expect(document.querySelector('[data-testid="scope-additem-save"]')).toBeNull();
  });
});
