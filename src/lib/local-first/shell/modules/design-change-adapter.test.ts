import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createOutbox } from "../../outbox";
import type { SyncClient } from "../../sync-client";
import {
  canSubmitEntry, entriesInView, entryStatusWord, loadChangeOrderNew, loadChangeOrderObject, loadChangeOrdersList, loadReview, loadTimeEntryNew,
  loadTimeEntryObject, loadTimesheet, scheduleImpactText, toTaskOptions, weekWindow,
} from "./design-change-adapter";
import { CHANGE_ORDERS_KIND, TASKS_KIND, TIMESHEETS_KIND } from "./design-change-rows";
import { approveTimeEntryOffline, createChangeOrderOffline, recordTimeEntryOffline, submitChangeOrderOffline } from "./design-change-writes";
import { coRow, dcShellData, entryRow, seedDesignChange, taskRow } from "./design-change-test-fixtures";

// The read side of the design-and-change cluster, against fake-indexeddb seeded with the rows the sync service sends. Nothing here
// talks to a server; the outbox used to make "waiting" rows is never flushed (its client fails the test if called).

const neverCalled: Pick<SyncClient, "push" | "pullIds"> = {
  push: async () => { throw new Error("must not send"); },
  pullIds: async () => { throw new Error("must not send"); },
};
const outboxOf = (idb: IDBFactory) => createOutbox({ userId: "u1", client: neverCalled, deviceId: "dev", idb, autoFlush: false, locks: null });

async function seeded(opts: { hidden?: Record<string, string[]> } = {}) {
  const idb = new IDBFactory();
  await seedDesignChange(idb, "u1", [
    { kind: CHANGE_ORDERS_KIND, projectId: "p1", data: coRow("co1") },
    { kind: CHANGE_ORDERS_KIND, projectId: "p1", data: coRow("co7", { title: "Lobby finish", cost_impact: "-900", status: "approved", schedule_impact_days: -2 }) },
    { kind: CHANGE_ORDERS_KIND, projectId: "p1", data: { id: "junk", title: 42 } as never },
    { kind: CHANGE_ORDERS_KIND, projectId: "p2", data: coRow("co3") },
    { kind: TASKS_KIND, projectId: "p1", data: taskRow("i1", 12, "Joinery shop drawings") },
    { kind: TASKS_KIND, projectId: "p1", data: taskRow("i2", 3, "Concept boards") },
    { kind: TASKS_KIND, projectId: "p1", data: taskRow("i9", 1, "Old task", { is_archived: true }) },
    { kind: TIMESHEETS_KIND, projectId: "p1", data: entryRow("t1") },
    { kind: TIMESHEETS_KIND, projectId: "p1", data: entryRow("t2", { issue_id: "i9", spent_on: "2026-09-28", hours: 3, approval_status: "submitted" }) },
    { kind: TIMESHEETS_KIND, projectId: "p1", data: entryRow("t3", { user_id: "u7", approval_status: "submitted", hours: "4" }) },
    { kind: TIMESHEETS_KIND, projectId: "p1", data: entryRow("t4", { user_id: "u7", approval_status: "submitted", hours: "1.25", issue_id: "gone" }) },
    { kind: TIMESHEETS_KIND, projectId: "p1", data: entryRow("t5", { user_id: "u8", approval_status: "approved" }) },
    { kind: TIMESHEETS_KIND, projectId: "p1", data: entryRow("t6", { spent_on: "not a date" }) },
  ], { hiddenFields: opts.hidden });
  return idb;
}

