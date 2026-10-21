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
import { readPendingOps } from "./design-change-rows";
import { designChangeWriteDeps } from "./DesignChangeShared";
import { seedDesignChange } from "./design-change-test-fixtures";
import { seedOrgKinds } from "./finance-test-seed";
// The replica pull after a sent edit talks to Supabase; here it is a no-op (the REAL module is spread first, see CLAUDE.md's mock.module() note).
const realReplicaShared = await import("../../replica-shared");
mock.module("../../replica-shared", () => ({ ...realReplicaShared, revalidateViaSharedReplica: async () => {} }));
const { default: LocalShell } = await import("../LocalShell");

// OFFLINE WRITERS 2: New BOQ and New Revision rendered through the REAL shell (route table, adapters, IndexedDB via fake-indexeddb, identity
// mirror) with the NETWORK OFF. Every save goes into a real outbox as ONE op, the screen says "Waiting to sync", not one request leaves the
// laptop, and what the server would refuse is refused here with nothing stored.

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
function go(path: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${ORIGIN}${path}`);
}
const identityFor = (userId: string, role: string): DurableIdentity => ({
  userId, email: `${userId}@example.com`, name: "Asha Rao", orgId: "orgA", role, lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 },
});

const BOQ = { id: "b1", project_id: "p1", title: "Original Scope", version: 1, status: "approved", parent_boq_id: null, created_at: "2026-09-01T08:00:00Z" };
const lineRow = (id: string, code: string, description: string, quantity: number, rate: number) => ({
  id, boq_id: "b1", item_code: code, description, unit: "sqm", quantity, rate, amount: quantity * rate, parent_line_item_id: null, activity_id: null,
  category: null, breakdown_percentage: null, created_at: "2026-09-01T08:00:00Z",
});
const progressRow = (id: string, lineId: string, pct: number) => ({ id, activity_id: "act1", boq_line_item_id: lineId, entry_date: "2026-09-20", quantity_done: pct, percent_complete: pct, created_at: "2026-09-20T08:00:00Z" });

async function seedLaptop(opts: { role?: string; progress?: boolean; moneyHidden?: boolean } = {}) {
  const done: Record<string, string[]> = { boqs: ["p1"], boq_lines: ["p1"], ...(opts.progress === false ? {} : { progress: ["p1"] }) };
  await seedDesignChange(idb, "u1", [
    { kind: "boqs", projectId: "p1", data: BOQ },
    { kind: "boq_lines", projectId: "p1", data: lineRow("li1", "A1", "Blockwork", 100, 50) },
    { kind: "boq_lines", projectId: "p1", data: lineRow("li2", "A2", "Plaster", 200, 20) },
    { kind: "boq_lines", projectId: "p1", data: lineRow("li3", "A3", "Paint", 300, 10) },
    { kind: "progress", projectId: "p1", data: progressRow("pr1", "li1", 40) },
  ], { done, hiddenFields: opts.moneyHidden ? { boq_lines: ["quantity", "rate", "amount"] } : {} });
  await seedOrgKinds(idb, [{ kind: "vendors", rows: [{ id: "v1", supplier_name: "Shree Cement" }] }], { at: NOW });
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

const type = (el: HTMLElement, value: string) => fireEvent.input(el, { target: { value } });


// GUIDED ERRORS (G1), laptop screens: every fault is told in the guided panel (what happened, why, what to do), the exact input is outlined, nothing
// is kept on the laptop for a faulty BOQ, and what was typed survives a trip away (the draft the online screen shares).
const ids = {
  title: "boq-title",
  line: (i: number, col: string) => `boq-line-${i}-${col}`,
};
const panelOf = (c: HTMLElement) => c.querySelector('[data-testid="guided-error"]') as HTMLElement | null;

describe("New BOQ on the laptop: faults are guided", () => {
  test("a negative quantity: the panel, the box outlined and marked, nothing queued; the corrected BOQ is queued and the draft is gone", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/scope/new?projectId=p1");
    const { findByTestId, getByTestId, container } = render(<LocalShell />);
    await findByTestId("scope-new-screen");
    type(getByTestId("scope-new-title"), "Civil Works");
    type(getByTestId("scope-new-0-description"), "Slab");
    type(getByTestId("scope-new-0-unit"), "cum");
    type(getByTestId("scope-new-0-quantity"), "-4");
    type(getByTestId("scope-new-0-rate"), "50");
    fireEvent.click(getByTestId("scope-new-save"));

    const panel = (await findByTestId("guided-error")) as HTMLElement;
    expect(panel.textContent).toContain("Line 1: Qty cannot be negative");
    expect(panel.querySelector('[data-testid="guided-error-steps"]')).not.toBeNull();
    const qty = container.querySelector(`[id="${ids.line(0, "quantity")}"]`) as HTMLInputElement;
    expect(qty.getAttribute("aria-invalid")).toBe("true");
    expect(qty.getAttribute("data-px-highlighted")).toBe("true");
    expect(getByTestId("scope-new-0-quantity-fault").textContent).toContain("cannot be negative");
    expect(await ops()).toEqual([]);
    expect(JSON.parse(sessionStorage.getItem("px-draft:boq-new:p1")!).value.lines[0].quantity).toBe("-4"); // kept

    type(getByTestId("scope-new-0-quantity"), "4");
    await waitFor(() => expect(panelOf(container)).toBeNull());
    fireEvent.click(getByTestId("scope-new-save"));
    await findByTestId("scope-object");
    expect((await ops()).map((o) => o.functionId)).toEqual(["create_boq"]);
    expect(sessionStorage.getItem("px-draft:boq-new:p1")).toBeNull();
  });

  test("each fault names ITS box: duplicate code, unknown parent, a share above 100", async () => {
    const cases: [string, Record<string, string>[], string, RegExp][] = [
      ["duplicate", [{ description: "A", unit: "m", quantity: "1", rate: "1", itemCode: "X" }, { description: "B", unit: "m", quantity: "1", rate: "1", itemCode: "X" }], ids.line(1, "itemCode"), /already used on line 1/],
      ["parent", [{ description: "A", unit: "m", quantity: "1", rate: "1", itemCode: "X" }, { description: "B", unit: "m", parentItemCode: "NOPE", breakdownPercentage: "10" }], ids.line(1, "parentItemCode"), /no line has the item code "NOPE"/],
      ["share", [{ description: "A", unit: "m", quantity: "1", rate: "1", itemCode: "X" }, { description: "B", unit: "m", parentItemCode: "X", breakdownPercentage: "180" }], ids.line(1, "breakdownPercentage"), /from 0 to 100/],
    ];
    for (const [name, lines, field, text] of cases) {
      sessionStorage.clear();
      sessionStorage.setItem("px-draft:boq-new:p1", JSON.stringify({ savedAt: Date.now(), value: { title: "T", lines: lines.map((l) => ({ category: "", itemCode: "", parentItemCode: "", breakdownPercentage: "", ...l })) } }));
      await seedLaptop();
      setOnline(false);
      go("/local/scope/new?projectId=p1");
      const { findByTestId, getByTestId, container, unmount } = render(<LocalShell />);
      await findByTestId("scope-new-screen");
      await waitFor(() => expect((getByTestId("scope-new-title") as HTMLInputElement).value).toBe("T"));
      fireEvent.click(getByTestId("scope-new-save"));
      const panel = (await findByTestId("guided-error")) as HTMLElement;
      expect(panel.textContent, name).toMatch(text);
      expect((container.querySelector(`[id="${field}"]`) as HTMLElement).getAttribute("aria-invalid"), name).toBe("true");
      expect(await ops(), name).toEqual([]);
      unmount();
    }
  });

  test("what was typed (title and ALL lines) comes back after a trip away, with a way to start fresh", async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ description: `Item ${i + 1}`, unit: "m", quantity: "1", rate: "1", category: "", itemCode: `C-${i + 1}`, parentItemCode: "", breakdownPercentage: "" }));
    sessionStorage.setItem("px-draft:boq-new:p1", JSON.stringify({ savedAt: Date.now(), value: { title: "Big BOQ", lines: many } }));
    await seedLaptop();
    setOnline(false);
    go("/local/scope/new?projectId=p1");
    const { findByTestId, getByTestId, getAllByTestId } = render(<LocalShell />);
    await findByTestId("scope-new-screen");
    await waitFor(() => expect((getByTestId("scope-new-title") as HTMLInputElement).value).toBe("Big BOQ"));
    expect(getAllByTestId("scope-new-row")).toHaveLength(12);
    expect((getByTestId("scope-new-11-description") as HTMLInputElement).value).toBe("Item 12");
    expect(getByTestId("draft-restored").textContent).toContain("We kept what you typed earlier");
    fireEvent.click(getByTestId("draft-restored").querySelector("button")!);
    await waitFor(() => expect((getByTestId("scope-new-title") as HTMLInputElement).value).toBe(""));
  });

  test("a role that may not create a BOQ: the guided panel with the original sentence and what to do", async () => {
    await seedLaptop({ role: "viewer" });
    setOnline(false);
    go("/local/scope/new?projectId=p1");
    const a = render(<LocalShell />);
    const screen = (await a.findByTestId("scope-new-screen")) as HTMLElement;
    expect(screen.getAttribute("data-state")).toBe("role");
    const panel = (await a.findByTestId("guided-error")) as HTMLElement;
    expect(panel.textContent).toContain("Your role can read BOQs but not create them.");
    expect(panel.querySelector('[data-testid="guided-error-steps"]')).not.toBeNull();
  });
});

describe("New Revision on the laptop: a reduction of work done is guided to the line", () => {
  test("lowering a line that has progress: the panel names it, its Qty is the place to fix, Save is off, nothing queued", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/scope/b1/revise?projectId=p1");
    const { findByTestId, getByTestId, container } = render(<LocalShell />);
    await findByTestId("scope-revise-screen");
    type(getByTestId("scope-revise-0-quantity"), "10"); // Blockwork had 100 and 40 % done
    const blocked = await findByTestId("scope-revise-blocked");
    const panel = blocked.querySelector('[data-testid="guided-error"]') as HTMLElement;
    expect(panel.textContent).toContain("Blockwork");
    expect((getByTestId("scope-revise-save") as HTMLButtonElement).disabled).toBe(true);
    expect(await ops()).toEqual([]);
    // the Fix button is the line's own Qty box
    const fix = panel.querySelector('[data-testid="guided-error-fix"]') as HTMLAnchorElement;
    expect(fix.getAttribute("href")).toContain(`focus=${encodeURIComponent(ids.line(0, "quantity"))}`);
    fireEvent.click(fix);
    await waitFor(() => expect((container.querySelector(`[id="${ids.line(0, "quantity")}"]`) as HTMLElement).getAttribute("data-px-highlighted")).toBe("true"));
  });

  test("a negative rate is guided on the revision form", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/scope/b1/revise?projectId=p1");
    const { findByTestId, getByTestId, container } = render(<LocalShell />);
    await findByTestId("scope-revise-screen");
    type(getByTestId("scope-revise-1-rate"), "-2");
    fireEvent.click(getByTestId("scope-revise-save"));
    const panel = (await findByTestId("guided-error")) as HTMLElement;
    expect(panel.textContent).toContain("Rate cannot be negative");
    expect((container.querySelector(`[id="${ids.line(1, "rate")}"]`) as HTMLElement).getAttribute("aria-invalid")).toBe("true");
    expect(await ops()).toEqual([]);
  });
});

describe("Line budgets on the laptop: a wrong value is guided", () => {
  test("Budget % of 101: the panel, the legacy message beside the box, the box outlined; nothing queued", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/scope/b1/budget?projectId=p1");
    const { findByTestId, getByTestId, container } = render(<LocalShell />);
    await findByTestId("scope-budget-screen");
    type(getByTestId("scope-budget-li1-pct"), "101");
    fireEvent.click(getByTestId("scope-budget-li1-save"));
    expect((await findByTestId("scope-budget-li1-pct-error")).textContent).toContain("from 0 to 100");
    const panel = (await findByTestId("guided-error")) as HTMLElement;
    expect(panel.textContent).toContain("Budget % must be a number from 0 to 100");
    const box = container.querySelector('[id="scope-budget-li1-pct"]') as HTMLInputElement;
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(box.getAttribute("data-px-highlighted")).toBe("true");
    expect(await ops()).toEqual([]);
  });

  test("saving with nothing changed is told, not silently ignored", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/scope/b1/budget?projectId=p1");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("scope-budget-screen");
    fireEvent.click(getByTestId("scope-budget-li1-save"));
    expect((await findByTestId("guided-error")).textContent).toContain("Nothing was changed");
  });
});
