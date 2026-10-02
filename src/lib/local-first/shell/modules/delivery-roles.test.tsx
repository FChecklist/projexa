import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "../../__fixtures__/fake-sync-server";
import { createIdentityStore, type DurableIdentity } from "../../identity";
import { openDeviceMeta } from "../../device-meta";
import { createOutbox, type Outbox } from "../../outbox";
import { shellManifestKey } from "../manifest-cache";
import { seedDelivery, type SeedPair } from "./delivery-test-seed";

// A person sees their own data AS PER ROLE: a read-only role (viewer, client viewer, external auditor, stage 0 -- rank 1 in the AI work
// link, below the rank 2 every delivery write needs) sees the delivery screens from the laptop but is never OFFERED a write there: no
// progress form, no "Mark attendance", no mark buttons on the day's sheet, no "Record receipt" / "Issue material", and a form opened by
// its address says why instead of taking input the server would refuse. Before lf-e10a (2026-10-02) every one of them was offered to a
// viewer. The check only DECLINES to offer: the server decides every op again under the person's live role.
//
// Rendered inside the REAL shell with the network OFF (same arrangement as delivery-screens.test.tsx).

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
const DAY = "2026-10-01";

function go(path: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`https://px.test${path}`);
}

const PAIRS: SeedPair[] = [
  { projectId: "p1", kind: "activities", rows: [{ id: "a1", name: "Blockwork", unit: "m2" }] },
  { projectId: "p1", kind: "boq_lines", rows: [{ id: "l1", item_code: "01", description: "Blocks", unit: "nos", quantity: "200" }] },
  { projectId: "p1", kind: "progress", rows: [{ id: "e1", activity_id: "a1", boq_line_item_id: "l1", entry_date: DAY, quantity_done: 10, percent_complete: 5, entry_basis: "DELTA" }] },
  { projectId: "p1", kind: "roster", rows: [{ id: "w1", name: "Ravi", trade: "mason", is_active: true, daily_rate: 900 }] },
  { projectId: "p1", kind: "attendance", rows: [{ id: "t1", roster_id: "w1", attendance_date: DAY, status: "present", hours_worked: 8, daily_cost: 900 }] },
  { projectId: "p1", kind: "materials", rows: [{ id: "m1", name: "Cement", unit: "bag", is_active: true, unit_cost: 410 }] },
  { projectId: "p1", kind: "material_receipts", rows: [{ id: "r1", material_id: "m1", received_date: "2026-09-20", quantity: 30, reference: "DN-1" }] },
  { projectId: "p1", kind: "material_issues", rows: [] },
];

async function seedLaptop(role: string) {
  await seedDelivery(idb, PAIRS, { userId: "u1", projectIds: ["p1"], at: NOW });
  const device = await openDeviceMeta(idb);
  await device.meta.setMeta(shellManifestKey("u1"), { at: NOW, user: { id: "u1", name: "Asha Rao", role, org_id: "orgA" }, projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }] });
  device.close();
  const identity: DurableIdentity = {
    userId: "u1", email: "asha@example.com", name: "Asha Rao", orgId: "orgA", role, lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 },
  };
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identity);
}

beforeEach(() => {
  idb = new IDBFactory();
  outbox = null;
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
  localStorage.clear();
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
});
afterEach(() => cleanup());

const q = "?projectId=p1";

/** Opens a shell screen and returns its rendered element once its data is drawn. */
async function screen(path: string, testId: string) {
  go(`/local${path}`);
  const view = render(<LocalShell />);
  const el = await view.findByTestId(testId);
  expect(el.getAttribute("data-state")).toBe("local");
  return { el, view };
}

// Booleans and strings only: a failing expect on a DOM element prints the whole document.
const has = (view: { queryByTestId: (id: string) => HTMLElement | null }, id: string) => view.queryByTestId(id) !== null;
const links = (el: HTMLElement) => Array.from(el.querySelectorAll("a")).map((a) => a.textContent);
const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll("button")).map((b) => b.textContent);

