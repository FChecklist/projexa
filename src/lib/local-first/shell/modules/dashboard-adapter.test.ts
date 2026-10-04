import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY, doneKey } from "../../replica";
import type { ShellData } from "../context";
import { snapshotCacheFor } from "../snapshot-cache";
import { activityFacts, countByStatus, milestonesDueThisWeek, taskFacts, weekWindow } from "./dashboard-facts";
import { isProjectDashboard, loadDashboard, projectDashboardSnapshotName } from "./dashboard-adapter";

// 2026-10-07 at noon, laptop time: "this week" is the 7th to the 13th.
const NOW = new Date(2026, 9, 7, 12, 0, 0).getTime();
const KINDS = ["project", "tasks", "rfis", "punch_list", "submittals", "activities", "progress", "milestones"];

type Seed = { kind: string; projectId: string; data: Record<string, unknown> };

async function seed(idb: IDBFactory, userId: string, rows: Seed[], done: { projectId: string; kind: string }[], opts: { orgId?: string; ops?: string[] } = {}) {
  const db = await openLocalDb(idb, localDbNameFor(userId));
  await db.setMeta(MANIFEST_KEY, { userId, orgId: opts.orgId ?? "orgA", projectIds: ["p1", "p2"], kinds: KINDS, at: 1 });
  await db.putRecords(rows.map((r) => ({ id: `${r.kind}:${r.data.id as string}`, type: r.kind, orgId: opts.orgId ?? "orgA", projectId: r.projectId, data: r.data, updatedAt: 1 })));
  for (const d of done) await db.setMeta(doneKey(d.projectId, d.kind), { at: 1_760_000_000_000, redacted: false, hiddenFields: [] });
  let seq = 0;
  for (const status of opts.ops ?? []) {
    seq += 1;
    await db.putOp({ opId: `op${seq}`, seq, functionId: "update_task", projectId: "p1", params: {}, clientAt: "2026-10-07T00:00:00Z", status: status as never, attempts: 0, nextAttemptAt: 0 });
  }
  db.close();
}

const shellData = (idb: IDBFactory, over: Partial<ShellData> = {}): ShellData => ({
  userId: "u1", name: "Asha", email: "a@x.test", role: "pm", orgId: "orgA", idb,
  projects: [{ id: "p1", name: "Cedar Heights" }, { id: "p2", name: "Annexe Works" }], ...over,
});

const p1Rows: Seed[] = [
  { kind: "project", projectId: "p1", data: { id: "p1", name: "Cedar Heights", project_value: "999999", status: "active" } },
  { kind: "tasks", projectId: "p1", data: { id: "t1", due_date: "2026-10-08", completion_percentage: 10, is_archived: false } }, // due this week
  { kind: "tasks", projectId: "p1", data: { id: "t2", due_date: "2026-10-01", completion_percentage: "40" } }, // overdue
  { kind: "tasks", projectId: "p1", data: { id: "t3", due_date: "2026-10-08", completion_percentage: 100 } }, // finished
  { kind: "tasks", projectId: "p1", data: { id: "t4", due_date: "2026-10-08", is_archived: true } }, // archived
  { kind: "tasks", projectId: "p1", data: { id: "t5", dueDate: "2026-10-20", completionPercentage: 0 } }, // camelCase, later
  { kind: "rfis", projectId: "p1", data: { id: "r1", status: "open" } },
  { kind: "rfis", projectId: "p1", data: { id: "r2", status: "open" } },
  { kind: "rfis", projectId: "p1", data: { id: "r3", status: "answered" } },
  { kind: "rfis", projectId: "p1", data: { id: "r4" } },
  { kind: "activities", projectId: "p1", data: { id: "a1", name: "Slab" } },
  { kind: "activities", projectId: "p1", data: { id: "a2", name: "Walls" } },
  { kind: "activities", projectId: "p1", data: { id: "a3", name: "Roof" } },
  { kind: "progress", projectId: "p1", data: { id: "e1", activity_id: "a1", entry_date: "2026-10-01", percent_complete: "60", created_at: "2026-10-01T08:00:00Z" } },
  { kind: "progress", projectId: "p1", data: { id: "e2", activity_id: "a1", entry_date: "2026-10-05", percent_complete: "100", created_at: "2026-10-05T08:00:00Z" } },
  { kind: "progress", projectId: "p1", data: { id: "e3", activity_id: "a2", entry_date: "2026-10-05", percent_complete: 30, created_at: "2026-10-05T08:00:00Z" } },
  { kind: "milestones", projectId: "p1", data: { id: "m1", status: "open", target_date: "2026-10-10" } },
  { kind: "milestones", projectId: "p1", data: { id: "m2", status: "completed", target_date: "2026-10-10" } },
  { kind: "milestones", projectId: "p1", data: { id: "m3", status: "open", target_date: "2026-11-10" } },
];
const p1Done = ["project", "tasks", "rfis", "activities", "progress", "milestones"].map((kind) => ({ projectId: "p1", kind }));

