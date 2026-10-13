import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
    // Only the selected report is fetched on its own: the others are kept when the person presses "Keep all reports on this laptop" (the Vercel budget).
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

  test("'Keep all reports on this laptop' fetches every other fetch report once, one after another; nothing is fetched before it is pressed", async () => {
    const data = await loadReports(shellData(), "p1", new URLSearchParams("report=project-status"));
    const { getByTestId, findByTestId } = render(<ReportsLocalScreen shell={fakeShell("online")} params={{}} query={new URLSearchParams("report=project-status")} data={data} />);
    await waitFor(() => expect(fetchCalls).toEqual([STATUS_URL]));
    fireEvent.click(getByTestId("reports-keep-all"));
    expect((await findByTestId("reports-keep-all-note")).textContent).toContain("Every report is now saved here");
    expect(fetchCalls.length).toBeGreaterThan(5);
    expect(new Set(fetchCalls).size).toBe(fetchCalls.length);
    expect(fetchCalls.some((u) => u.includes("/api/reports/work-progress"))).toBe(false);
  });

  test("R-C15: offline, a saved report can be copied as a WhatsApp message (no request), and the screen says the public link and the PDF are made once online", async () => {
    let copiedText = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { copiedText = t; } } });
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(reportSnapshotName(STATUS_URL, "p1"), BODY);
    const data = await loadReports(shellData(), "p1", new URLSearchParams("report=project-status"));
    const { getByTestId } = render(<ReportsLocalScreen shell={fakeShell("offline")} params={{}} query={new URLSearchParams()} data={data} />);
    fireEvent.click(getByTestId("overview-report-whatsapp"));
    await waitFor(() => expect(getByTestId("overview-report-copied").textContent).toContain("Paste it into WhatsApp"));
    expect(copiedText).toContain("*Project Status - Cedar Heights*");
    expect(copiedText).toContain("Contract value: 777,000");
    expect(copiedText).toContain("- Item Slab, Amount 100");
    expect(getByTestId("server-only").textContent).toContain("public link to this report, and its PDF, are made once you are online");
    expect(getByTestId("server-only").textContent).toContain("It will be available here when you are connected.");
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchCalls).toEqual([]);
  });

  test("R-C15: if the browser will not copy, the text is shown to select by hand; a report not saved here offers no copy", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(reportSnapshotName(STATUS_URL, "p1"), BODY);
    const data = await loadReports(shellData(), "p1", new URLSearchParams("report=project-status"));
    const { getByTestId, queryByTestId } = render(<ReportsLocalScreen shell={fakeShell("offline")} params={{}} query={new URLSearchParams()} data={data} />);
    fireEvent.click(getByTestId("overview-report-whatsapp"));
    await waitFor(() => expect(queryByTestId("overview-report-copy-manual")).not.toBeNull());
    expect(queryByTestId("overview-report-copied")).toBeNull();
    expect((getByTestId("overview-report-copy-manual").querySelector("textarea") as HTMLTextAreaElement).value).toContain("Contract value: 777,000");
    cleanup();
    const none = await loadReports(shellData(), "p1", new URLSearchParams("report=kpi"));
    const again = render(<ReportsLocalScreen shell={fakeShell("offline")} params={{}} query={new URLSearchParams()} data={none} />);
    expect(again.queryByTestId("overview-report-whatsapp")).toBeNull();
  });

  test("offline the button is not offered", async () => {
    const data = await loadReports(shellData(), "p1", new URLSearchParams("report=project-status"));
    const { queryByTestId } = render(<ReportsLocalScreen shell={fakeShell("offline")} params={{}} query={new URLSearchParams("report=project-status")} data={data} />);
    expect(queryByTestId("reports-keep-all")).toBeNull();
  });
});
