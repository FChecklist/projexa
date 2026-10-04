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
import { ROUTES } from "../clusters/design-change";
import { CHANGE_ORDERS_KIND, TASKS_KIND, TIMESHEETS_KIND, readPendingOps } from "./design-change-rows";
import { designChangeWriteDeps } from "./DesignChangeShared";
import { coRow, entryRow, seedDesignChange, taskRow } from "./design-change-test-fixtures";
// The replica pull after a sent edit talks to Supabase; here it is a no-op (the REAL module is spread first, see CLAUDE.md's mock.module() note).
const realReplicaShared = await import("../../replica-shared");
mock.module("../../replica-shared", () => ({ ...realReplicaShared, revalidateViaSharedReplica: async () => {} }));
const { default: LocalShell } = await import("../LocalShell");

// The design-and-change cluster, rendered through the REAL shell (route table, adapters, IndexedDB via fake-indexeddb, identity mirror)
// with the NETWORK OFF: every screen opens from the laptop's own database and not one request leaves the laptop. Writes go into a real
// outbox (backed by the fake sync server's client, never flushed here) through designChangeWriteDeps.

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key-not-a-real-credential";

const NOW = 1_760_000_000_000;
const ORIGIN = "https://px.test";
const TODAY = new Date().toISOString().slice(0, 10);
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

