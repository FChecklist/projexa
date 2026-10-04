import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY } from "../../replica";
import { createOutbox, type Outbox } from "../../outbox";
import type { SyncClient } from "../../sync-client";
import {
  approveTimeEntryOffline, createChangeOrderOffline, recordTimeEntryOffline, rejectTimeEntryOffline, submitChangeOrderOffline,
  submitTimeEntryOffline, validateNewChangeOrder, validateNewTimeEntry, validateSigner,
} from "./design-change-writes";
import { CHANGE_ORDERS_KIND, TIMESHEETS_KIND, pendingView, readPendingOps } from "./design-change-rows";

// The writes of the design-and-change cluster, against the REAL outbox (outbox.ts) on fake-indexeddb. The outbox never flushes here
// (autoFlush off, and a client that fails the test if it is ever called): these tests are about what is KEPT on the laptop, and the
// exact function id + parameters that will be proposed to the server when it is sent.

const neverCalled: Pick<SyncClient, "push" | "pullIds"> = {
  push: async () => { throw new Error("the outbox must not send anything in these tests"); },
  pullIds: async () => { throw new Error("the outbox must not send anything in these tests"); },
};

async function rig(opts: { projectIds?: string[]; userId?: string; manifestUserId?: string } = {}) {
  const idb = new IDBFactory();
  const db = await openLocalDb(idb, localDbNameFor("u1"));
  await db.setMeta(MANIFEST_KEY, { userId: opts.manifestUserId ?? "u1", orgId: "orgA", projectIds: opts.projectIds ?? ["p1"], kinds: [], at: 1 });
  await db.putRecords([
    { id: `${CHANGE_ORDERS_KIND}:co1`, type: CHANGE_ORDERS_KIND, orgId: "orgA", projectId: "p1", data: { id: "co1", number: 4, title: "Lobby", status: "draft" }, updatedAt: 1, serverVersion: 3 },
    { id: `${CHANGE_ORDERS_KIND}:co-p2`, type: CHANGE_ORDERS_KIND, orgId: "orgA", projectId: "p2", data: { id: "co-p2", number: 1, title: "Other", status: "draft" }, updatedAt: 1, serverVersion: 1 },
    { id: `${TIMESHEETS_KIND}:t1`, type: TIMESHEETS_KIND, orgId: "orgA", projectId: "p1", data: { id: "t1", issue_id: "i1", user_id: "u1", hours: "2", spent_on: "2026-10-01", approval_status: "draft" }, updatedAt: 1, serverVersion: 7 },
  ]);
  db.close();
  let n = 0;
  const outbox: Outbox = createOutbox({ userId: "u1", client: neverCalled, deviceId: "dev", idb, autoFlush: false, locks: null, newOpId: () => `op-${++n}` });
  const access = { userId: opts.userId ?? "u1", idb, outbox };
  const ops = () => readPendingOps({ userId: "u1", name: null, email: null, role: null, orgId: "orgA", projects: [], idb }, null);
  const row = async (kind: string, id: string) => {
    const d = await openLocalDb(idb, localDbNameFor("u1"));
    try {
      return await d.getRecord(kind, id);
    } finally {
      d.close();
    }
  };
  return { idb, outbox, access, ops, row };
}