describe("change orders", () => {
  test("list: newest number first, untrusted rows skipped, only this project's", async () => {
    const idb = await seeded();
    const list = await loadChangeOrdersList(dcShellData(idb), "p1");
    if (list.state !== "local") throw new Error(list.state);
    expect(list.rows.map((r) => r.id)).toEqual(["co7", "co1"]);
    expect(list.rows[0]).toMatchObject({ number: 7, title: "Lobby finish", costImpact: -900, scheduleImpactDays: -2, status: "approved", localOnly: false, waitingOn: [] });
    expect(list.costHidden).toBe(false);
  });

  test("a cost hidden for this role is never handed to a screen, even when the row still carries it", async () => {
    const idb = await seeded({ hidden: { [CHANGE_ORDERS_KIND]: ["cost_impact"] } });
    const list = await loadChangeOrdersList(dcShellData(idb, "u1", "viewer"), "p1");
    if (list.state !== "local") throw new Error(list.state);
    expect(list.costHidden).toBe(true);
    expect(list.rows.map((r) => r.costImpact)).toEqual([null, null]);
    const one = await loadChangeOrderObject(dcShellData(idb), "co7", "p1");
    if (one.state !== "local") throw new Error(one.state);
    expect(one.co.costImpact).toBeNull();
    expect(JSON.stringify(one)).not.toContain("-900");
  });

  test("states: no project, not copied yet, not found; another person's database contributes nothing", async () => {
    const idb = await seeded();
    expect(await loadChangeOrdersList(dcShellData(idb), null)).toEqual({ state: "no_project" });
    expect(await loadChangeOrdersList(dcShellData(idb), "p2")).toEqual({ state: "not_synced", projectId: "p2" });
    expect((await loadChangeOrderObject(dcShellData(idb), "nope", "p1")).state).toBe("not_found");
    expect((await loadChangeOrderObject(dcShellData(idb), "co7", null)).state).toBe("local"); // found by searching the person's projects
    expect(await loadChangeOrdersList(dcShellData(idb, "u2"), "p1")).toEqual({ state: "not_synced", projectId: "p1" });
    expect(await loadChangeOrdersList({ ...dcShellData(idb), orgId: "orgB" }, "p1")).toEqual({ state: "not_synced", projectId: "p1" });
    expect((await loadChangeOrderNew(dcShellData(idb), "p1")).state).toBe("ready");
    expect((await loadChangeOrderNew(dcShellData(idb), "p2")).state).toBe("not_synced");
  });

  test("a change order made here is at the top with no number and no status; a send for approval is shown as waiting", async () => {
    const idb = await seeded();
    const outbox = outboxOf(idb);
    const made = await createChangeOrderOffline({ projectId: "p1", title: "Extra skirting" }, { userId: "u1", idb, outbox });
    expect(made.queued).toBe(true);
    await submitChangeOrderOffline({ projectId: "p1", changeOrderId: "co1", signers: [{ name: "Ravi", email: "r@c.test" }] }, { userId: "u1", idb, outbox });
    const list = await loadChangeOrdersList(dcShellData(idb), "p1");
    if (list.state !== "local") throw new Error(list.state);
    expect(list.rows.map((r) => [r.title, r.number, r.status, r.localOnly])).toEqual([
      ["Extra skirting", null, null, true], ["Lobby finish", 7, "approved", false], ["Change co1", 1, "draft", false],
    ]);
    expect(list.rows.find((r) => r.id === "co1")!.waitingOn).toEqual(["submit_change_order_for_approval"]);
    expect(list.rows.find((r) => r.id === "co1")!.status).toBe("draft"); // the approval is the server's decision
  });

  test("schedule impact reads as online: +3d, -2d, and a dash for none", () => {
    expect([scheduleImpactText(3), scheduleImpactText(-2), scheduleImpactText(0), scheduleImpactText(null)]).toEqual(["+3d", "-2d", "—", "—"]);
  });
});