async function seedLaptop(opts: { dataOwner?: string; role?: string; costHidden?: boolean } = {}) {
  await seedDesignChange(idb, opts.dataOwner ?? "u1", [
    { kind: CHANGE_ORDERS_KIND, projectId: "p1", data: coRow("co1", { title: "Revised lobby finish" }) },
    { kind: CHANGE_ORDERS_KIND, projectId: "p1", data: coRow("co2", { title: "Extra power points", status: "approved", cost_impact: "-4000" }) },
    { kind: TASKS_KIND, projectId: "p1", data: taskRow("i1", 12, "Joinery shop drawings") },
    { kind: TIMESHEETS_KIND, projectId: "p1", data: entryRow("t1", { spent_on: TODAY, hours: "2.5" }) },
    { kind: TIMESHEETS_KIND, projectId: "p1", data: entryRow("t2", { spent_on: TODAY, hours: "1", approval_status: "submitted" }) },
    { kind: TIMESHEETS_KIND, projectId: "p1", data: entryRow("t3", { user_id: "u7", spent_on: TODAY, hours: "4", approval_status: "submitted" }) },
  ], { hiddenFields: opts.costHidden ? { [CHANGE_ORDERS_KIND]: ["cost_impact"] } : {} });
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

describe("the design-and-change cluster is registered in the shell", () => {
  test("lists, objects, create and review routes; nav orders inside 60-79; create paths are never read as ids", () => {
    expect(findShellRoute("/change-orders")!.route.pattern).toBe("/change-orders");
    expect(findShellRoute("/change-orders/new")!.route.pattern).toBe("/change-orders/new");
    expect(findShellRoute("/change-orders/abc")!.params).toEqual({ id: "abc" });
    expect(findShellRoute("/design-studio/timesheets/new")!.route.pattern).toBe("/design-studio/timesheets/new");
    expect(findShellRoute("/design-studio/timesheets/abc")!.params).toEqual({ id: "abc" });
    for (const p of ["/design-studio", "/design-studio/review", "/design-studio/cost-analysis"]) expect(findShellRoute(p)!.route.pattern).toBe(p);
    for (const r of ROUTES) if (r.nav) expect(r.nav.order >= 60 && r.nav.order <= 79).toBe(true);
  });
});

describe("Change Orders with NO network", () => {
  test("list -> one change order, from the laptop's copy; not one request", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/change-orders?projectId=p1");
    const { findByTestId, getAllByTestId, getByTestId } = render(<LocalShell />);
    expect((await findByTestId("co-list")).getAttribute("data-state")).toBe("local");
    expect(getAllByTestId("co-row").map((r) => r.getAttribute("data-co-id"))).toEqual(["co2", "co1"]);
    expect(getAllByTestId("co-cost")[0]!.textContent).toContain("-4,000");

    fireEvent.click(getAllByTestId("co-row").find((r) => r.getAttribute("data-co-id") === "co1")!.querySelector("a")!);
    expect((await findByTestId("co-object")).getAttribute("data-state")).toBe("local");
    expect(getByTestId("co-title").textContent).toBe("CO-1 Revised lobby finish");
    expect(getByTestId("co-reason").textContent).toBe("Client asked");
    expect(document.querySelector('[role="dialog"], [role="alertdialog"], [role="alert"]')).toBeNull();
    expect(fetchCalls).toEqual([]);
  });

  test("a viewer whose role hides money sees 'Hidden for your role', never the figure, and is offered no write", async () => {
    await seedLaptop({ role: "viewer", costHidden: true });
    setOnline(false);
    go("/local/change-orders?projectId=p1");
    const { findByTestId, getAllByTestId, queryByTestId } = render(<LocalShell />);
    await findByTestId("co-list");
    expect(getAllByTestId("co-cost").map((c) => c.textContent)).toEqual(["Hidden for your role", "Hidden for your role"]);
    expect(document.body.textContent).not.toContain("4,000");
    expect(document.body.textContent).not.toContain("12,500");
    expect(queryByTestId("co-new")).toBeNull();
    fireEvent.click(getAllByTestId("co-row")[1]!.querySelector("a")!);
    await findByTestId("co-object");
    expect(queryByTestId("co-send-open")).toBeNull();
    expect((await findByTestId("co-approval-role")).textContent).toContain("manager or higher");
    expect(fetchCalls).toEqual([]);
  });

  test("New Change Order offline: kept at once, opens marked 'Waiting to be sent' with no number, and is one create_change_order op", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/change-orders/new?projectId=p1");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("co-new-screen");
    fireEvent.input(getByTestId("co-new-cost"), { target: { value: "abc" } });
    fireEvent.input(getByTestId("co-new-title"), { target: { value: "Marble upgrade" } });
    fireEvent.click(getByTestId("co-new-save"));
    expect((await findByTestId("co-error-costImpact")).textContent).toBe("Cost impact must be a number.");
    expect(await ops()).toEqual([]);

    fireEvent.input(getByTestId("co-new-cost"), { target: { value: "7500" } });
    fireEvent.input(getByTestId("co-new-days"), { target: { value: "5" } });
    fireEvent.click(getByTestId("co-new-save"));
    const object = await findByTestId("co-object");
    expect(object.getAttribute("data-state")).toBe("local");
    expect(getByTestId("co-title").textContent).toBe("Marble upgradeWaiting to be sent");
    expect(getByTestId("co-status").textContent).toBe("Not yet accepted by the server");
    const [op] = await ops();
    expect(op).toMatchObject({ functionId: "create_change_order", params: { projectId: "p1", title: "Marble upgrade", costImpact: 7500, scheduleImpactDays: 5 } });
    expect(fetchCalls).toEqual([]);
  });

  test("lf-e10b: New Change Order for a role whose cost is hidden offers NO cost field and sends no costImpact", async () => {
    await seedLaptop({ costHidden: true, role: "member" });
    setOnline(false);
    go("/local/change-orders/new?projectId=p1");
    const { findByTestId, getByTestId, queryByTestId } = render(<LocalShell />);
    expect((await findByTestId("co-new-screen")).getAttribute("data-state")).toBe("ready");
    expect(queryByTestId("co-new-cost")).toBeNull();
    fireEvent.input(getByTestId("co-new-title"), { target: { value: "Extra power points" } });
    fireEvent.input(getByTestId("co-new-days"), { target: { value: "2" } });
    fireEvent.click(getByTestId("co-new-save"));
    await findByTestId("co-object");
    const [op] = await ops();
    expect(op!.params).toEqual({ projectId: "p1", title: "Extra power points", scheduleImpactDays: 2 });
  });

  test("Send for Approval offline is RECORDED; the status stays the server's 'draft', marked as waiting", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/change-orders/co1?projectId=p1");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("co-object");
    fireEvent.click(getByTestId("co-send-open"));
    fireEvent.input(getByTestId("co-signer-name"), { target: { value: "Ravi" } });
    fireEvent.input(getByTestId("co-signer-email"), { target: { value: "not-an-email" } });
    fireEvent.click(getByTestId("co-send"));
    expect((await findByTestId("dc-note")).textContent).toBe('"not-an-email" is not a valid email address');
    fireEvent.input(getByTestId("co-signer-email"), { target: { value: "ravi@client.test" } });
    fireEvent.click(getByTestId("co-send"));
    await findByTestId("co-approval-waiting");
    expect(getByTestId("co-status").textContent).toBe("draft");
    expect(getByTestId("co-title").textContent).toContain("Approval request waiting to be sent");
    expect((await ops()).map((o) => [o.functionId, o.params])).toEqual([
      ["submit_change_order_for_approval", { projectId: "p1", changeOrderId: "co1", signers: [{ name: "Ravi", email: "ravi@client.test" }] }],
    ]);
    expect(fetchCalls).toEqual([]);
  });

  test("another person's database on the same laptop contributes nothing", async () => {
    await seedLaptop({ dataOwner: "u2" });
    setOnline(false);
    go("/local/change-orders?projectId=p1");
    const { findByTestId } = render(<LocalShell />);
    expect((await findByTestId("co-list")).getAttribute("data-state")).toBe("not_synced");
    expect(document.body.textContent).not.toContain("Revised lobby finish");
  });
});

