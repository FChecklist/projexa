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

// The delivery screens, rendered inside the REAL shell (route table, adapters, IndexedDB via fake-indexeddb, identity mirror) with the
// NETWORK OFF: they open from the laptop's own copy, say calm true things when something is not there, never show a hidden money value,
// and keep the person's daily writes on the laptop (outbox) without one request leaving it.
//
// The only things replaced: the browser's fetch (a spy that must never be called) and, for writes, the shared outbox -- swapped for a
// real outbox on this test's IndexedDB with auto-send off (the REAL module is spread first, see CLAUDE.md's mock.module() note).

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
const { Money } = await import("./DeliveryParts");

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

const identity: DurableIdentity = {
  userId: "u1", email: "asha@example.com", name: "Asha Rao", orgId: "orgA", role: "site_engineer", lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 },
};

const PAIRS = (opts: { hidden?: boolean } = {}): SeedPair[] => [
  { projectId: "p1", kind: "activities", rows: [{ id: "a1", name: "Blockwork", unit: "m2" }] },
  { projectId: "p1", kind: "boq_lines", rows: [{ id: "l1", item_code: "01", description: "Blocks", unit: "nos", quantity: "200" }] },
  { projectId: "p1", kind: "progress", rows: [{ id: "e1", activity_id: "a1", boq_line_item_id: "l1", entry_date: "2026-10-01", quantity_done: 10, percent_complete: 5, entry_basis: "DELTA", remarks: "Grid A" }] },
  {
    projectId: "p1", kind: "roster", hidden: opts.hidden ? ["daily_rate"] : [],
    // a hidden rate the row still carries (never trusted over the marker): 7777 must never appear on screen
    rows: [{ id: "w1", name: "Ravi", trade: "mason", employee_code: "M-01", is_active: true, daily_rate: opts.hidden ? 7777 : 900 }],
  },
  { projectId: "p1", kind: "attendance", hidden: opts.hidden ? ["daily_cost"] : [], rows: [{ id: "t1", roster_id: "w1", attendance_date: "2026-10-01", status: "present", hours_worked: 8, daily_cost: opts.hidden ? 8888 : 900 }] },
  { projectId: "p1", kind: "materials", rows: [{ id: "m1", name: "Cement", unit: "bag", reorder_level: 10, is_active: true, unit_cost: 410 }] },
  { projectId: "p1", kind: "material_receipts", rows: [{ id: "r1", material_id: "m1", received_date: "2026-09-20", quantity: 30, reference: "DN-1", unit_cost: 410 }] },
  { projectId: "p1", kind: "material_issues", rows: [{ id: "i1", material_id: "m1", issued_date: "2026-09-25", quantity: 25, issued_to: "Crew" }] },
  { projectId: "p1", kind: "tasks", rows: [{ id: "t-1", number: 1, title: "Structure", start_date: "2026-10-01", due_date: "2026-10-20", completion_percentage: 30 }] },
  { projectId: "p1", kind: "milestones", rows: [{ id: "ms1", name: "Handover", target_date: "2026-10-20" }] },
];

async function seedLaptop(opts: { hidden?: boolean; userId?: string } = {}) {
  // p2 is on the laptop's manifest but none of its kinds finished copying
  await seedDelivery(idb, PAIRS(opts), { userId: opts.userId ?? "u1", projectIds: ["p1", "p2"], at: NOW });
  const device = await openDeviceMeta(idb);
  await device.meta.setMeta(shellManifestKey("u1"), { at: NOW, user: { id: "u1", name: "Asha Rao", role: "site_engineer", org_id: "orgA" }, projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }, { id: "p2", name: "Annexe", status: "active" }] });
  device.close();
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identity);
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

const noDialog = () => document.querySelector('[role="dialog"], [role="alertdialog"], [role="alert"]') === null;