describe("a read-only role (viewer) sees the delivery screens but is offered no write", () => {
  test("work progress: the entries, no entry form, and why", async () => {
    await seedLaptop("viewer");
    const { el, view } = await screen(`/work-progress${q}`, "work-progress");
    expect(view.getAllByTestId("work-progress-row")).toHaveLength(1);
    expect(has(view, "work-progress-form")).toBe(false);
    expect(view.queryByTestId("delivery-read-only")?.textContent).toBe("Your role can see this but not change it.");
    expect(buttons(el)).not.toContain("Save entry");
  });

  test("labour: no 'Mark attendance'; the day's sheet has no mark buttons; the form by its address takes nothing", async () => {
    await seedLaptop("viewer");
    let s = await screen(`/labour${q}`, "labour");
    expect(s.view.getAllByTestId("labour-roster-row")).toHaveLength(1);
    expect(links(s.el)).not.toContain("Mark attendance");
    cleanup();
    s = await screen(`/labour/attendance/${DAY}${q}`, "labour-attendance-sheet");
    expect(s.view.getAllByTestId("labour-sheet-row")).toHaveLength(1);
    expect(buttons(s.el).filter((b) => ["Present", "Half day", "Absent"].includes(b ?? ""))).toEqual([]);
    cleanup();
    s = await screen(`/labour/attendance/new${q}`, "labour-attendance-new");
    expect(has(s.view, "labour-attendance-form")).toBe(false);
    expect(has(s.view, "delivery-read-only")).toBe(true);
    cleanup();
    s = await screen(`/labour/w1${q}`, "labour-worker");
    expect(links(s.el)).not.toContain("Mark attendance");
  });

  test("materials: no 'Record receipt' / 'Issue material' on the list or a material; the forms by their address take nothing", async () => {
    await seedLaptop("viewer");
    let s = await screen(`/materials${q}`, "materials");
    expect(s.view.getAllByTestId("materials-row")).toHaveLength(1);
    expect(links(s.el)).not.toContain("Record receipt");
    expect(links(s.el)).not.toContain("Issue material");
    cleanup();
    s = await screen(`/materials/m1${q}`, "material");
    expect(links(s.el)).not.toContain("Record receipt");
    expect(links(s.el)).not.toContain("Issue material");
    cleanup();
    s = await screen(`/materials/receipts/new${q}`, "material-receipt-new");
    expect(has(s.view, "material-receipt-form")).toBe(false);
    expect(has(s.view, "delivery-read-only")).toBe(true);
    cleanup();
    s = await screen(`/materials/issues/new${q}`, "material-issue-new");
    expect(has(s.view, "material-issue-form")).toBe(false);
    expect(has(s.view, "delivery-read-only")).toBe(true);
  });
});

describe("a role that may write (member, manager) is offered every write, as before", () => {
  for (const role of ["member", "manager"]) {
    test(`${role}: the forms, the links and the mark buttons are there`, async () => {
      await seedLaptop(role);
      let s = await screen(`/work-progress${q}`, "work-progress");
      expect(has(s.view, "work-progress-form")).toBe(true);
      expect(has(s.view, "delivery-read-only")).toBe(false);
      cleanup();
      s = await screen(`/labour${q}`, "labour");
      expect(links(s.el)).toContain("Mark attendance");
      cleanup();
      s = await screen(`/labour/attendance/${DAY}${q}`, "labour-attendance-sheet");
      expect(buttons(s.el)).toEqual(expect.arrayContaining(["Present", "Half day", "Absent"]));
      cleanup();
      s = await screen(`/materials${q}`, "materials");
      expect(links(s.el)).toEqual(expect.arrayContaining(["Record receipt", "Issue material"]));
      cleanup();
      s = await screen(`/materials/receipts/new${q}`, "material-receipt-new");
      expect(has(s.view, "material-receipt-form")).toBe(true);
      cleanup();
      s = await screen(`/materials/issues/new${q}`, "material-issue-new");
      expect(has(s.view, "material-issue-form")).toBe(true);
    });
  }
});
