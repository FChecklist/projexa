import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeSyncServer } from "../../__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { createOutbox, type Outbox } from "../../outbox";
import { createReplica } from "../../replica";
import type { ShellData } from "../context";
import { markAttendanceOffline, recordIssueOffline, recordProgressOffline, recordReceiptOffline, refusalText } from "./delivery-writes";

// The delivery cluster's daily writes, end to end on the REAL replica and outbox against the shared fake sync server: the person's
// intent is kept on the laptop at once (an optimistic row with a temporary id), sent with the registry's parameter names, and the
// server's row replaces it. Every refusal enqueues nothing.

const KINDS = ["roster", "attendance", "materials", "material_receipts", "material_issues", "activities", "boq_lines", "progress"].map((kind) => ({ kind }));

type Rig = { idb: IDBFactory; server: FakeSyncServer; outbox: Outbox; data: ShellData; enqueued: () => number; access: { outbox: Outbox; newId: () => string } };

function seedProject(s: FakeSyncServer, opts: { activities?: number } = {}) {
  s.upsert({ kind: "roster", projectId: "p1", id: "w1", data: { id: "w1", name: "Ravi", trade: "mason", is_active: true, daily_rate: null } });
  s.upsert({ kind: "materials", projectId: "p1", id: "m1", data: { id: "m1", name: "Cement", unit: "bag", is_active: true, unit_cost: null } });
  s.upsert({ kind: "boq_lines", projectId: "p1", id: "l1", data: { id: "l1", boq_id: "b1", item_code: "01", description: "Blockwork", unit: "m2", quantity: "100" } });
  for (let i = 1; i <= (opts.activities ?? 1); i += 1) s.upsert({ kind: "activities", projectId: "p1", id: `a${i}`, data: { id: `a${i}`, name: `Activity ${i}` } });
}

async function rig(opts: { activities?: number; seed?: boolean; sync?: boolean; outboxOverride?: Partial<Outbox> } = {}): Promise<Rig> {
  const idb = new IDBFactory();
  const server = createFakeSyncServer({ kinds: KINDS });
  if (opts.seed !== false) seedProject(server, opts);
  let n = 0;
  server.registerFunction("record_attendance", ({ params, projectId }) => {
    n += 1;
    return { ok: true, kind: "attendance", id: `srv-att-${n}`, data: { id: `srv-att-${n}`, project_id: projectId, roster_id: params.rosterId, attendance_date: params.date, status: params.status, hours_worked: params.hours ?? null, daily_cost: 900 } };
  });
  server.registerFunction("record_material_issue", ({ params }) => {
    n += 1;
    return { ok: true, kind: "material_issues", id: `srv-iss-${n}`, data: { id: `srv-iss-${n}`, material_id: params.materialId, issued_date: params.issuedDate, quantity: params.quantity } };
  });
  server.registerFunction("record_material_receipt", ({ params }) => {
    n += 1;
    return { ok: true, kind: "material_receipts", id: `srv-rec-${n}`, data: { id: `srv-rec-${n}`, material_id: params.materialId, received_date: params.receivedDate, quantity: params.quantity, unit_cost: 410 } };
  });
  if (opts.sync !== false) await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  let op = 0;
  const real = createOutbox({ userId: "u1", client: server.client, deviceId: "dev-1", idb, autoFlush: false, locks: null, sleep: async () => {}, newOpId: () => `op-${++op}` });
  let enqueued = 0;
  const outbox: Outbox = { ...real, enqueue: async (input) => { enqueued += 1; return real.enqueue(input); }, ...opts.outboxOverride };
  let tid = 0;
  const data: ShellData = { userId: "u1", name: "Asha", email: null, role: "site_engineer", orgId: "orgA", idb, projects: [{ id: "p1", name: "Cedar" }] };
  return { idb, server, outbox, data, enqueued: () => enqueued, access: { outbox, newId: () => `t${++tid}` } };
}

const pushed = (r: Rig) => r.server.requests.filter((q) => q.path === "/push").flatMap((q) => q.body.ops as Array<Record<string, unknown>>);

async function rowsOf(r: Rig, kind: string) {
  const db = await openLocalDb(r.idb, localDbNameFor("u1"));
  try {
    return await db.listByProject("orgA", kind, "p1");
  } finally {
    db.close();
  }
}