describe("non-money facts the laptop may work out", () => {
  test("this week is today and the six days after it, on the laptop's calendar", () => {
    expect(weekWindow(NOW)).toEqual({ today: "2026-10-07", weekEnd: "2026-10-13" });
  });

  test("tasks: not finished, due this week, overdue (archived and 100% tasks are finished; junk rows skipped)", () => {
    expect(taskFacts([...p1Rows.filter((r) => r.kind === "tasks").map((r) => r.data), { id: 5 }, null, "x"], NOW)).toEqual({ notFinished: 3, dueThisWeek: 1, overdue: 1 });
  });

  test("by status, most first; a row without a status is 'unknown'", () => {
    expect(countByStatus(p1Rows.filter((r) => r.kind === "rfis").map((r) => r.data))).toEqual([
      { status: "open", count: 2 }, { status: "answered", count: 1 }, { status: "unknown", count: 1 },
    ]);
  });

  test("activities by state from each one's LATEST progress entry", () => {
    const acts = p1Rows.filter((r) => r.kind === "activities").map((r) => r.data);
    const prog = p1Rows.filter((r) => r.kind === "progress").map((r) => r.data);
    expect(activityFacts(acts, prog)).toEqual({ notStarted: 1, inProgress: 1, complete: 1 });
    // An entry for an activity that is not in the list counts nothing.
    expect(activityFacts(acts, [...prog, { id: "e9", activity_id: "zz", percent_complete: 100, entry_date: "2026-10-06" }])).toEqual({ notStarted: 1, inProgress: 1, complete: 1 });
  });

  test("milestones due this week, not done", () => {
    expect(milestonesDueThisWeek(p1Rows.filter((r) => r.kind === "milestones").map((r) => r.data), NOW)).toBe(1);
  });
});