describe("the Design Studio with NO network", () => {
  test("my day grid; Add entry is kept at once as waiting; Submit and Submit day record ops, statuses stay the server's", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/design-studio?projectId=p1");
    const { findByTestId, getAllByTestId, getByTestId } = render(<LocalShell />);
    expect((await findByTestId("ds-timesheet")).getAttribute("data-state")).toBe("local");
    expect(getAllByTestId("ds-row").map((r) => r.getAttribute("data-entry-id"))).toEqual(["t1", "t2"]); // u7's entry is not mine
    expect(getByTestId("ds-day-total").textContent).toBe("Total today: 3.50 h");
    expect(getByTestId("ds-submit-day").textContent).toBe("Submit today (1 row, 2.50 h)");

    fireEvent.change(getByTestId("ds-task"), { target: { value: "i1" } });
    fireEvent.input(getByTestId("ds-hours"), { target: { value: "21" } });
    fireEvent.click(getByTestId("ds-add"));
    expect((await findByTestId("ds-hours-error")).textContent).toBe("Total for the day would exceed 24 hours");
    fireEvent.input(getByTestId("ds-hours"), { target: { value: "1.5" } });
    fireEvent.click(getByTestId("ds-add"));
    await waitFor(() => expect(getAllByTestId("ds-row").length).toBe(3));
    expect(getByTestId("ds-day-total").textContent).toBe("Total today: 5.00 h");
    expect(getAllByTestId("ds-row")[2]!.textContent).toContain("Waiting to be sent");

    fireEvent.click(getByTestId("ds-submit-day"));
    await waitFor(async () => expect((await ops()).length).toBe(2));
    await waitFor(() => expect(getAllByTestId("ds-row")[0]!.textContent).toContain("Submit waiting to be sent"));
    expect(getAllByTestId("ds-row")[0]!.textContent).toContain("Draft");
    expect((await ops()).map((o) => [o.functionId, o.params])).toEqual([
      ["record_timesheet", { projectId: "p1", issueId: "i1", hours: 1.5, spentOn: TODAY, activityType: "Concept" }],
      ["submit_timesheet", { projectId: "p1", timeEntryId: "t1" }],
    ]);
    expect(fetchCalls).toEqual([]);
  });

  test("log time: Save names what is missing, then keeps the entry and opens the timesheet on that day", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/design-studio/timesheets/new?projectId=p1&taskId=i1");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("ds-entry-new");
    expect((getByTestId("ds-new-task") as HTMLSelectElement).value).toBe("i1");
    expect(getByTestId("ds-new-save").textContent).toBe("Save (1 required: Hours)");
    fireEvent.input(getByTestId("ds-new-hours"), { target: { value: "2" } });
    fireEvent.click(getByTestId("ds-new-save"));
    await findByTestId("ds-timesheet");
    expect((await ops()).map((o) => o.functionId)).toEqual(["record_timesheet"]);
    expect(fetchCalls).toEqual([]);
  });

  test("review: a manager approves another designer's day (recorded, still 'Submitted'); their own day is not offered", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/design-studio/review?projectId=p1");
    const { findByTestId, getAllByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("ds-review");
    const groups = getAllByTestId("ds-review-group");
    expect(groups.map((g) => g.getAttribute("data-group"))).toEqual([`u1|${TODAY}`, `u7|${TODAY}`]);
    expect(groups[0]!.textContent).toContain("You cannot review your own hours.");
    expect(groups[0]!.querySelector('[data-testid="ds-review-approve"]')).toBeNull();

    fireEvent.click(groups[1]!.querySelector('[data-testid="ds-review-approve"]')!);
    await findByTestId("ds-review-decided");
    expect(getByTestId("ds-review").textContent).toContain("Approval waiting to be sent");
    expect(getAllByTestId("ds-review-entry").find((e) => e.getAttribute("data-entry-id") === "t3")!.textContent).toContain("Submitted");
    expect((await ops()).map((o) => [o.functionId, o.params])).toEqual([["approve_timesheet", { timeEntryId: "t3" }]]);
    expect(fetchCalls).toEqual([]);
  });

  test("review: Return needs a reason; a member sees the queue but is offered no decision", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/design-studio/review?projectId=p1");
    const first = render(<LocalShell />);
    await first.findByTestId("ds-review");
    fireEvent.click(first.getByTestId("ds-review-return"));
    expect((first.getByTestId("ds-review-return-send") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(first.getByTestId("ds-review-reason"), { target: { value: "Wrong task" } });
    fireEvent.click(first.getByTestId("ds-review-return-send"));
    await first.findByTestId("ds-review-decided");
    expect((await ops()).map((o) => [o.functionId, o.params])).toEqual([["reject_timesheet", { timeEntryId: "t3", rejectionReason: "Wrong task" }]]);
    cleanup();

    idb = new IDBFactory();
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
    localStorage.clear();
    await seedLaptop({ role: "member" });
    go("/local/design-studio/review?projectId=p1");
    const second = render(<LocalShell />);
    await second.findByTestId("ds-review-role");
    expect(second.queryByTestId("ds-review-approve")).toBeNull();
    expect(second.queryByTestId("ds-review-return")).toBeNull();
    expect(fetchCalls).toEqual([]);
  });

  test("cost analysis stays on the server and says so calmly offline", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/design-studio/cost-analysis?projectId=p1");
    const { findByTestId } = render(<LocalShell />);
    const screen = await findByTestId("dc-server-only");
    expect(screen.getAttribute("data-online")).toBe("0");
    expect(screen.textContent).toContain("needs a connection");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(fetchCalls).toEqual([]);
  });
});
