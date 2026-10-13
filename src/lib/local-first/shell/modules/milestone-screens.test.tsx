import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "../../__fixtures__/fake-sync-server";
import { createIdentityStore, type DurableIdentity } from "../../identity";
import { openDeviceMeta } from "../../device-meta";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { createOutbox, type Outbox } from "../../outbox";
import { shellManifestKey } from "../manifest-cache";
import { seedDelivery, type SeedPair } from "./delivery-test-seed";

// R-94 milestones inside the REAL shell with the NETWORK OFF: add a milestone, see it in the Milestones tab marked "Waiting to sync",
// change a milestone the server already has. Only the browser's fetch (a spy that must never be called) and the shared outbox (a real
// outbox on this test's IndexedDB with auto-send off) are replaced.

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

const PAIRS: SeedPair[] = [
  { projectId: "p1", kind: "tasks", rows: [{ id: "t-1", number: 1, title: "Structure", start_date: "2026-10-01", due_date: "2026-10-20", completion_percentage: 30 }] },
  { projectId: "p1", kind: "milestones", rows: [{ id: "ms1", name: "Handover", description: "Keys", status: "planned", target_date: "2026-12-01" }] },
];

async function seedLaptop(role = "site_engineer") {
  await seedDelivery(idb, PAIRS, { userId: "u1", projectIds: ["p1"], at: NOW });
  // a row the sync service delivered carries a server version; the seed helper writes none, so it is added here
  const db = await openLocalDb(idb, localDbNameFor("u1"));
  try {
    const row = await db.getRecord("milestones", "ms1");
    await db.putRecords([{ ...row!, serverVersion: 3 }]);
  } finally {
    db.close();
  }
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

describe("milestones, offline, in the shell", () => {
  test("add a milestone: saved on the laptop, ONE create_milestone op, shown in the Milestones tab as Waiting to sync, nothing fetched", async () => {
    await seedLaptop();
    go("/local/schedule/milestones/new?projectId=p1");
    const { findByTestId, getByLabelText, getByTestId } = render(<LocalShell />);
    await findByTestId("milestone-form");
    fireEvent.input(getByLabelText("Title"), { target: { value: "Slab cast L2" } });
    fireEvent.input(getByLabelText("Target date"), { target: { value: "2026-11-15" } });
    fireEvent.submit(getByTestId("milestone-form"));
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("1"));
    expect(getByTestId("save-note").textContent).toContain("will be sent to the server when you are connected");
    expect((await outbox!.listPending()).map((o) => [o.functionId, o.params])).toEqual([["create_milestone", { projectId: "p1", title: "Slab cast L2", targetDate: "2026-11-15" }]]);
    cleanup();

    go("/local/schedule?tab=milestones&projectId=p1");
    const list = render(<LocalShell />);
    await waitFor(() => expect(list.getAllByTestId("schedule-milestone-row")).toHaveLength(2));
    const rows = list.getAllByTestId("schedule-milestone-row").map((r) => r.textContent!);
    expect(rows.find((t) => t.includes("Slab cast L2"))).toContain("Waiting to sync");
    expect(rows.find((t) => t.includes("Handover"))).not.toContain("Waiting to sync");
    expect(fetchCalls).toEqual([]);
  });

  test("a title left empty is stopped before anything is kept", async () => {
    await seedLaptop();
    go("/local/schedule/milestones/new?projectId=p1");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("milestone-form");
    fireEvent.submit(getByTestId("milestone-form"));
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("0"));
    expect(await outbox?.listPending() ?? []).toEqual([]);
    expect(fetchCalls).toEqual([]);
  });

  test("change a milestone the server has: ONE update_milestone op with only the changed fields, the row shows Waiting to sync", async () => {
    await seedLaptop();
    go("/local/schedule/milestones/ms1?projectId=p1");
    const { findByTestId, getByLabelText, getByTestId } = render(<LocalShell />);
    await findByTestId("milestone-edit-form");
    fireEvent.change(getByLabelText("Status"), { target: { value: "completed" } });
    fireEvent.submit(getByTestId("milestone-edit-form"));
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("1"));
    expect((await outbox!.listPending()).map((o) => [o.functionId, o.params])).toEqual([["update_milestone", { projectId: "p1", milestoneId: "ms1", status: "completed" }]]);
    await waitFor(() => expect(getByTestId("milestone-edit").textContent).toContain("Waiting to sync"));
    expect(fetchCalls).toEqual([]);
  });

  test("a read-only role is offered neither the Add link nor the form", async () => {
    await seedLaptop("viewer");
    go("/local/schedule/milestones/new?projectId=p1");
    const first = render(<LocalShell />);
    await first.findByTestId("milestone-new");
    expect(first.queryByTestId("milestone-form")).toBeNull();
    expect(first.getByTestId("delivery-read-only")).toBeTruthy();
  });
});