describe("the delivery screens open OFFLINE from the laptop's own copy", () => {
  test("Work Progress: the entries list with names resolved locally, and the Daily Entry form", async () => {
    await seedLaptop();
    go("/local/work-progress?projectId=p1");
    const { findByTestId, getAllByTestId, getByTestId } = render(<LocalShell />);
    expect((await findByTestId("work-progress")).getAttribute("data-state")).toBe("local");
    const row = getAllByTestId("work-progress-row")[0]!.textContent!;
    expect(row).toContain("Blockwork");
    expect(row).toContain("01 · Blocks");
    expect(getByTestId("work-progress-form")).not.toBeNull();
    expect(fetchCalls).toEqual([]);
    expect(noDialog()).toBe(true);
  });

  test("Labour, Materials and Schedule open with their data; stock is the laptop's count; the critical path waits for the server", async () => {
    await seedLaptop();
    go("/local/labour?projectId=p1");
    const labour = render(<LocalShell />);
    expect((await labour.findAllByTestId("labour-roster-row"))[0]!.textContent).toContain("Ravi");
    expect(labour.getAllByTestId("labour-roster-row")[0]!.textContent).toContain("900");
    cleanup();

    go("/local/materials?projectId=p1");
    const materials = render(<LocalShell />);
    const cement = (await materials.findAllByTestId("materials-row"))[0]!.textContent!;
    expect(cement).toContain("Cement");
    expect(cement).toContain("5 · low"); // 30 received - 25 issued, below the reorder level of 10
    cleanup();

    go("/local/schedule?projectId=p1");
    const schedule = render(<LocalShell />);
    expect((await schedule.findAllByTestId("schedule-row"))[0]!.textContent).toContain("Structure");
    expect(schedule.getByTestId("schedule-critical-note").textContent).toContain("recalculated when online");
    expect(schedule.getAllByTestId("schedule-bar")).toHaveLength(1);
    expect(fetchCalls).toEqual([]);
  });

  test("a role without cost visibility: 'Hidden for your role', never the value a row carries", async () => {
    await seedLaptop({ hidden: true });
    go("/local/labour?projectId=p1");
    const { findAllByTestId, getByTestId } = render(<LocalShell />);
    const row = (await findAllByTestId("labour-roster-row"))[0]!.textContent!;
    expect(row).toContain("Hidden for your role");
    expect(getByTestId("labour").textContent).not.toContain("7,777");
    expect(getByTestId("labour").textContent).not.toContain("7777");
    cleanup();
    go("/local/labour/w1?projectId=p1");
    const worker = render(<LocalShell />);
    const text = (await worker.findByTestId("labour-worker")).textContent!;
    expect(text).not.toMatch(/7,?777|8,?888/);
    expect(text).toContain("Hidden for your role");
  });

  test("the money cell on its own: a hidden field never prints its value, even when handed one (the adapters null it too)", () => {
    const { container } = render(<div><Money value={7777} hidden /><Money value={null} hidden={false} /></div>);
    expect(container.textContent).toBe("Hidden for your role—");
  });

  test("a project not copied yet: calm words, no dialog, nothing fetched", async () => {
    await seedLaptop();
    go("/local/materials?projectId=p2");
    const r = render(<LocalShell />);
    const screen = await r.findByTestId("materials");
    expect(screen.getAttribute("data-state")).toBe("not_synced");
    expect(screen.textContent).toContain("has not finished copying");
    expect(fetchCalls).toEqual([]);
    expect(noDialog()).toBe(true);
  });

  test("another person's copy on the same laptop contributes nothing", async () => {
    // the rows are in u2's database only; u1 is signed in on this laptop
    await seedLaptop({ userId: "u2" });
    go("/local/schedule?projectId=p1");
    const other = render(<LocalShell />);
    expect((await other.findByTestId("schedule")).getAttribute("data-state")).toBe("not_synced");
    expect(fetchCalls).toEqual([]);
    expect(noDialog()).toBe(true);
  });

  test("/labour/new is not read as a worker id: offline it opens the add-worker form on the laptop (G-15)", async () => {
    await seedLaptop();
    go("/local/labour/new?projectId=p1");
    const { findByTestId, queryByTestId } = render(<LocalShell />);
    await findByTestId("labour-worker-form");
    expect(queryByTestId("delivery-server-only")).toBeNull();
    expect(noDialog()).toBe(true);
  });

  test("/labour/import is still the server's (calm note offline)", async () => {
    await seedLaptop();
    go("/local/labour/import?projectId=p1");
    const { findByTestId } = render(<LocalShell />);
    const note = await findByTestId("delivery-server-only");
    expect(note.getAttribute("data-online")).toBe("0");
    expect(note.textContent).toContain("Importing a roster");
  });
});

