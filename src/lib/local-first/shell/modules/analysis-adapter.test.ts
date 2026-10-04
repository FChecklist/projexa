import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY, doneKey } from "../../replica";
import type { ShellData } from "../context";
import { snapshotCacheFor } from "../snapshot-cache";
import {
  boqAnalysisSnapshotName,
  exceptionsSnapshotName,
  isBoqAnalysisBody,
  isExceptionsBody,
  loadAnalysisHub,
  loadExceptions,
  loadProject360,
} from "./analysis-adapter";

const shellData = (idb: IDBFactory, over: Partial<ShellData> = {}): ShellData => ({
  userId: "u1", name: "Asha", email: "a@x.test", role: "pm", orgId: "orgA", idb, projects: [{ id: "p1", name: "Cedar Heights" }], ...over,
});

const CHECKS = { checks: [
  { item: 1, title: "Extra work never billed", flagged: true, count: 2, formula: "x", records: [{ id: "r1", detail: "CO-3 approved, not billed" }, { id: 7, detail: 9 }] },
  { item: 2, title: "Stuck approvals", flagged: false, count: 0, formula: "y", records: [] },
] };

async function seedProject(idb: IDBFactory, userId = "u1") {
  const db = await openLocalDb(idb, localDbNameFor(userId));
  await db.setMeta(MANIFEST_KEY, { userId, orgId: "orgA", projectIds: ["p1"], kinds: ["change_orders", "milestones", "progress_claims"], at: 1 });
  await db.putRecords([
    { id: "change_orders:c1", type: "change_orders", orgId: "orgA", projectId: "p1", data: { id: "c1", status: "approved", cost_impact: "12500.00" }, updatedAt: 1 },
    { id: "change_orders:c2", type: "change_orders", orgId: "orgA", projectId: "p1", data: { id: "c2", status: "pending", cost_impact: "4000.00" }, updatedAt: 1 },
    { id: "change_orders:c3", type: "change_orders", orgId: "orgA", projectId: "p1", data: { id: "c3", status: "approved", cost_impact: "1.00" }, updatedAt: 1 },
    { id: "milestones:m1", type: "milestones", orgId: "orgA", projectId: "p1", data: { id: "m1", status: "open" }, updatedAt: 1 },
  ]);
  await db.setMeta(doneKey("p1", "change_orders"), { at: 5, redacted: false, hiddenFields: [] });
  await db.setMeta(doneKey("p1", "milestones"), { at: 5, redacted: false, hiddenFields: [] });
  db.close();
}

describe("the analysis hub", () => {
  test("is the online hub's own list, with the project carried into every link", () => {
    const hub = loadAnalysisHub("p1");
    expect(hub.screens.map((s) => s.key)).toContain("exceptions");
    expect(hub.screens.find((s) => s.key === "project-360")?.href).toBe("/analysis/project-360?projectId=p1");
    expect(loadAnalysisHub(null).screens.every((s) => !s.href.includes("projectId"))).toBe(true);
  });
});

describe("exceptions: the server's checks as last saved here", () => {
  test("no project; nothing saved yet; saved (records that do not look right are dropped, the checks kept)", async () => {
    const idb = new IDBFactory();
    expect(await loadExceptions(shellData(idb), null)).toEqual({ state: "no_project" });
    expect(await loadExceptions(shellData(idb), "p1")).toEqual({ state: "local", projectId: "p1", snapshot: null });
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(exceptionsSnapshotName("p1"), CHECKS);
    const d = await loadExceptions(shellData(idb), "p1");
    if (d.state !== "local" || !d.snapshot) throw new Error("unreachable");
    expect(d.snapshot.body.checks.map((c) => [c.item, c.flagged, c.count, c.records.length])).toEqual([[1, true, 2, 1], [2, false, 0, 0]]);
  });

  test("another person's or another role's saved checks are not shown", async () => {
    const idb = new IDBFactory();
    await snapshotCacheFor({ userId: "u2", role: "pm", idb }).write(exceptionsSnapshotName("p1"), CHECKS);
    expect(await loadExceptions(shellData(idb), "p1")).toMatchObject({ snapshot: null });
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(exceptionsSnapshotName("p1"), CHECKS);
    expect(await loadExceptions(shellData(idb, { role: "viewer" }), "p1")).toMatchObject({ snapshot: null });
  });

  test("an answer that is not the checks is untrusted", () => {
    expect(isExceptionsBody(CHECKS)).toBe(true);
    expect(isExceptionsBody({ checks: [{ item: "1" }] })).toBe(false);
    expect(isExceptionsBody({})).toBe(false);
  });
});

describe("project 360: the server's margin analysis + counts the laptop answers exactly", () => {
  test("change orders, milestones and claims by status; amounts never added up; an uncopied kind says so", async () => {
    const idb = new IDBFactory();
    await seedProject(idb);
    const d = await loadProject360(shellData(idb), "p1");
    if (d.state !== "local") throw new Error("unreachable");
    expect(d.changeOrders).toEqual({ state: "local", syncedAt: 5, value: [{ status: "approved", count: 2 }, { status: "pending", count: 1 }] });
    expect(d.milestones).toMatchObject({ state: "local", value: [{ status: "open", count: 1 }] });
    expect(d.progressClaims).toEqual({ state: "not_synced" });
    expect(d.snapshot).toBeNull();
    const text = JSON.stringify(d);
    for (const amount of ["12500", "16501", "4000"]) expect(text).not.toContain(amount);
  });

  test("the server's analysis comes from the snapshot, for this person and role only", async () => {
    const idb = new IDBFactory();
    await seedProject(idb);
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(boqAnalysisSnapshotName("p1"), { row: { hasBaseline: true, spent: { amount: 10 } } });
    const d = await loadProject360(shellData(idb), "p1");
    expect(d.state === "local" ? d.snapshot?.body.row.hasBaseline : null).toBe(true);
    const viewer = await loadProject360(shellData(idb, { role: "viewer" }), "p1");
    expect(viewer.state === "local" ? viewer.snapshot : "x").toBeNull();
  });

  test("another person's database contributes nothing", async () => {
    const idb = new IDBFactory();
    await seedProject(idb, "u2");
    const d = await loadProject360(shellData(idb), "p1");
    expect(d).toMatchObject({ changeOrders: { state: "not_synced" }, milestones: { state: "not_synced" } });
    expect(isBoqAnalysisBody({ row: [] })).toBe(false);
    expect(await loadProject360(shellData(idb), null)).toEqual({ state: "no_project" });
  });
});
