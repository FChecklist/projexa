import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { createIdentityStore, type DurableIdentity } from "../../identity";
import { openDeviceMeta } from "../../device-meta";
import { createOutbox, type Outbox } from "../../outbox";
import { createFakeSyncServer } from "../../__fixtures__/fake-sync-server";
import { shellManifestKey } from "../manifest-cache";
import { findShellRoute } from "../route-table";
import { seedPerson } from "./documents-test-fixtures";
import { siteWriteDeps } from "./site-writes";
const realReplicaShared = await import("../../replica-shared");
mock.module("../../replica-shared", () => ({ ...realReplicaShared, revalidateViaSharedReplica: async () => {} }));
const { default: LocalShell } = await import("../LocalShell");

// R-C14 Site Instructions inside the REAL shell with the NETWORK OFF: open the list from the laptop's own copy, record an instruction,
// see it in the list as "Waiting to sync" with no SI number, and not one request leaves the laptop.

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key-not-a-real-credential";

const NOW = 1_760_000_000_000;
const ORIGIN = "https://px.test";
const realFetch = globalThis.fetch;
let idb: IDBFactory;
let outbox: Outbox;
let fetchCalls: string[];

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}
const go = (path: string) => (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${ORIGIN}${path}`);

async function seedLaptop(role = "manager") {
  await seedPerson(idb, "u1", [
    { projectId: "p1", kind: "site_instructions", data: { id: "si1", si_number: 3, issue_date: "2026-09-01", to_contractor: "Ace Builders", description: "Hold the pour until the lintel is checked", drawing_ref: "A-100", cost_impact: false, time_impact: true } },
  ], { kinds: ["site_instructions"] });
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
  outbox = createOutbox({ userId: "u1", client: createFakeSyncServer().client, deviceId: "dev-1", idb, autoFlush: false, locks: null, sleep: async () => {} });
  siteWriteDeps.outbox = outbox;
  setOnline(false);
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  siteWriteDeps.outbox = undefined;
  setOnline(true);
});

const SAVE_WAIT_MS = 5_000;

describe("site instructions, offline, in the shell", () => {
  test("the routes are registered and 'new' is never read as an id", () => {
    expect(findShellRoute("/site-instructions")!.route.pattern).toBe("/site-instructions");
    expect(findShellRoute("/site-instructions/new")!.route.pattern).toBe("/site-instructions/new");
  });

  test("the list opens from the laptop's copy; a new instruction is saved, ONE create_site_instruction op, listed as Waiting to sync with no number; nothing fetched", async () => {
    await seedLaptop();
    go("/local/site-instructions?projectId=p1");
    const first = render(<LocalShell />);
    await first.findByTestId("si-list");
    expect(first.getAllByTestId("si-row")).toHaveLength(1);
    expect(first.getByTestId("si-row").textContent).toContain("SI-3");
    expect(first.getByTestId("si-row").textContent).toContain("Time");
    cleanup();

    go("/local/site-instructions/new?projectId=p1");
    const { findByTestId, getByLabelText, getByTestId } = render(<LocalShell />);
    await findByTestId("si-form");
    fireEvent.input(getByLabelText("To contractor"), { target: { value: "Ace Builders" } });
    fireEvent.input(getByLabelText("Instruction"), { target: { value: "Change the lintel to 200 mm" } });
    fireEvent.click(getByLabelText("Changes the cost"));
    fireEvent.submit(getByTestId("si-form"));
    // after a good save the form is left for the list (the online form lands on the created item); the new row is there, waiting
    await waitFor(() => expect(getByTestId("si-list")).toBeTruthy(), { timeout: SAVE_WAIT_MS });
    expect(window.location.pathname).toBe("/local/site-instructions");
    const ops = await outbox.listPending();
    expect(ops.map((o) => o.functionId)).toEqual(["create_site_instruction"]);
    expect(ops[0]!.params).toMatchObject({ projectId: "p1", toContractor: "Ace Builders", description: "Change the lintel to 200 mm", costImpact: true });
    expect("timeImpact" in ops[0]!.params).toBe(false);
    cleanup();

    go("/local/site-instructions?projectId=p1");
    const list = render(<LocalShell />);
    await waitFor(() => expect(list.getAllByTestId("si-row")).toHaveLength(2));
    const rows = list.getAllByTestId("si-row").map((r) => r.textContent!);
    expect(rows.find((t) => t.includes("Change the lintel"))).toContain("Waiting to sync");
    expect(rows.find((t) => t.includes("Change the lintel"))).not.toContain("SI-");
    // a sent instruction (SI-3) opens its page, where Add file lives; the waiting one has no server page yet, so no link
    const links = list.getAllByTestId("si-open");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("/site-instructions/si1?projectId=p1");
    expect(fetchCalls).toEqual([]);
  });

  test("an empty instruction is stopped before anything is kept", async () => {
    await seedLaptop();
    go("/local/site-instructions/new?projectId=p1");
    const { findByTestId, getByLabelText, getByTestId } = render(<LocalShell />);
    await findByTestId("si-form");
    fireEvent.input(getByLabelText("To contractor"), { target: { value: "Ace" } });
    fireEvent.submit(getByTestId("si-form"));
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("0"), { timeout: SAVE_WAIT_MS });
    expect(await outbox.listPending()).toEqual([]);
    expect(fetchCalls).toEqual([]);
    expect(window.location.pathname).toBe("/local/site-instructions/new"); // a refused save stays on the form
  });

  test("the screen says plainly that the file and the BOQ are added online, and a read-only role gets no form", async () => {
    await seedLaptop();
    go("/local/site-instructions/new?projectId=p1");
    const a = render(<LocalShell />);
    await a.findByTestId("si-form");
    expect(a.getByTestId("needs-connection").textContent).toContain("PDF or photo");
    expect(a.getByTestId("needs-connection").textContent).toContain("Add file");
    cleanup();

    idb = new IDBFactory();
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
    await seedLaptop("viewer");
    go("/local/site-instructions/new?projectId=p1");
    const b = render(<LocalShell />);
    await b.findByTestId("si-new");
    expect(b.queryByTestId("si-form")).toBeNull();
    expect(b.getByTestId("delivery-read-only")).toBeTruthy();
  });
});
