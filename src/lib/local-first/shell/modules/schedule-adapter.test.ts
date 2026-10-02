import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { deliveryShellData as shellData, seedDelivery, type SeedPair } from "./delivery-test-seed";
import { buildTimeline, loadSchedule, loadScheduleTask } from "./schedule-adapter";

// The schedule read from the laptop: PMS tasks as a timeline from their STORED dates (parents before children, bars placed on the
// project's own date range), the online screen's own browser arithmetic (duration, planned %, slippage) reused, archived tasks left out.

const tasks: SeedPair = {
  projectId: "p1", kind: "tasks",
  rows: [
    { id: "t2", number: 2, title: "Blockwork", start_date: "2026-10-05", due_date: "2026-10-14", completion_percentage: 0, parent_issue_id: "t1" },
    { id: "t1", number: 1, title: "Structure", start_date: "2026-10-01", due_date: "2026-10-20", completion_percentage: 30 },
    { id: "t3", number: 3, title: "Handover", start_date: "2026-10-20", due_date: "2026-10-20", milestone_id: "ms1" },
    { id: "t4", number: 4, title: "Unscheduled" },
    { id: "t5", number: 5, title: "Old", is_archived: true, start_date: "2026-01-01", due_date: "2026-01-02" },
    { id: "t6", title: "Orphan child", parent_issue_id: "gone", start_date: "2026-10-02", due_date: "2026-10-03" },
  ],
};
const milestones: SeedPair = { projectId: "p1", kind: "milestones", rows: [{ id: "ms1", name: "Handover", target_date: "2026-10-20", status: "open" }, { id: "ms0", name: "Start", target_date: "2026-10-01" }] };

describe("the schedule timeline", () => {
  test("parents before children, archived left out, an orphan is a root; range from the stored dates", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [tasks, milestones]);
    const r = await loadSchedule(shellData(idb), "p1", "2026-10-10");
    if (r.state !== "local") throw new Error(`expected local, got ${r.state}`);
    expect(r.rows.map((x) => `${x.id}:${x.depth}`)).toEqual(["t1:0", "t2:1", "t6:0", "t3:0", "t4:0"]);
    expect(r.range).toEqual({ start: "2026-10-01", end: "2026-10-20" });
    expect(r.milestones!.map((m) => m.id)).toEqual(["ms0", "ms1"]);
  });

  test("duration, planned % and slippage are the online screen's arithmetic on the stored dates; a milestone is start = due", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [tasks]);
    const r = await loadSchedule(shellData(idb), "p1", "2026-10-10");
    if (r.state !== "local") throw new Error("unreachable");
    const blockwork = r.rows.find((x) => x.id === "t2")!;
    expect(blockwork.duration).toBe(9);
    expect(blockwork.plannedPercent).toBe(56);
    expect(blockwork.slippage).toMatchObject({ tone: "behind", days: 5 });
    expect(r.rows.find((x) => x.id === "t3")!.milestone).toBe(true);
    const unscheduled = r.rows.find((x) => x.id === "t4")!;
    expect(unscheduled).toMatchObject({ duration: null, plannedPercent: null, bar: null });
    expect(unscheduled.slippage.tone).toBe("unknown");
    expect(r.milestones).toBeNull(); // not on the laptop: null, not []
  });

  test("bars sit on the range: the first task starts at 0 %, the whole span is covered once", () => {
    const { rows } = buildTimeline([
      { id: "a", number: 1, title: "A", priority: null, statusId: null, startDate: "2026-10-01", dueDate: "2026-10-10", completionPercentage: null, parentIssueId: null, milestoneId: null, description: null },
      { id: "b", number: 2, title: "B", priority: null, statusId: null, startDate: "2026-10-11", dueDate: "2026-10-20", completionPercentage: null, parentIssueId: null, milestoneId: null, description: null },
    ], "2026-10-01");
    expect(rows[0]!.bar).toEqual({ left: 0, width: 50 });
    expect(rows[1]!.bar).toEqual({ left: 50, width: 50 });
  });

  test("a cycle in parent links never loops and lists each task once", () => {
    const base = { priority: null, statusId: null, startDate: null, dueDate: null, completionPercentage: null, milestoneId: null, description: null };
    const { rows } = buildTimeline([
      { ...base, id: "x", number: 1, title: "X", parentIssueId: "y" },
      { ...base, id: "y", number: 2, title: "Y", parentIssueId: "x" },
    ], "2026-10-01");
    expect(rows.map((r) => r.id).sort()).toEqual(["x", "y"]);
  });

  test("not synced / no project / another person's database", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [{ ...tasks, synced: false }]);
    expect(await loadSchedule(shellData(idb), "p1", "2026-10-10")).toEqual({ state: "not_synced", projectId: "p1" });
    expect(await loadSchedule(shellData(idb), null, "2026-10-10")).toEqual({ state: "no_project" });
    const idb2 = new IDBFactory();
    await seedDelivery(idb2, [tasks], { userId: "u2" });
    expect((await loadSchedule(shellData(idb2), "p1", "2026-10-10")).state).toBe("not_synced");
  });
});

describe("one task", () => {
  test("with its parent, children and milestone; not found when absent", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [tasks, milestones]);
    const t1 = await loadScheduleTask(shellData(idb), "t1", null, "2026-10-10");
    if (t1.state !== "local") throw new Error("unreachable");
    expect(t1.children.map((c) => c.id)).toEqual(["t2"]);
    expect(t1.parent).toBeNull();
    const t3 = await loadScheduleTask(shellData(idb), "t3", "p1", "2026-10-10");
    expect(t3.state === "local" && t3.milestone?.name).toBe("Handover");
    expect(await loadScheduleTask(shellData(idb), "t5", "p1", "2026-10-10")).toEqual({ state: "not_found", projectId: "p1" }); // archived
  });
});