describe("record_attendance", () => {
  test("kept at once as a pending row, sent with the registry's names, replaced by the server's row (which carries the cost)", async () => {
    const r = await rig();
    const res = await markAttendanceOffline(r.data, { projectId: "p1", rosterId: "w1", date: "2026-10-02", status: "half_day", hours: 4 }, r.access);
    expect(res).toEqual({ queued: true, opId: "op-1", tempId: "local-t1" });
    const temp = (await rowsOf(r, "attendance")).find((x) => x.id === "attendance:local-t1")!;
    expect(temp.dirty).toBe("op-1");
    expect(temp.data).toEqual({ id: "local-t1", roster_id: "w1", attendance_date: "2026-10-02", status: "half_day", hours_worked: 4, daily_cost: null });

    await r.outbox.flush();
    expect(pushed(r)[0]).toMatchObject({ function_id: "record_attendance", project_id: "p1", params: { projectId: "p1", rosterId: "w1", date: "2026-10-02", status: "half_day", hours: 4 } });
    const after = await rowsOf(r, "attendance");
    expect(after.map((x) => x.id)).toEqual(["attendance:srv-att-1"]);
    expect((after[0]!.data as { daily_cost: number }).daily_cost).toBe(900);
  });

  test("a worker that is not on this project's roster, a bad status, or a bad date: refused, nothing enqueued", async () => {
    const r = await rig();
    expect(await markAttendanceOffline(r.data, { projectId: "p1", rosterId: "nobody", date: "2026-10-02", status: "present" }, r.access)).toEqual({ queued: false, reason: "unknown_record" });
    expect(await markAttendanceOffline(r.data, { projectId: "p1", rosterId: "w1", date: "2026-10-02", status: "leave" as never }, r.access)).toEqual({ queued: false, reason: "invalid" });
    expect(await markAttendanceOffline(r.data, { projectId: "p1", rosterId: "w1", date: "02/10/2026", status: "present" }, r.access)).toEqual({ queued: false, reason: "invalid" });
    expect(await markAttendanceOffline(r.data, { projectId: "p1", rosterId: "w1", date: "2026-10-02", status: "present", hours: 30 }, r.access)).toEqual({ queued: false, reason: "invalid" });
    expect(r.enqueued()).toBe(0);
  });
});

describe("record_material_issue and record_material_receipt", () => {
  test("an issue is kept and sent; an unknown BOQ line is refused", async () => {
    const r = await rig();
    expect(await recordIssueOffline(r.data, { projectId: "p1", materialId: "m1", quantity: 5, issuedDate: "2026-10-02", boqLineItemId: "nope" }, r.access)).toEqual({ queued: false, reason: "unknown_record" });
    const res = await recordIssueOffline(r.data, { projectId: "p1", materialId: "m1", quantity: 5, issuedDate: "2026-10-02", boqLineItemId: "l1", issuedTo: "  Block crew ", note: "" }, r.access);
    expect(res.queued).toBe(true);
    await r.outbox.flush();
    expect(pushed(r)[0]).toMatchObject({ function_id: "record_material_issue", params: { projectId: "p1", materialId: "m1", quantity: 5, issuedDate: "2026-10-02", boqLineItemId: "l1", issuedTo: "Block crew" } });
    expect("note" in (pushed(r)[0]!.params as object)).toBe(false);
  });

  test("a receipt never sends a cost: money is the server's", async () => {
    const r = await rig();
    const res = await recordReceiptOffline(r.data, { projectId: "p1", materialId: "m1", quantity: 20, receivedDate: "2026-10-02", reference: "DN-44" }, r.access);
    expect(res.queued).toBe(true);
    const temp = (await rowsOf(r, "material_receipts"))[0]!;
    expect((temp.data as { unit_cost: unknown }).unit_cost).toBeNull();
    await r.outbox.flush();
    const sent = pushed(r)[0]!;
    expect(sent).toMatchObject({ function_id: "record_material_receipt", params: { projectId: "p1", materialId: "m1", quantity: 20, receivedDate: "2026-10-02", reference: "DN-44" } });
    expect(Object.keys(sent.params as object)).not.toContain("unitCost");
  });

  test("zero or negative quantities and unknown materials are refused", async () => {
    const r = await rig();
    expect((await recordIssueOffline(r.data, { projectId: "p1", materialId: "m1", quantity: 0, issuedDate: "2026-10-02" }, r.access)).queued).toBe(false);
    expect((await recordReceiptOffline(r.data, { projectId: "p1", materialId: "m1", quantity: -1, receivedDate: "2026-10-02" }, r.access)).queued).toBe(false);
    expect(await recordReceiptOffline(r.data, { projectId: "p1", materialId: "m9", quantity: 1, receivedDate: "2026-10-02" }, r.access)).toEqual({ queued: false, reason: "unknown_record" });
    expect(r.enqueued()).toBe(0);
  });
});