describe("the dashboard, read from the laptop", () => {
  test("projects with how much is copied, facts for the selected project, and what is waiting", async () => {
    const idb = new IDBFactory();
    await seed(idb, "u1", p1Rows, p1Done, { ops: ["pending", "conflict", "blocked", "pending"] });
    const d = await loadDashboard(shellData(idb), "p1", { now: NOW, shellEdits: 2 });
    expect(d.projects).toEqual([
      { id: "p1", name: "Cedar Heights", kindsCopied: 6, kindsTotal: KINDS.length, lastCopiedAt: 1_760_000_000_000 },
      { id: "p2", name: "Annexe Works", kindsCopied: 0, kindsTotal: KINDS.length, lastCopiedAt: null },
    ]);
    expect(d.waiting).toEqual({ outbox: 4, conflicts: 1, blocked: 1, shellEdits: 2 });
    expect(d.facts?.tasks).toEqual({ state: "local", syncedAt: 1_760_000_000_000, value: { notFinished: 3, dueThisWeek: 1, overdue: 1 } });
    expect(d.facts?.rfis.state).toBe("local");
    expect(d.facts?.activities).toMatchObject({ state: "local", value: { notStarted: 1, inProgress: 1, complete: 1 } });
    expect(d.facts?.milestonesDueThisWeek).toMatchObject({ state: "local", value: 1 });
    expect(d.snapshot).toBeNull();
  });

  test("a kind not pulled to the end is 'not_synced', never a partial count (activities need progress too)", async () => {
    const idb = new IDBFactory();
    await seed(idb, "u1", p1Rows, p1Done.filter((d) => d.kind !== "rfis" && d.kind !== "progress"));
    const d = await loadDashboard(shellData(idb), "p1", { now: NOW });
    expect(d.facts?.rfis).toEqual({ state: "not_synced" });
    expect(d.facts?.punchList).toEqual({ state: "not_synced" });
    expect(d.facts?.activities).toEqual({ state: "not_synced" });
    expect(d.facts?.tasks.state).toBe("local");
  });

  test("no project selected: projects and waiting edits still show, no facts", async () => {
    const idb = new IDBFactory();
    await seed(idb, "u1", p1Rows, p1Done);
    const d = await loadDashboard(shellData(idb, { projects: [] }), null, { now: NOW });
    expect(d).toMatchObject({ projectId: null, projects: [], facts: null, snapshot: null });
  });

  test("another person's database contributes nothing", async () => {
    const idb = new IDBFactory();
    await seed(idb, "u2", p1Rows, p1Done, { ops: ["pending"] });
    await snapshotCacheFor({ userId: "u2", role: "pm", idb }).write(projectDashboardSnapshotName("p1"), { projectId: "p1", progressPercent: 50 });
    const d = await loadDashboard(shellData(idb), "p1", { now: NOW });
    expect(d.waiting.outbox).toBe(0);
    expect(d.projects.every((p) => p.kindsCopied === 0)).toBe(true);
    expect(d.facts?.tasks).toEqual({ state: "not_synced" });
    expect(d.snapshot).toBeNull();
  });

  test("rows recorded under another organisation are not counted", async () => {
    const idb = new IDBFactory();
    await seed(idb, "u1", p1Rows, p1Done);
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    await db.putRecords([{ id: "rfis:x1", type: "rfis", orgId: "orgB", projectId: "p1", data: { id: "x1", status: "open" }, updatedAt: 1 }]);
    db.close();
    const d = await loadDashboard(shellData(idb), "p1", { now: NOW });
    expect(d.facts?.rfis).toMatchObject({ value: [{ status: "open", count: 2 }, { status: "answered", count: 1 }, { status: "unknown", count: 1 }] });
  });

  test("the server's figures come from the snapshot, for this project only; a viewer never sees a manager's snapshot or any money from the replica", async () => {
    const idb = new IDBFactory();
    await seed(idb, "u1", p1Rows, p1Done);
    const figures = { projectId: "p1", progressPercent: 42, percentByValue: 38.5, contractValue: 777000, budget: 500000, expenses: 120000, delayedTaskCount: 2, taskCount: 9, permitsExpiringCount: 0 };
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(projectDashboardSnapshotName("p1"), figures);
    expect((await loadDashboard(shellData(idb), "p1", { now: NOW })).snapshot?.body).toEqual(figures);
    expect((await loadDashboard(shellData(idb), "p2", { now: NOW })).snapshot).toBeNull();

    const asViewer = await loadDashboard(shellData(idb, { role: "viewer" }), "p1", { now: NOW });
    expect(asViewer.snapshot).toBeNull();
    // The replica's project row carries project_value; nothing the dashboard returns does.
    expect(JSON.stringify(asViewer)).not.toContain("999999");
  });

  test("a snapshot about another project, or with a non-number figure, is rejected", () => {
    expect(isProjectDashboard({ projectId: "p1", progressPercent: "42" })).toBe(false);
    expect(isProjectDashboard({ projectId: "p1", budget: null })).toBe(true);
    expect(isProjectDashboard(null)).toBe(false);
  });
});
