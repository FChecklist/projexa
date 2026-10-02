import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY, doneKey } from "../../replica";
import type { ShellApi } from "../types";
import type { ShellData } from "../context";
import { snapshotCacheFor } from "../snapshot-cache";
import AnalysisHubScreen from "./AnalysisHubScreen";
import ExceptionsLocalScreen from "./ExceptionsLocalScreen";
import Project360LocalScreen from "./Project360LocalScreen";
import { exceptionsSnapshotName, loadAnalysisHub, loadExceptions, loadProject360 } from "./analysis-adapter";

// The analysis screens with the network OFF draw from the laptop (the server's last answers + exact counts) and send nothing; online they
// fetch the online screens' own endpoints. `fetch` is a spy throughout.

const realFetch = globalThis.fetch;
let idb: IDBFactory;
let fetchCalls: string[];
const CHECKS = { checks: [{ item: 1, title: "Extra work never billed", flagged: true, count: 1, formula: "x", records: [{ id: "r1", detail: "CO-3 approved, not billed" }] }] };

const shellData = (): ShellData => ({ userId: "u1", name: "Asha", email: "a@x.test", role: "pm", orgId: "orgA", idb, projects: [{ id: "p1", name: "Cedar Heights" }] });
function fakeShell(connectivity: ShellApi["connectivity"], refresh = () => {}): ShellApi {
  return {
    data: shellData(), projectId: "p1", setProjectId() {}, navigate() {}, connectivity, refresh,
    writer: { list: async () => [], enqueue: async () => { throw new Error("no"); }, flush: async () => ({ sent: 0, rejected: 0, kept: 0, stoppedBecause: "none" }), notices: async () => [], dismissNotice: async () => {} },
  };
}
const props = { params: {}, query: new URLSearchParams() };
const settle = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  idb = new IDBFactory();
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    const body = url.startsWith("/api/exceptions") ? CHECKS : { row: { hasBaseline: true } };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("analysis on this laptop", () => {
  test("the hub lists the online hub's screens with the project carried", () => {
    const { getAllByTestId } = render(<AnalysisHubScreen shell={fakeShell("offline")} {...props} data={loadAnalysisHub("p1")} />);
    const links = getAllByTestId("overview-analysis-entry").map((li) => li.querySelector("a")!.getAttribute("href"));
    expect(links).toContain("/analysis/exceptions?projectId=p1");
    expect(fetchCalls).toEqual([]);
  });

  test("exceptions offline: the server's checks as saved, 'As of', no request; none saved: a calm sentence", async () => {
    const none = await loadExceptions(shellData(), "p1");
    const first = render(<ExceptionsLocalScreen shell={fakeShell("offline")} {...props} data={none} />);
    expect(first.getByTestId("overview-exceptions-none").textContent).toContain("will appear once it is connected");
    first.unmount();

    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(exceptionsSnapshotName("p1"), CHECKS);
    const data = await loadExceptions(shellData(), "p1");
    const { getByTestId, getAllByTestId } = render(<ExceptionsLocalScreen shell={fakeShell("offline")} {...props} data={data} />);
    expect(getByTestId("overview-exceptions-asof").textContent).toMatch(/^As of .*, from this laptop$/);
    expect(getAllByTestId("overview-exception-check")[0]!.textContent).toContain("1 flagged");
    expect(getAllByTestId("overview-exception-check")[0]!.textContent).toContain("CO-3 approved, not billed");
    await settle();
    expect(fetchCalls).toEqual([]);
  });

  test("exceptions online: GET /api/exceptions (the online screen's endpoint), saved, redrawn", async () => {
    let refreshed = 0;
    render(<ExceptionsLocalScreen shell={fakeShell("online", () => { refreshed += 1; })} {...props} data={await loadExceptions(shellData(), "p1")} />);
    await waitFor(() => expect(refreshed).toBe(1));
    expect(fetchCalls).toEqual(["/api/exceptions?projectId=p1"]);
    expect((await loadExceptions(shellData(), "p1")).state === "local").toBe(true);
  });

  test("project 360 offline: counts from the laptop, the margin 'recalculated when connected', no request", async () => {
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    await db.setMeta(MANIFEST_KEY, { userId: "u1", orgId: "orgA", projectIds: ["p1"], kinds: ["change_orders"], at: 1 });
    await db.putRecords([{ id: "change_orders:c1", type: "change_orders", orgId: "orgA", projectId: "p1", data: { id: "c1", status: "approved", cost_impact: "12500.00" }, updatedAt: 1 }]);
    await db.setMeta(doneKey("p1", "change_orders"), { at: 5, redacted: false, hiddenFields: [] });
    db.close();
    const data = await loadProject360(shellData(), "p1");
    const { getByTestId } = render(<Project360LocalScreen shell={fakeShell("offline")} {...props} data={data} />);
    expect(getByTestId("overview-project360-change-orders").textContent).toContain("approved: 1");
    expect(getByTestId("overview-project360-change-orders").textContent).not.toContain("12500");
    expect(getByTestId("overview-project360-margin").textContent).toContain("recalculated by the server when the laptop is connected");
    expect(getByTestId("overview-project360-claims").querySelector("[data-state]")?.getAttribute("data-state")).toBe("not_synced");
    await settle();
    expect(fetchCalls).toEqual([]);
  });

  test("project 360 online: GET /api/reports/boq-analysis (the online screen's endpoint)", async () => {
    let refreshed = 0;
    render(<Project360LocalScreen shell={fakeShell("online", () => { refreshed += 1; })} {...props} data={await loadProject360(shellData(), "p1")} />);
    await waitFor(() => expect(refreshed).toBe(1));
    expect(fetchCalls).toEqual(["/api/reports/boq-analysis?projectId=p1"]);
  });
});