describe("the Design Studio timesheet", () => {
  test("MY entries only, named by their task (archived tasks still name old entries), untrusted rows skipped, newest day first", async () => {
    const idb = await seeded();
    const sheet = await loadTimesheet(dcShellData(idb), "p1", "2026-10-02");
    if (sheet.state !== "local") throw new Error(sheet.state);
    expect(sheet.entries.map((e) => [e.id, e.task, e.hours, e.approvalStatus])).toEqual([
      ["t1", "#12 Joinery shop drawings", 2.5, "draft"],
      ["t2", "#1 Old task", 3, "submitted"],
    ]);
    expect(sheet.tasks.map((t) => t.id)).toEqual(["i2", "i1"]); // archived left out of the picker, by number
    expect(sheet.tasksSynced).toBe(true);
  });

  test("another person's database, or a timesheet not copied yet, contributes nothing", async () => {
    const idb = await seeded();
    expect(await loadTimesheet(dcShellData(idb, "u2"), "p1", "2026-10-02")).toEqual({ state: "not_synced", projectId: "p1" });
    expect(await loadTimesheet(dcShellData(idb), "p2", "2026-10-02")).toEqual({ state: "not_synced", projectId: "p2" });
    expect(await loadTimesheet(dcShellData(idb), null, "2026-10-02")).toEqual({ state: "no_project" });
  });

  test("tasks not copied yet: the grid still opens, and says so (never a task list invented)", async () => {
    const idb = new IDBFactory();
    await seedDesignChange(idb, "u1", [{ kind: TIMESHEETS_KIND, projectId: "p1", data: entryRow("t1") }], { done: { [TIMESHEETS_KIND]: ["p1"] } });
    const sheet = await loadTimesheet(dcShellData(idb), "p1", "2026-10-02");
    if (sheet.state !== "local") throw new Error(sheet.state);
    expect(sheet.tasksSynced).toBe(false);
    expect(sheet.tasks).toEqual([]);
    expect(sheet.entries[0]!.task).toBe("Untitled task");
  });

  test("day and week views filter the same rows; the week is the seven days ending on the chosen day, as online", () => {
    expect(weekWindow("2026-10-02")).toEqual({ from: "2026-09-26", to: "2026-10-02" });
    const rows = [{ spentOn: "2026-10-02" }, { spentOn: "2026-09-28" }, { spentOn: "2026-09-25" }];
    expect(entriesInView(rows, "day", "2026-10-02")).toEqual([{ spentOn: "2026-10-02" }]);
    expect(entriesInView(rows, "week", "2026-10-02")).toEqual([{ spentOn: "2026-10-02" }, { spentOn: "2026-09-28" }]);
  });

  test("an entry logged here is shown at once as waiting; it can be submitted only once the server has it", async () => {
    const idb = await seeded();
    await recordTimeEntryOffline({ projectId: "p1", issueId: "i2", hours: "1", spentOn: "2026-10-02" }, { userId: "u1", idb, outbox: outboxOf(idb) });
    const sheet = await loadTimesheet(dcShellData(idb), "p1", "2026-10-02");
    if (sheet.state !== "local") throw new Error(sheet.state);
    const made = sheet.entries.find((e) => e.localOnly)!;
    expect(made).toMatchObject({ task: "#3 Concept boards", hours: 1, approvalStatus: null });
    expect(entryStatusWord(made)).toBe("Waiting to be sent");
    expect(canSubmitEntry(made)).toBe(false);
    expect(canSubmitEntry(sheet.entries.find((e) => e.id === "t1")!)).toBe(true);
    expect(canSubmitEntry(sheet.entries.find((e) => e.id === "t2")!)).toBe(false); // already submitted
  });

  test("log-time screen data: the day's own hours (for the 24-hour rule) and a preselected task only if it is on the laptop", async () => {
    const idb = await seeded();
    const ready = await loadTimeEntryNew(dcShellData(idb), "p1", "2026-10-02", "i1");
    if (ready.state !== "ready") throw new Error(ready.state);
    expect(ready.myHoursByDay).toEqual({ "2026-10-02": 2.5, "2026-09-28": 3 });
    expect(ready.preselectedTaskId).toBe("i1");
    const other = await loadTimeEntryNew(dcShellData(idb), "p1", "2026-10-02", "i9");
    if (other.state !== "ready") throw new Error(other.state);
    expect(other.preselectedTaskId).toBeNull(); // archived: not offered
  });

  test("an entry object is found in the person's projects; one of another designer opens too (the review links to it)", async () => {
    const idb = await seeded();
    const one = await loadTimeEntryObject(dcShellData(idb), "t3", null);
    if (one.state !== "local") throw new Error(one.state);
    expect(one.entry).toMatchObject({ mine: false, hours: 4, task: "#12 Joinery shop drawings" });
    expect((await loadTimeEntryObject(dcShellData(idb), "t6", "p1")).state).toBe("not_found"); // its date was unreadable
  });
});

describe("the review queue", () => {
  test("submitted entries only, one group per designer per day, newest day first, hours added for display", async () => {
    const idb = await seeded();
    const review = await loadReview(dcShellData(idb), "p1");
    if (review.state !== "local") throw new Error(review.state);
    expect(review.groups.map((g) => [g.userId, g.spentOn, g.self, g.hours, g.entries.map((e) => e.id)])).toEqual([
      ["u7", "2026-10-02", false, 5.25, ["t3", "t4"]],
      ["u1", "2026-09-28", true, 3, ["t2"]],
    ]);
    expect(review.groups[0]!.entries[1]!.task).toBe("Untitled task");
  });

  test("an approval made here keeps the entry submitted (the server decides) and is shown as waiting", async () => {
    const idb = await seeded();
    await approveTimeEntryOffline({ projectId: "p1", timeEntryId: "t3" }, { userId: "u1", idb, outbox: outboxOf(idb) });
    const review = await loadReview(dcShellData(idb), "p1");
    if (review.state !== "local") throw new Error(review.state);
    const t3 = review.groups[0]!.entries.find((e) => e.id === "t3")!;
    expect(t3.approvalStatus).toBe("submitted");
    expect(entryStatusWord(t3)).toBe("Approval waiting to be sent");
  });

  test("the cluster's task picker skips rows that are not tasks", () => {
    expect(toTaskOptions([null, [], { id: "a" }, { id: "b", title: " " }, { id: "c", title: "Ok", number: "4" }])).toEqual([{ id: "c", title: "Ok", number: 4 }]);
  });
});