describe("a new change order, made with the network off", () => {
  test("one create_change_order op with the person's intent, and a row on the laptop with NO invented number or status", async () => {
    const r = await rig();
    const result = await createChangeOrderOffline({ projectId: "p1", title: "  Revised lobby finish ", reason: "Client asked", costImpact: "-1500", scheduleImpactDays: "4" }, r.access);
    expect(result.queued).toBe(true);
    if (!result.queued) throw new Error("unreachable");

    const [op] = await r.ops();
    expect(op).toMatchObject({
      opId: "op-1", functionId: "create_change_order", projectId: "p1",
      params: { projectId: "p1", title: "Revised lobby finish", reason: "Client asked", costImpact: -1500, scheduleImpactDays: 4 },
      creates: { kind: CHANGE_ORDERS_KIND, id: result.tempId },
    });
    const local = await r.row(CHANGE_ORDERS_KIND, result.tempId!);
    expect(local?.projectId).toBe("p1");
    expect(local?.orgId).toBe("orgA");
    expect(local?.data).toMatchObject({ title: "Revised lobby finish", number: null, status: null, cost_impact: -1500, schedule_impact_days: 4 });
    expect(pendingView(await r.ops(), CHANGE_ORDERS_KIND).created.has(result.tempId!)).toBe(true);
  });

  test("lf-e10b: for a role whose copy has the cost HIDDEN, no costImpact is sent at all (no write for a hidden field), even a typed one", async () => {
    const r = await rig();
    await createChangeOrderOffline({ projectId: "p1", title: "Extra power points", scheduleImpactDays: "2", costHidden: true }, r.access);
    await createChangeOrderOffline({ projectId: "p1", title: "Typed anyway", costImpact: "900", costHidden: true }, r.access);
    const [a, b] = await r.ops();
    expect(a!.params).toEqual({ projectId: "p1", title: "Extra power points", scheduleImpactDays: 2 });
    expect(b!.params).toEqual({ projectId: "p1", title: "Typed anyway", scheduleImpactDays: 0 });
    const tempId = (b!.creates as { id: string }).id;
    expect((await r.row(CHANGE_ORDERS_KIND, tempId))?.data).toMatchObject({ cost_impact: null });
  });

  test("empty cost and schedule are sent as 0, exactly as the online screen does", async () => {
    const r = await rig();
    await createChangeOrderOffline({ projectId: "p1", title: "X" }, r.access);
    expect((await r.ops())[0]!.params).toEqual({ projectId: "p1", title: "X", costImpact: 0, scheduleImpactDays: 0 });
  });

  test("invalid input stores nothing, with the online screen's own words", async () => {
    const r = await rig();
    expect(validateNewChangeOrder({ projectId: "p1", title: " ", costImpact: "abc", scheduleImpactDays: "x" })).toEqual({
      title: "Title is required.", costImpact: "Cost impact must be a number.", scheduleImpactDays: "Schedule impact must be a number of days.",
    });
    expect(await createChangeOrderOffline({ projectId: "p1", title: "" }, r.access)).toEqual({ queued: false, reason: "invalid" });
    expect(await r.ops()).toEqual([]);
  });

  test("a project this laptop does not hold, or a manifest of another person, stores nothing", async () => {
    const r = await rig();
    expect(await createChangeOrderOffline({ projectId: "p9", title: "X" }, r.access)).toEqual({ queued: false, reason: "no_copy" });
    expect(await createChangeOrderOffline({ projectId: "p1", title: "X" }, { ...r.access, userId: "u2" })).toEqual({ queued: false, reason: "no_copy" });
    expect(await r.ops()).toEqual([]);
  });

  test("a stored manifest that names ANOTHER person is refused even when it lists the project (the ownership check on its own)", async () => {
    // this laptop's database for u1 holds a manifest of u2 that DOES list p1: only the ownership check can refuse the write
    const r = await rig({ manifestUserId: "u2", projectIds: ["p1"] });
    const result = await createChangeOrderOffline({ projectId: "p1", title: "X" }, r.access);
    expect(result.queued).toBe(false);
    expect(await r.ops()).toEqual([]);
  });
});

describe("sending a change order for approval is only RECORDED here; the server decides", () => {
  test("one op based on the server version; the row's status is NOT changed on the laptop", async () => {
    const r = await rig();
    const result = await submitChangeOrderOffline({ projectId: "p1", changeOrderId: "co1", signers: [{ name: " Ravi ", email: " ravi@client.test " }] }, r.access);
    expect(result.queued).toBe(true);
    const [op] = await r.ops();
    expect(op).toMatchObject({
      functionId: "submit_change_order_for_approval", projectId: "p1",
      params: { projectId: "p1", changeOrderId: "co1", signers: [{ name: "Ravi", email: "ravi@client.test" }] },
      record: { kind: CHANGE_ORDERS_KIND, id: "co1", baseVersion: 3 },
    });
    expect((await r.row(CHANGE_ORDERS_KIND, "co1"))?.data).toMatchObject({ status: "draft" });
    expect(pendingView(await r.ops(), CHANGE_ORDERS_KIND).waitingOn.get("co1")).toEqual(["submit_change_order_for_approval"]);
  });

  test("a bad signer, no signer, a change order of another project or one the server never saw: nothing is stored", async () => {
    const r = await rig({ projectIds: ["p1", "p2"] });
    expect(validateSigner({ name: "A", email: "not-an-email" })).toBe('"not-an-email" is not a valid email address');
    expect(validateSigner({ name: "", email: "a@b.co" })).toBe("Signer name and email are required");
    expect((await submitChangeOrderOffline({ projectId: "p1", changeOrderId: "co1", signers: [] }, r.access)).queued).toBe(false);
    expect(await submitChangeOrderOffline({ projectId: "p1", changeOrderId: "co-p2", signers: [{ name: "A", email: "a@b.co" }] }, r.access)).toEqual({ queued: false, reason: "no_row" });
    const made = await createChangeOrderOffline({ projectId: "p1", title: "Local only" }, r.access);
    if (!made.queued) throw new Error("unreachable");
    expect(await submitChangeOrderOffline({ projectId: "p1", changeOrderId: made.tempId!, signers: [{ name: "A", email: "a@b.co" }] }, r.access)).toEqual({ queued: false, reason: "no_row" });
    expect((await r.ops()).map((o) => o.functionId)).toEqual(["create_change_order"]);
  });
});

