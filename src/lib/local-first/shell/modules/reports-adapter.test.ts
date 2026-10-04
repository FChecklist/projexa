import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { reportDestination } from "@/lib/report-destinations";
import type { ShellData } from "../context";
import { snapshotCacheFor } from "../snapshot-cache";
import { REPORTS, isReportBody, loadReports, reportSnapshotName } from "./reports-adapter";

const shellData = (idb: IDBFactory, over: Partial<ShellData> = {}): ShellData => ({
  userId: "u1", name: "Asha", email: "a@x.test", role: "pm", orgId: "orgA", idb, projects: [{ id: "p1", name: "Cedar Heights" }], ...over,
});
const q = (s: string) => new URLSearchParams(s);
const STATUS_URL = (reportDestination("project-status", { projectId: "p1" }) as { path: string }).path;
const BODY = { contractValue: 777000, lines: [{ item: "Slab", amount: 100 }] };

describe("the report list", () => {
  test("is the online Reports screen's own list, in its order, with its labels", () => {
    const source = readFileSync(join(import.meta.dir, "../../../../components/ReportsClient.tsx"), "utf8");
    const block = source.slice(source.indexOf("const DEFAULT_REPORT_COLUMNS"), source.indexOf("];", source.indexOf("const DEFAULT_REPORT_COLUMNS")));
    const online = [...block.matchAll(/field: "([^"]+)", label: "([^"]+)"/g)].map((m) => ({ value: m[1], label: m[2] }));
    expect(online.length).toBeGreaterThan(10);
    expect(REPORTS).toEqual(online);
  });

  test("no project: says so", async () => {
    expect(await loadReports(shellData(new IDBFactory(), { projects: [] }), null, q(""))).toEqual({ state: "no_project" });
  });

  test("each report goes where the online screen sends it: its own screen, or the same endpoint; and what is saved here", async () => {
    const idb = new IDBFactory();
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(reportSnapshotName(STATUS_URL, "p1"), BODY);
    const d = await loadReports(shellData(idb), "p1", q(""));
    if (d.state !== "local") throw new Error("unreachable");
    const status = d.reports.find((r) => r.value === "project-status")!;
    expect(status).toMatchObject({ kind: "fetch", target: STATUS_URL });
    expect(status.savedAt).toEqual(expect.any(Number));
    expect(d.reports.find((r) => r.value === "kpi")).toMatchObject({ kind: "fetch", savedAt: null });
    expect(d.reports.find((r) => r.value === "work-progress")).toMatchObject({ kind: "navigate", target: expect.stringContaining("/work-progress?") });
    expect(d.selected).toBeNull();
  });

  test("an opened report carries the server's last answer for THIS project", async () => {
    const idb = new IDBFactory();
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(reportSnapshotName(STATUS_URL, "p1"), BODY);
    const d = await loadReports(shellData(idb), "p1", q("report=project-status"));
    if (d.state !== "local" || d.selected?.kind !== "fetch") throw new Error("unreachable");
    expect(d.selected.url).toBe(STATUS_URL);
    expect(d.selected.snapshot?.body).toEqual(BODY);
    const other = await loadReports(shellData(idb, { projects: [{ id: "p2", name: "B" }] }), "p2", q("report=project-status"));
    if (other.state !== "local" || other.selected?.kind !== "fetch") throw new Error("unreachable");
    expect(other.selected.snapshot).toBeNull();
  });

  test("another person's saved report, or one saved under another role, is not shown", async () => {
    const idb = new IDBFactory();
    await snapshotCacheFor({ userId: "u2", role: "pm", idb }).write(reportSnapshotName(STATUS_URL, "p1"), BODY);
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(reportSnapshotName(STATUS_URL, "p1"), BODY);
    const asViewer = await loadReports(shellData(idb, { role: "viewer" }), "p1", q("report=project-status"));
    if (asViewer.state !== "local" || asViewer.selected?.kind !== "fetch") throw new Error("unreachable");
    expect(asViewer.selected.snapshot).toBeNull();
    const u3 = await loadReports(shellData(idb, { userId: "u3" }), "p1", q("report=project-status"));
    if (u3.state !== "local" || u3.selected?.kind !== "fetch") throw new Error("unreachable");
    expect(u3.selected.snapshot).toBeNull();
  });

  test("the weekly report keeps a valid week start in its endpoint; a malformed one is dropped; an unknown report opens nothing", async () => {
    const idb = new IDBFactory();
    const weekly = await loadReports(shellData(idb), "p1", q("report=weekly-project&weekStart=2026-10-05"));
    if (weekly.state !== "local" || weekly.selected?.kind !== "fetch") throw new Error("unreachable");
    expect(weekly.selected.url).toContain("weekStart=2026-10-05");
    const bad = await loadReports(shellData(idb), "p1", q("report=weekly-project&weekStart=x'); drop"));
    if (bad.state !== "local" || bad.selected?.kind !== "fetch") throw new Error("unreachable");
    expect(bad.selected.url).not.toContain("weekStart");
    expect((await loadReports(shellData(idb), "p1", q("report=../../etc"))) ).toMatchObject({ selected: null });
  });

  test("a report body is an object or a list; anything else is untrusted junk", () => {
    expect(isReportBody({})).toBe(true);
    expect(isReportBody([])).toBe(true);
    expect(isReportBody("x")).toBe(false);
    expect(isReportBody(null)).toBe(false);
  });
});
