import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY, doneKey } from "../../replica";
import { createIdentityStore, type DurableIdentity } from "../../identity";
import { openDeviceMeta } from "../../device-meta";
import { shellManifestKey } from "../manifest-cache";
import type { ShellApi } from "../types";
import type { ShellData } from "../context";
import { snapshotCacheFor } from "../snapshot-cache";
// The replica pull after a sent edit talks to Supabase; here it is a no-op (the REAL module is spread first).
const realReplicaShared = await import("../../replica-shared");
mock.module("../../replica-shared", () => ({ ...realReplicaShared, revalidateViaSharedReplica: async () => {} }));
const { default: LocalShell } = await import("../LocalShell");
const { default: DashboardLocalScreen } = await import("./DashboardLocalScreen");
const { loadDashboard, projectDashboardSnapshotName } = await import("./dashboard-adapter");

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key-not-a-real-credential";

const NOW = 1_760_000_000_000;
const ORIGIN = "https://px.test";
const realFetch = globalThis.fetch;
let idb: IDBFactory;
let fetchCalls: string[];
let answer: () => Response;

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}
const go = (path: string) => (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${ORIGIN}${path}`);

const identity: DurableIdentity = {
  userId: "u1", email: "asha@example.com", name: "Asha Rao", orgId: "orgA", role: "pm", lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 },
};

const FIGURES = { projectId: "p1", progressPercent: 42, percentByValue: 38.5, contractValue: 777000, budget: 500000, expenses: 120000, delayedTaskCount: 2, taskCount: 9, permitsExpiringCount: 1 };

async function seedLaptop(opts: { ops?: number } = {}) {
  const db = await openLocalDb(idb, localDbNameFor("u1"));
  await db.setMeta(MANIFEST_KEY, { userId: "u1", orgId: "orgA", projectIds: ["p1"], kinds: ["tasks", "rfis"], at: 1 });
  await db.putRecords([
    { id: "tasks:t1", type: "tasks", orgId: "orgA", projectId: "p1", data: { id: "t1", due_date: "2000-01-01", completion_percentage: 0 }, updatedAt: 1 },
    { id: "rfis:r1", type: "rfis", orgId: "orgA", projectId: "p1", data: { id: "r1", status: "open" }, updatedAt: 1 },
  ]);
  await db.setMeta(doneKey("p1", "tasks"), { at: NOW, redacted: false, hiddenFields: [] });
  await db.setMeta(doneKey("p1", "rfis"), { at: NOW, redacted: false, hiddenFields: [] });
  for (let i = 1; i <= (opts.ops ?? 0); i += 1) {
    await db.putOp({ opId: `op${i}`, seq: i, functionId: "update_task", projectId: "p1", params: {}, clientAt: "2026-10-07T00:00:00Z", status: i === 1 ? "conflict" : "pending", attempts: 0, nextAttemptAt: 0 });
  }
  db.close();
  const device = await openDeviceMeta(idb);
  await device.meta.setMeta(shellManifestKey("u1"), { at: NOW, user: { id: "u1", name: "Asha Rao", role: "pm", org_id: "orgA" }, projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }] });
  device.close();
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identity);
}

const shellData = (over: Partial<ShellData> = {}): ShellData => ({
  userId: "u1", name: "Asha", email: "a@x.test", role: "pm", orgId: "orgA", idb, projects: [{ id: "p1", name: "Cedar Heights Villa" }], ...over,
});

function fakeShell(connectivity: ShellApi["connectivity"], refresh = () => {}, data = shellData()): ShellApi {
  return {
    data, projectId: "p1", setProjectId() {}, navigate() {}, connectivity, refresh,
    writer: { list: async () => [], enqueue: async () => { throw new Error("no"); }, flush: async () => ({ sent: 0, rejected: 0, kept: 0, stoppedBecause: "none" }), notices: async () => [], dismissNotice: async () => {} },
  };
}

beforeEach(() => {
  idb = new IDBFactory();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
  localStorage.clear();
  sessionStorage.clear();
  fetchCalls = [];
  answer = () => new Response(JSON.stringify(FIGURES), { status: 200, headers: { "content-type": "application/json" } });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls.push(String(input));
    return answer();
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  setOnline(true);
});

describe("the dashboard opens OFFLINE, inside the shell", () => {
  test("with no network: projects, sync state, waiting edits and the local facts, and not one request", async () => {
    await seedLaptop({ ops: 2 });
    setOnline(false);
    go("/local/dashboard?projectId=p1");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    expect((await findByTestId("overview-dashboard")).textContent).toContain("Dashboard / Cedar Heights Villa");
    expect(getByTestId("overview-dashboard-sync").textContent).toBe("Working on this laptop; will sync when connected");
    expect(getByTestId("overview-dashboard-projects").textContent).toContain("Cedar Heights Villa");
    expect(getByTestId("overview-dashboard-projects").textContent).toContain("fully copied");
    expect(getByTestId("overview-dashboard-waiting").textContent).toContain("2 changes are saved here and will be sent when the laptop is connected");
    expect(getByTestId("overview-dashboard-conflicts").textContent).toContain("1 needs you");
    expect(getByTestId("overview-fact-tasks").textContent).toContain("Overdue: 1");
    expect(getByTestId("overview-fact-rfis").textContent).toContain("open: 1"); // capitalised by CSS only
    expect(getByTestId("overview-fact-activities").querySelector("[data-state]")?.getAttribute("data-state")).toBe("not_synced");
    expect(getByTestId("overview-dashboard-figures").querySelector("[data-state]")?.getAttribute("data-state")).toBe("none");
    expect(getByTestId("overview-dashboard-figures").textContent).toContain("worked out by the server");
    expect(fetchCalls).toEqual([]);
  });

  test("the Dashboard link is first in the shell's header", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/dashboard");
    const { findByTestId, getByLabelText } = render(<LocalShell />);
    await findByTestId("overview-dashboard");
    expect(getByLabelText("Modules").querySelector("a")?.getAttribute("href")).toBe("/dashboard");
    expect(fetchCalls).toEqual([]);
  });
});

describe("the server's figures: a snapshot, refreshed only while online", () => {
  test("offline with a snapshot: shown 'As of ..., from this laptop'; nothing fetched", async () => {
    await seedLaptop();
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(projectDashboardSnapshotName("p1"), FIGURES);
    const data = await loadDashboard(shellData(), "p1");
    const { getByTestId } = render(<DashboardLocalScreen shell={fakeShell("offline")} params={{}} query={new URLSearchParams()} data={data} />);
    expect(getByTestId("overview-dashboard-asof").textContent).toMatch(/^As of .*, from this laptop$/);
    expect(getByTestId("overview-dashboard-figures").textContent).toContain("777,000");
    expect(getByTestId("overview-dashboard-figures").textContent).toContain("38.5%");
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchCalls).toEqual([]);
  });

  test("our server down: no fetch either (the kept figures stay)", async () => {
    await seedLaptop();
    const data = await loadDashboard(shellData(), "p1");
    render(<DashboardLocalScreen shell={fakeShell("server_down")} params={{}} query={new URLSearchParams()} data={data} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchCalls).toEqual([]);
  });

  test("online: the same endpoint as the online page is fetched, the snapshot is kept, and the screen is redrawn", async () => {
    await seedLaptop();
    let refreshed = 0;
    const data = await loadDashboard(shellData(), "p1");
    render(<DashboardLocalScreen shell={fakeShell("online", () => { refreshed += 1; })} params={{}} query={new URLSearchParams()} data={data} />);
    await waitFor(() => expect(refreshed).toBe(1));
    expect(fetchCalls.filter((u) => u.startsWith("/api/"))).toEqual(["/api/dashboard/project/p1"]);
    expect((await loadDashboard(shellData(), "p1")).snapshot?.body).toEqual(FIGURES);
  });

  test("online, the server refuses: the kept snapshot is removed and the screen says so", async () => {
    await seedLaptop();
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(projectDashboardSnapshotName("p1"), FIGURES);
    answer = () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
    const data = await loadDashboard(shellData(), "p1");
    const { findByText } = render(<DashboardLocalScreen shell={fakeShell("online")} params={{}} query={new URLSearchParams()} data={data} />);
    await findByText("The server no longer shows you these figures.");
    expect((await loadDashboard(shellData(), "p1")).snapshot).toBeNull();
  });

  test("a viewer never sees a figure saved while they were a manager", async () => {
    await seedLaptop();
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(projectDashboardSnapshotName("p1"), FIGURES);
    const viewer = shellData({ role: "viewer" });
    const data = await loadDashboard(viewer, "p1");
    const { getByTestId } = render(<DashboardLocalScreen shell={fakeShell("offline", () => {}, viewer)} params={{}} query={new URLSearchParams()} data={data} />);
    expect(getByTestId("overview-dashboard-figures").textContent).not.toContain("777,000");
    expect(getByTestId("overview-dashboard-figures").querySelector("[data-state]")?.getAttribute("data-state")).toBe("none");
  });
});