describe("the daily writes are kept on the laptop with the network off", () => {
  test("a progress entry: saved -> shown at once as 'Waiting to sync' -> one record_work_progress op in the outbox, nothing fetched", async () => {
    await seedLaptop();
    go("/local/work-progress?projectId=p1");
    const { findByTestId, getByLabelText, getByTestId, getAllByTestId } = render(<LocalShell />);
    await findByTestId("work-progress-form");
    fireEvent.change(getByLabelText("BOQ line"), { target: { value: "l1" } });
    // React's onChange on a text input listens to `input` events (a <select> to `change`)
    fireEvent.input(getByLabelText("Quantity done"), { target: { value: "12" } });
    fireEvent.input(getByLabelText("Date"), { target: { value: "2026-10-02" } });
    expect([(getByLabelText("BOQ line") as HTMLSelectElement).value, (getByLabelText("Quantity done") as HTMLInputElement).value, (getByLabelText("Date") as HTMLInputElement).value]).toEqual(["l1", "12", "2026-10-02"]);
    fireEvent.submit(getByTestId("work-progress-form"));

    await waitFor(() => expect(getByTestId("save-note").textContent).toContain("will be sent to the server when you are connected"));
    expect(getByTestId("save-note").getAttribute("data-ok")).toBe("1");
    await waitFor(() => expect(getAllByTestId("work-progress-row")).toHaveLength(2));
    expect(getAllByTestId("work-progress-row")[0]!.textContent).toContain("Waiting to sync");
    const ops = await outbox!.listPending();
    expect(ops.map((o) => [o.functionId, o.params])).toEqual([["record_work_progress", { projectId: "p1", boqLineItemId: "l1", entryDate: "2026-10-02", quantityDone: 12 }]]);
    expect(fetchCalls).toEqual([]);
  });

  test("the attendance sheet: one tap marks a worker, kept and shown as waiting; nothing fetched", async () => {
    await seedLaptop();
    go("/local/labour/attendance/2026-10-02?projectId=p1");
    const { findAllByTestId, getAllByTestId, getByText } = render(<LocalShell />);
    await findAllByTestId("labour-sheet-row");
    expect(getAllByTestId("labour-sheet-row")[0]!.textContent).toContain("Not marked");
    fireEvent.click(getByText("Half day"));
    await waitFor(() => expect(getAllByTestId("labour-sheet-row")[0]!.textContent).toContain("Waiting to sync"));
    expect(getAllByTestId("labour-sheet-row")[0]!.textContent).toContain("Half day");
    const ops = await outbox!.listPending();
    expect(ops.map((o) => o.functionId)).toEqual(["record_attendance"]);
    expect(ops[0]!.params).toEqual({ projectId: "p1", rosterId: "w1", date: "2026-10-02", status: "half_day" });
    expect(fetchCalls).toEqual([]);
  });

  test("G-15 a new worker: saved on the laptop, ONE add_roster_entry op in the outbox, nothing fetched", async () => {
    await seedLaptop();
    go("/local/labour/new?projectId=p1");
    const { findByTestId, getByLabelText, getByTestId } = render(<LocalShell />);
    await findByTestId("labour-worker-form");
    fireEvent.input(getByLabelText("Name"), { target: { value: "A. Worker" } });
    fireEvent.input(getByLabelText("Trade"), { target: { value: "Mason" } });
    fireEvent.input(getByLabelText("Daily rate"), { target: { value: "800" } });
    fireEvent.submit(getByTestId("labour-worker-form"));
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("1"));
    const ops = await outbox!.listPending();
    expect(ops.map((o) => [o.functionId, o.params])).toEqual([["add_roster_entry", { projectId: "p1", name: "A. Worker", dailyRate: 800, trade: "Mason" }]]);
    expect(fetchCalls).toEqual([]);
  });

  test("G-15 a new material: ONE create_material op; a blank unit is stopped before anything is kept", async () => {
    await seedLaptop();
    go("/local/materials/new?projectId=p1");
    const { findByTestId, getByLabelText, getByTestId } = render(<LocalShell />);
    await findByTestId("material-new-form");
    fireEvent.input(getByLabelText("Name"), { target: { value: "Sand, fine" } });
    fireEvent.submit(getByTestId("material-new-form")); // no unit
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("0"));
    expect(await outbox?.listPending() ?? []).toEqual([]);
    fireEvent.input(getByLabelText("Unit (bag, cum, nos ...)"), { target: { value: "cum" } });
    fireEvent.input(getByLabelText("Unit cost (optional)"), { target: { value: "1800" } });
    fireEvent.submit(getByTestId("material-new-form"));
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("1"));
    const ops = await outbox!.listPending();
    expect(ops.map((o) => [o.functionId, o.params])).toEqual([["create_material", { projectId: "p1", name: "Sand, fine", unit: "cum", unitCost: 1800 }]]);
    expect(fetchCalls).toEqual([]);
  });

  test("G-15 a new task: ONE create_schedule_task op with its dates; a due date before the start is stopped", async () => {
    await seedLaptop();
    go("/local/schedule/tasks/new?projectId=p1");
    const { findByTestId, getByLabelText, getByTestId } = render(<LocalShell />);
    await findByTestId("schedule-task-form");
    fireEvent.input(getByLabelText("Title"), { target: { value: "Pour slab" } });
    fireEvent.input(getByLabelText("Start date"), { target: { value: "2026-10-05" } });
    fireEvent.input(getByLabelText("Due date (optional)"), { target: { value: "2026-10-01" } });
    fireEvent.submit(getByTestId("schedule-task-form"));
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("0"));
    expect(await outbox?.listPending() ?? []).toEqual([]);
    fireEvent.input(getByLabelText("Due date (optional)"), { target: { value: "2026-10-09" } });
    fireEvent.submit(getByTestId("schedule-task-form"));
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("1"));
    const ops = await outbox!.listPending();
    expect(ops.map((o) => [o.functionId, o.params])).toEqual([["create_schedule_task", { projectId: "p1", title: "Pour slab", startDate: "2026-10-05", dueDate: "2026-10-09" }]]);
    expect(fetchCalls).toEqual([]);
  });

  test("issuing more than the laptop counts on hand is stopped in words before anything is kept", async () => {
    await seedLaptop();
    go("/local/materials/issues/new?projectId=p1&materialId=m1");
    const { findByTestId, getByLabelText, getByTestId } = render(<LocalShell />);
    await findByTestId("material-issue-form");
    fireEvent.input(getByLabelText("Quantity"), { target: { value: "6" } });
    fireEvent.submit(getByTestId("material-issue-form"));
    await waitFor(() => expect(getByTestId("material-issue-too-much").textContent).toContain("Only 5 bag is on hand"));
    expect(await outbox?.listPending() ?? []).toEqual([]);
    expect(noDialog()).toBe(true);
  });
});
