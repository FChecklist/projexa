import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "../../__fixtures__/fake-sync-server";
import { createIdentityStore, type DurableIdentity } from "../../identity";
import { openDeviceMeta } from "../../device-meta";
import { createOutbox, type Outbox } from "../../outbox";
import { shellManifestKey } from "../manifest-cache";
import { seedDelivery, type SeedPair } from "./delivery-test-seed";
import { seedOrgKinds } from "./finance-test-seed";

// R-95 / checklist 2.14 inside the REAL shell with the NETWORK OFF: a new billing milestone is saved on the laptop as a DRAFT (no money, no
// invoice), listed as "Waiting to sync" and "Draft until confirmed", and sent as ONE create_progress_claim op; a member is not offered the form.

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

const pairs = (withBoq: boolean): SeedPair[] => [
  { projectId: "p1", kind: "progress_claims", rows: [{ id: "k1", milestone_description: "Foundation complete", status: "invoiced", scheduled_date: "2026-09-01", customer_id: "c1", interim_bill_id: "b1" }] },
  { projectId: "p1", kind: "boqs", rows: withBoq ? [{ id: "boq-1", title: "Villa BOQ", version: 2, status: "approved" }, { id: "boq-0", title: "Villa BOQ", version: 1, status: "approved" }] : [{ id: "boq-d", title: "Draft", version: 1, status: "draft" }] },
];

async function seedLaptop(role: string, opts: { boq?: boolean; customers?: boolean } = {}) {
  await seedDelivery(idb, pairs(opts.boq !== false), { userId: "u1", projectIds: ["p1"], at: NOW });
  await seedOrgKinds(idb, opts.customers === false ? [{ kind: "cost_visibility", rows: [] }] : [{ kind: "customers", rows: [{ id: "c1", customer_name: "Lakeview Developers", is_active: true }, { id: "c2", customer_name: "Asha Interiors", is_active: true }] }], { at: NOW });
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

describe("a new billing milestone, offline, in the shell", () => {
  test("a manager saves one: the draft sentence is on screen, ONE create_progress_claim op, listed as Waiting to sync and Draft until confirmed, nothing fetched", async () => {
    await seedLaptop("manager");
    go("/local/billing-milestones/new?projectId=p1");
    const { findByTestId, getByLabelText, getByTestId } = render(<LocalShell />);
    await findByTestId("billing-new-form", {}, { timeout: 8_000 });
    expect(getByTestId("billing-draft-words").textContent).toContain("Draft until confirmed");
    expect(getByTestId("billing-draft-words").textContent).toContain("no money is posted");
    expect(getByTestId("billing-new-boq").textContent).toContain("version 2");
    fireEvent.change(getByLabelText("Billed to"), { target: { value: "c1" } });
    fireEvent.input(getByLabelText("Milestone"), { target: { value: "Slab complete, level 2" } });
    fireEvent.input(getByLabelText("Billing date"), { target: { value: "2026-10-30" } });
    fireEvent.input(getByLabelText("Retention"), { target: { value: "5" } });
    fireEvent.submit(getByTestId("billing-new-form"));
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("1"), { timeout: 5_000 });
    expect(getByTestId("save-note").textContent).toContain("stays a draft until a person with the billing role confirms it online");
    expect((await outbox!.listPending()).map((o) => [o.functionId, o.params])).toEqual([
      ["create_progress_claim", { projectId: "p1", boqId: "boq-1", customerId: "c1", milestoneDescription: "Slab complete, level 2", scheduledDate: "2026-10-30", retentionPercent: 5 }],
    ]);
    cleanup();

    go("/local/billing-milestones?projectId=p1");
    const list = render(<LocalShell />);
    await list.findByTestId("billing-list", {}, { timeout: 8_000 });
    await waitFor(() => expect(list.getAllByTestId("billing-row")).toHaveLength(2));
    const mine = list.getAllByTestId("billing-row").find((r) => r.textContent!.includes("Slab complete, level 2"))!;
    expect(mine.textContent).toContain("Waiting to sync");
    expect(mine.textContent).toContain("Draft until confirmed");
    expect(mine.textContent).toContain("Milestone Achieved");
    expect(mine.textContent).toContain("30-10-2026");
    expect(mine.querySelector('a[href*="highlight"]')).toBeNull(); // no invoice
    expect(list.getByTestId("server-only").textContent).toContain("no money is posted from the laptop");
    expect(list.getByTestId("billing-new-link").querySelector("a")!.getAttribute("href")).toContain("/billing-milestones/new");
    expect(fetchCalls).toEqual([]);
  });

  test("a form left incomplete is refused in words and queues nothing (a date that is not a real day)", async () => {
    await seedLaptop("manager");
    go("/local/billing-milestones/new?projectId=p1");
    const { findByTestId, getByLabelText, getByTestId } = render(<LocalShell />);
    await findByTestId("billing-new-form", {}, { timeout: 8_000 });
    fireEvent.change(getByLabelText("Billed to"), { target: { value: "c2" } });
    fireEvent.input(getByLabelText("Milestone"), { target: { value: "Plinth" } });
    fireEvent.input(getByLabelText("Billing date"), { target: { value: "2026-02-30" } });
    fireEvent.submit(getByTestId("billing-new-form"));
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("0"));
    expect(getByTestId("save-note").textContent).toContain("not a real day");
    expect(getByTestId("save-note").textContent).toContain("Nothing was saved");
    expect(await outbox!.listPending()).toEqual([]);
  });

  test("a member is not offered the form and is told the manager role is needed; no approved BOQ and no customers are each said in words", async () => {
    await seedLaptop("member");
    go("/local/billing-milestones/new?projectId=p1");
    const member = render(<LocalShell />);
    await member.findByTestId("billing-new-role", {}, { timeout: 8_000 });
    expect(member.getByTestId("billing-new-role").textContent).toContain("manager role");
    expect(document.querySelector('[data-testid="billing-new-form"]')).toBeNull();
    cleanup();

    idb = new IDBFactory();
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
    await seedLaptop("manager", { boq: false });
    go("/local/billing-milestones/new?projectId=p1");
    const noBoq = render(<LocalShell />);
    await noBoq.findByTestId("billing-new-no-boq", {}, { timeout: 8_000 });
    expect(noBoq.getByTestId("billing-new-no-boq").textContent).toContain("no approved BOQ");
    cleanup();

    idb = new IDBFactory();
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
    await seedLaptop("manager", { customers: false });
    go("/local/billing-milestones/new?projectId=p1");
    const noCustomers = render(<LocalShell />);
    await noCustomers.findByTestId("billing-new-no-customers", {}, { timeout: 8_000 });
    expect(noCustomers.getByTestId("billing-new-no-customers").textContent).toContain("customers are not part of what your role keeps");
  });
});
