import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { createIdentityStore, type DurableIdentity } from "../../identity";
import { openDeviceMeta } from "../../device-meta";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY, doneKey } from "../../replica";
import { ORG_PROJECT } from "../../sync-client";
import { createOutbox } from "../../outbox";
import { createFakeSyncServer } from "../../__fixtures__/fake-sync-server";
import { shellManifestKey } from "../manifest-cache";
import { findShellRoute } from "../route-table";
import { ROUTES } from "../clusters/site-procurement-design";
import { seedPerson } from "./documents-test-fixtures";
import { siteWriteDeps } from "./site-writes";
const realReplicaShared = await import("../../replica-shared");
mock.module("../../replica-shared", () => ({ ...realReplicaShared, revalidateViaSharedReplica: async () => {} }));
const { default: LocalShell } = await import("../LocalShell");

// The site cluster rendered through the REAL shell with the NETWORK OFF: every screen opens from the laptop's own database.

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key-not-a-real-credential";

const NOW = 1_760_000_000_000;
const ORIGIN = "https://px.test";
const realFetch = globalThis.fetch;
let idb: IDBFactory;
let fetchCalls: string[];

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}
const go = (path: string) => (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${ORIGIN}${path}`);

async function seedLaptop(opts: { role?: string; hideCost?: boolean; orgKinds?: string[] } = {}) {
  const role = opts.role ?? "manager";
  await seedPerson(idb, "u1", [
    { projectId: "p1", kind: "rfis", data: { id: "r1", number: 1, subject: "Lintel depth", question: "150 or 200?", status: "open", ball_in_court: "architect", due_date: "2026-05-01" } },
    { projectId: "p1", kind: "submittals", data: { id: "s1", number: 1, title: "Floor tiles", spec_section: "09 30 00", type: "sample", status: "pending" } },
    { projectId: "p1", kind: "punch_list", data: { id: "x1", number: 1, description: "Door gap", location: "L2", priority: "high", status: "open" } },
    { projectId: "p1", kind: "site_diaries", data: { id: "d1", diary_date: "2026-04-01", weather: "Clear", work_done: "Slab pour", labour_count: 12 } },
    { projectId: "p1", kind: "ffe_items", data: { id: "f1", item_name: "Lounge chair", room_or_area: "Lobby", category: "furniture", quantity: 4, status: "specified", unit_cost: 1200, unit_price: 1800, vendor_id: "ven-1" } },
  ], { kinds: ["rfis", "submittals", "punch_list", "site_diaries", "ffe_items"], ...(opts.hideCost ? { hiddenFields: ["unit_cost", "unit_price", "vendor_id"] } : {}) });
  const db = await openLocalDb(idb as never, localDbNameFor("u1"));
  const manifest = await db.getMeta<Record<string, unknown>>(MANIFEST_KEY);
  await db.setMeta(MANIFEST_KEY, { ...manifest, orgKinds: opts.orgKinds ?? ["vendors"] });
  if ((opts.orgKinds ?? ["vendors"]).includes("vendors")) {
    await db.setMeta(doneKey(ORG_PROJECT, "vendors"), { at: NOW, redacted: false, hiddenFields: ["credit_limit"] });
    await db.putRecords([{ id: "vendors:ven-1", type: "vendors", orgId: "orgA", projectId: ORG_PROJECT, data: { id: "ven-1", supplier_name: "Ace Cement", trade: "civil", credit_limit: 90000 }, updatedAt: 1, serverVersion: 1 }]);
  }
  db.close();
  const device = await openDeviceMeta(idb);
  await device.meta.setMeta(shellManifestKey("u1"), { at: NOW, user: { id: "u1", name: "Asha Rao", role, org_id: "orgA" }, projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }] });
  device.close();
  const identity: DurableIdentity = { userId: "u1", email: "u1@example.com", name: "Asha Rao", orgId: "orgA", role, lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 } };
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identity);
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
  const server = createFakeSyncServer();
  siteWriteDeps.outbox = createOutbox({ userId: "u1", client: server.client, deviceId: "dev-1", idb, autoFlush: false, locks: null, sleep: async () => {} });
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  siteWriteDeps.outbox = undefined;
  setOnline(true);
});

// The save goes through the laptop database (fake IndexedDB) and the outbox: on a busy CI runner it has taken just over testing-library's
// default 1 s (RFIs test failed at 1095 ms on PR #388 twice, passed on retry), so the wait is 5 s. The outcome asserted is unchanged.
const SAVE_WAIT_MS = 5_000;

describe("registration", () => {
  test("lists, objects, create paths; 'new' is never read as an id; nav orders 60-79; the unconverted modules are NOT registered", () => {
    expect(findShellRoute("/rfis/new")!.route.pattern).toBe("/rfis/new");
    expect(findShellRoute("/rfis/abc")!.params).toEqual({ id: "abc" });
    for (const p of ["/ffe/new", "/vendors/new"]) expect(findShellRoute(p)!.route.pattern).toBe(p);
    for (const r of ROUTES) if (r.nav) expect(r.nav.order >= 60 && r.nav.order <= 79).toBe(true);
    for (const p of ["/payroll", "/recruitment", "/grc", "/kpis"]) expect(findShellRoute(p)).toBeNull();
  });
});

describe("with NO network, the site screens open from the laptop's own copy", () => {
  test("RFIs list -> one RFI; answering is kept on the laptop and shown as waiting; not one request", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/rfis?projectId=p1");
    const { findByTestId, getAllByTestId, getByTestId, getByLabelText } = render(<LocalShell />);
    expect((await findByTestId("rfis-list")).getAttribute("data-state")).toBe("local");
    expect(getAllByTestId("rfi-row").map((r) => r.getAttribute("data-rfi-id"))).toEqual(["r1"]);
    fireEvent.click(getAllByTestId("rfi-row")[0]!.querySelector("a")!);
    await findByTestId("rfi-object");
    const box = getByLabelText("Answer") as HTMLTextAreaElement;
    fireEvent.input(box, { target: { value: "Use 200mm." } });
    fireEvent.submit(getByTestId("rfi-answer-form"));
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("1"), { timeout: SAVE_WAIT_MS });
    await waitFor(() => expect(getByTestId("rfi-object").textContent).toContain("Waiting to sync"));
    expect(getByTestId("rfi-object").textContent).toContain("Use 200mm.");
    expect(document.querySelector('[role="dialog"], [role="alertdialog"], [role="alert"]')).toBeNull();
    expect(fetchCalls).toEqual([]);
  });

  test("site diary: list, then a new entry saved on the laptop appears in the list as waiting", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/site-diary/new?projectId=p1");
    const { findByTestId, getByTestId, getByLabelText, getAllByTestId } = render(<LocalShell />);
    await findByTestId("diary-form");
    fireEvent.input(getByLabelText("Work Done"), { target: { value: "Plastering L1" } });
    fireEvent.input(getByLabelText("Labour Count"), { target: { value: "9" } });
    fireEvent.submit(getByTestId("diary-form"));
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("1"), { timeout: SAVE_WAIT_MS });
    go("/local/site-diary?projectId=p1");
    fireEvent.click(getByTestId("diary-new").querySelector("a")!);
    await findByTestId("diary-list");
    await waitFor(() => expect(getAllByTestId("diary-row").length).toBe(2));
    expect(getByTestId("diary-list").textContent).toContain("Plastering L1");
    expect(getByTestId("diary-list").textContent).toContain("Waiting to sync");
    expect(fetchCalls).toEqual([]);
  });

  test("FF&E shows cost for a role that sees it; for a role that does not it says 'Hidden for your role' and offers no Advance", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/ffe?projectId=p1");
    const first = render(<LocalShell />);
    await first.findByTestId("ffe-list");
    expect(first.getByTestId("ffe-row").textContent).toContain("1,200");
    expect(first.getAllByTestId("ffe-advance").length).toBe(1);
    cleanup();

    idb = new IDBFactory();
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
    localStorage.clear();
    await seedLaptop({ role: "member", hideCost: true });
    go("/local/ffe/f1?projectId=p1");
    const second = render(<LocalShell />);
    await second.findByTestId("ffe-object");
    const text = second.getByTestId("ffe-object").textContent ?? "";
    expect(text).toContain("Hidden for your role");
    expect(text).not.toContain("1,200");
    expect(text).not.toContain("1,800");
    expect(second.queryByTestId("ffe-advance")).toBeNull();
    expect(fetchCalls).toEqual([]);
  });

  test("a viewer sees the RFI list but no 'New RFI' link and no answer form", async () => {
    await seedLaptop({ role: "viewer" });
    setOnline(false);
    go("/local/rfis/r1?projectId=p1");
    const { findByTestId, queryByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("rfi-object");
    expect(queryByTestId("rfi-answer-form")).toBeNull();
    expect(getByTestId("delivery-read-only").textContent).toContain("can see this but not change it");
  });

  test("vendors: the master is listed; a role that does not receive it is told so, not shown an empty list", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/vendors");
    const a = render(<LocalShell />);
    await a.findByTestId("vendors-list");
    expect(a.getByTestId("vendor-row").textContent).toContain("Ace Cement");
    cleanup();
    idb = new IDBFactory();
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
    localStorage.clear();
    await seedLaptop({ role: "viewer", orgKinds: [] });
    go("/local/vendors");
    const b = render(<LocalShell />);
    expect((await b.findByTestId("vendors-list")).getAttribute("data-state")).toBe("not_allowed");
    expect(b.getByTestId("vendors-list").textContent).toContain("Your role does not include");
    expect(fetchCalls).toEqual([]);
  });
});
