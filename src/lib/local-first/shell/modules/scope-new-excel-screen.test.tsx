import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, setDefaultTimeout, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "../../__fixtures__/fake-sync-server";
import { DOTTED_CODES_XLSX_BASE64, SUMEET_SHAPED_XLSX_BASE64 } from "../../boq-excel/__fixtures__/boq-excel-fixtures";
import { createIdentityStore, type DurableIdentity } from "../../identity";
import { openDeviceMeta } from "../../device-meta";
import { createOutbox, type Outbox } from "../../outbox";
import { shellManifestKey } from "../manifest-cache";
import { seedDelivery } from "./delivery-test-seed";

// Sumeet R-70..R-72 / checklist 3.1 inside the REAL shell with the NETWORK OFF: an .xlsx chosen on New BOQ is read on the laptop, previewed with its
// problems named by sheet row, and (when nothing blocks) fills the grid; Save then keeps ONE create_boq in the outbox. Not one request leaves the laptop.

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

async function seedLaptop(role = "manager") {
  await seedDelivery(idb, [{ projectId: "p1", kind: "boqs", rows: [] }], { userId: "u1", projectIds: ["p1"], at: NOW });
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
const file = (b64: string, name: string) => new File([new Uint8Array(Buffer.from(b64, "base64"))], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

describe("New BOQ: Excel import with no network", () => {
  test("a clean sheet: previewed, 'Use these lines' fills the grid and the title, Save keeps ONE create_boq with the imported lines, nothing fetched", async () => {
    await seedLaptop();
    go("/local/scope/new?projectId=p1");
    const { findByTestId, getByTestId, getAllByTestId } = render(<LocalShell />);
    await findByTestId("scope-new-excel-file", {}, T);
    fireEvent.change(getByTestId("scope-new-excel-file"), { target: { files: [file(DOTTED_CODES_XLSX_BASE64, "Civil Works P1.xlsx")] } });
    await findByTestId("scope-new-excel-preview", {}, T);
    expect(getAllByTestId("scope-new-excel-row").map((r) => r.getAttribute("data-sub"))).toEqual(["0", "1", "1"]);
    expect(getByTestId("scope-new-excel-table").textContent).toContain("2.10");
    expect(document.querySelector('[data-testid="scope-new-excel-issues"]')).toBeNull();
    fireEvent.click(getByTestId("scope-new-excel-use"));
    await waitFor(() => expect((getByTestId("scope-new-title") as HTMLInputElement).value).toBe("Civil Works P1"), { timeout: 5_000 });
    expect((getByTestId("scope-new-0-description") as HTMLInputElement).value).toBe("Main: RCC Column Work");
    expect((getByTestId("scope-new-1-parentItemCode") as HTMLInputElement).value).toBe("2");
    expect((getByTestId("scope-new-1-breakdownPercentage") as HTMLInputElement).value).toBe("40");
    fireEvent.submit(getByTestId("scope-new-save").closest("form")!);
    await waitFor(async () => expect((await outbox!.listPending()).length).toBe(1), { timeout: 5_000 });
    const [op] = await outbox!.listPending();
    expect(op!.functionId).toBe("create_boq");
    expect(op!.params).toMatchObject({ projectId: "p1", title: "Civil Works P1" });
    expect((op!.params.lineItems as Record<string, unknown>[]).map((l) => [l.itemCode, l.parentItemCode ?? null, l.quantity, l.rate, l.breakdownPercentage ?? null])).toEqual([
      ["2", null, 100, 50, null],
      ["2.10", "2", 0, 0, 40],
      ["2.20", "2", 0, 0, 60],
    ]);
    expect(fetchCalls).toEqual([]);
  }, 20_000);

  test("a sheet with a problem (a Qty that is not a number): the row is named, the button is off, the grid is not touched", async () => {
    await seedLaptop();
    go("/local/scope/new?projectId=p1");
    const { findByTestId, getByTestId, getAllByTestId } = render(<LocalShell />);
    await findByTestId("scope-new-excel-file", {}, T);
    fireEvent.change(getByTestId("scope-new-excel-file"), { target: { files: [file(SUMEET_SHAPED_XLSX_BASE64, "Sumeet BOQ.xlsx")] } });
    await findByTestId("scope-new-excel-preview", {}, T);
    expect(getByTestId("scope-new-excel-preview").textContent).toContain("1 problem to fix first");
    const issues = getAllByTestId("scope-new-excel-issues")[0]!.querySelectorAll("li");
    expect([...issues].map((li) => [li.textContent, li.getAttribute("data-blocking")])).toEqual([
      ['Row 2: skipped (category header: "PARTITION AND LINING")', "0"],
      ['Row 6: skipped (category header: "FALSE CEILING")', "0"],
      ["Row 8: Qty is not a number", "1"],
    ]);
    expect((getByTestId("scope-new-excel-use") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(getByTestId("scope-new-excel-use"));
    expect((getByTestId("scope-new-title") as HTMLInputElement).value).toBe("");
    expect(outbox ? await outbox.listPending() : []).toEqual([]);
  }, 20_000);

  test("a file that is not a workbook is refused in words and nothing changes", async () => {
    await seedLaptop();
    go("/local/scope/new?projectId=p1");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("scope-new-excel-file", {}, T);
    fireEvent.change(getByTestId("scope-new-excel-file"), { target: { files: [new File(["Description,Qty,Rate\nSlab,1,2"], "boq.xlsx")] } });
    await findByTestId("scope-new-excel-error", {}, T);
    expect(getByTestId("scope-new-excel-error").textContent).toContain("not an Excel");
    expect(document.querySelector('[data-testid="scope-new-excel-preview"]')).toBeNull();
  }, 20_000);
});
