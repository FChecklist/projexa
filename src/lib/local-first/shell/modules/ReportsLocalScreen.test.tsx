import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { reportDestination } from "@/lib/report-destinations";
import type { ShellApi } from "../types";
import type { ShellData } from "../context";
import { snapshotCacheFor } from "../snapshot-cache";
import ReportsLocalScreen from "./ReportsLocalScreen";
import { loadReports, reportSnapshotName } from "./reports-adapter";

// The Reports screen with the network OFF draws the server's last answer kept here and lets it be exported; it fetches only while online,
// at the online screen's own endpoint. `fetch` is a spy throughout.

const realFetch = globalThis.fetch;
let idb: IDBFactory;
let fetchCalls: string[];
const STATUS_URL = (reportDestination("project-status", { projectId: "p1" }) as { path: string }).path;
const BODY = { contractValue: 777000, progressPercent: 42, lines: [{ item: "Slab", amount: 100 }, { item: "Walls", amount: 50 }] };

const shellData = (over: Partial<ShellData> = {}): ShellData => ({
  userId: "u1", name: "Asha", email: "a@x.test", role: "pm", orgId: "orgA", idb, projects: [{ id: "p1", name: "Cedar Heights" }], ...over,
});
function fakeShell(connectivity: ShellApi["connectivity"], refresh = () => {}): ShellApi {
  return {
    data: shellData(), projectId: "p1", setProjectId() {}, navigate() {}, connectivity, refresh,
    writer: { list: async () => [], enqueue: async () => { throw new Error("no"); }, flush: async () => ({ sent: 0, rejected: 0, kept: 0, stoppedBecause: "none" }), notices: async () => [], dismissNotice: async () => {} },
  };
}

beforeEach(() => {
  idb = new IDBFactory();
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls.push(String(input));
    return new Response(JSON.stringify(BODY), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("reports on this laptop", () => {
  test("offline, a saved report: drawn as the server sent it, labelled 'As of', exportable; no request", async () => {
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(reportSnapshotName(STATUS_URL, "p1"), BODY);
    const data = await loadReports(shellData(), "p1", new URLSearchParams("report=project-status"));
    const { getByTestId, getAllByTestId } = render(<ReportsLocalScreen shell={fakeShell("offline")} params={{}} query={new URLSearchParams()} data={data} />);
    expect(getByTestId("overview-report-asof").textContent).toMatch(/^As of .*, from this laptop$/);
    expect(getByTestId("overview-report").textContent).toContain("777,000");
    expect(getAllByTestId("overview-body-row")).toHaveLength(2);
    expect(getByTestId("overview-report-export")).toBeTruthy();
    expect(getAllByTestId("overview-report-entry").length).toBeGreaterThan(10);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchCalls).toEqual([]);
  });

  test("offline, a report never saved here: a calm sentence, no export, no error, no request", async () => {
    const data = await loadReports(shellData(), "p1", new URLSearchParams("report=kpi"));
    const { getByTestId, queryByTestId } = render(<ReportsLocalScreen shell={fakeShell("offline")} params={{}} query={new URLSearchParams()} data={data} />);
    expect(getByTestId("overview-report-none").textContent).toContain("once the laptop is connected");
    expect(queryByTestId("overview-report-export")).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchCalls).toEqual([]);
  });

  test("online: the online screen's endpoint is fetched, the answer saved, and the screen redrawn", async () => {
    let refreshed = 0;
    const data = await loadReports(shellData(), "p1", new URLSearchParams("report=project-status"));
    render(<ReportsLocalScreen shell={fakeShell("online", () => { refreshed += 1; })} params={{}} query={new URLSearchParams()} data={data} />);
    await waitFor(() => expect(refreshed).toBe(1));
    expect(fetchCalls).toEqual([STATUS_URL]);
    const again = await loadReports(shellData(), "p1", new URLSearchParams("report=project-status"));
    expect(again.state === "local" && again.selected?.kind === "fetch" ? again.selected.snapshot?.body : null).toEqual(BODY);
  });

  test("a report with its own screen is a link to it, never fetched here", async () => {
    const data = await loadReports(shellData(), "p1", new URLSearchParams("report=work-progress"));
    const { getByTestId } = render(<ReportsLocalScreen shell={fakeShell("online")} params={{}} query={new URLSearchParams()} data={data} />);
    expect(getByTestId("overview-report").querySelector("a")?.getAttribute("href")).toContain("/work-progress?");
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchCalls).toEqual([]);
  });
});