describe("timesheet entries", () => {
  test("a new entry: one record_timesheet op and a row with no approval status of its own", async () => {
    const r = await rig();
    const result = await recordTimeEntryOffline({ projectId: "p1", issueId: "i1", hours: "1.5", spentOn: "2026-10-02", activityType: "Drawings" }, r.access);
    if (!result.queued) throw new Error(`not queued: ${result.reason}`);
    const [op] = await r.ops();
    expect(op).toMatchObject({ functionId: "record_timesheet", params: { projectId: "p1", issueId: "i1", hours: 1.5, spentOn: "2026-10-02", activityType: "Drawings" } });
    expect((await r.row(TIMESHEETS_KIND, result.tempId!))?.data).toMatchObject({ user_id: "u1", hours: 1.5, spent_on: "2026-10-02", approval_status: null });
  });

  test("hours are checked with the online module's own rule, including the day's 24 hours", async () => {
    expect(validateNewTimeEntry({ projectId: "p1", issueId: "i1", hours: "0", spentOn: "2026-10-02" }).hours).toBe("Hours must be more than 0");
    expect(validateNewTimeEntry({ projectId: "p1", issueId: "i1", hours: "5", spentOn: "2026-10-02", otherHoursThatDay: 20 }).hours).toBe("Total for the day would exceed 24 hours");
    expect(validateNewTimeEntry({ projectId: "p1", issueId: "", hours: "2", spentOn: "bad" })).toEqual({ issueId: "Choose a task", spentOn: "Choose a date" });
    const r = await rig();
    expect(await recordTimeEntryOffline({ projectId: "p1", issueId: "i1", hours: "-1", spentOn: "2026-10-02" }, r.access)).toEqual({ queued: false, reason: "invalid" });
  });

  test("submit, approve and send back are recorded as the person's request against the server version; the row is untouched", async () => {
    const r = await rig();
    expect((await submitTimeEntryOffline({ projectId: "p1", timeEntryId: "t1" }, r.access)).queued).toBe(true);
    expect((await approveTimeEntryOffline({ projectId: "p1", timeEntryId: "t1" }, r.access)).queued).toBe(true);
    expect(await rejectTimeEntryOffline({ projectId: "p1", timeEntryId: "t1", rejectionReason: "  " }, r.access)).toEqual({ queued: false, reason: "invalid" });
    expect((await rejectTimeEntryOffline({ projectId: "p1", timeEntryId: "t1", rejectionReason: " wrong task " }, r.access)).queued).toBe(true);
    const ops = await r.ops();
    expect(ops.map((o) => [o.functionId, o.params, o.record])).toEqual([
      ["submit_timesheet", { projectId: "p1", timeEntryId: "t1" }, { kind: TIMESHEETS_KIND, id: "t1", baseVersion: 7 }],
      ["approve_timesheet", { timeEntryId: "t1" }, { kind: TIMESHEETS_KIND, id: "t1", baseVersion: 7 }],
      ["reject_timesheet", { timeEntryId: "t1", rejectionReason: "wrong task" }, { kind: TIMESHEETS_KIND, id: "t1", baseVersion: 7 }],
    ]);
    expect((await r.row(TIMESHEETS_KIND, "t1"))?.data).toMatchObject({ approval_status: "draft" });
  });
});