describe("record_work_progress", () => {
  test("with ONE activity on the project: kept (as a DELTA on that activity) and sent with the line, the quantity and the date", async () => {
    const r = await rig({ activities: 1 });
    const res = await recordProgressOffline(r.data, { projectId: "p1", boqLineItemId: "l1", quantityDone: 12, entryDate: "2026-10-02", remarks: "Grid B" }, r.access);
    expect(res.queued).toBe(true);
    const temp = (await rowsOf(r, "progress")).find((x) => x.id.startsWith("progress:local-"))!;
    expect(temp.data).toMatchObject({ activity_id: "a1", boq_line_item_id: "l1", quantity_done: 12, percent_complete: null, entry_basis: "DELTA" });
    await r.outbox.flush();
    expect(pushed(r)[0]).toMatchObject({ function_id: "record_work_progress", params: { projectId: "p1", boqLineItemId: "l1", quantityDone: 12, entryDate: "2026-10-02", remarks: "Grid B" } });
  });

  test("with SEVERAL activities it is refused: the server would pick one the person did not choose", async () => {
    const r = await rig({ activities: 2 });
    expect(await recordProgressOffline(r.data, { projectId: "p1", boqLineItemId: "l1", percent: 40, entryDate: "2026-10-02" }, r.access)).toEqual({ queued: false, reason: "several_activities" });
    expect(r.enqueued()).toBe(0);
    expect(refusalText("several_activities")).toContain("more than one activity");
  });

  test("a percent outside 0..100 or a missing line is refused", async () => {
    const r = await rig();
    expect((await recordProgressOffline(r.data, { projectId: "p1", boqLineItemId: "l1", percent: 140, entryDate: "2026-10-02" }, r.access)).queued).toBe(false);
    expect(await recordProgressOffline(r.data, { projectId: "p1", boqLineItemId: "zz", percent: 40, entryDate: "2026-10-02" }, r.access)).toEqual({ queued: false, reason: "unknown_record" });
    expect(r.enqueued()).toBe(0);
  });
});

describe("the laptop's copy decides whether anything can be kept", () => {
  test("a project the manifest does not list, another person, another organisation: not_on_laptop", async () => {
    const r = await rig();
    const input = { projectId: "p1", rosterId: "w1", date: "2026-10-02", status: "present" as const };
    expect(await markAttendanceOffline(r.data, { ...input, projectId: "p9" }, r.access)).toEqual({ queued: false, reason: "not_on_laptop" });
    expect(await markAttendanceOffline({ ...r.data, userId: "u2" }, input, r.access)).toEqual({ queued: false, reason: "not_on_laptop" });
    expect(await markAttendanceOffline({ ...r.data, orgId: "orgB" }, input, r.access)).toEqual({ queued: false, reason: "not_on_laptop" });
    expect(r.enqueued()).toBe(0);
  });

  test("never copied at all: not_on_laptop; an outbox that cannot store: failed", async () => {
    const never = await rig({ sync: false });
    expect((await markAttendanceOffline(never.data, { projectId: "p1", rosterId: "w1", date: "2026-10-02", status: "present" }, never.access)).queued).toBe(false);
    const broken = await rig({ outboxOverride: { enqueue: async () => { throw new Error("quota"); } } });
    expect(await markAttendanceOffline(broken.data, { projectId: "p1", rosterId: "w1", date: "2026-10-02", status: "present" }, { ...broken.access, outbox: broken.outbox })).toEqual({ queued: false, reason: "failed" });
  });
});
