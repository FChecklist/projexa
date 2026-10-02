import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY, doneKey } from "../../replica";
import type { ShellData } from "../context";
import { num, parseAttendance, parseProgress, parseReceipt, parseTask, parseWorker, readKind } from "./delivery-local";

// The delivery cluster's one reading layer: what a replica row of each kind becomes, and when a (project, kind) counts as "on this
// laptop". Rows are seeded straight into fake-indexeddb, the way the sync engine stores them.

async function seed(idb: IDBFactory, userId = "u1", orgId = "orgA") {
  const db = await openLocalDb(idb, localDbNameFor(userId));
  await db.setMeta(MANIFEST_KEY, { userId, orgId, projectIds: ["p1"], kinds: ["roster"], at: 1 });
  const rows = [
    { id: "w1", name: "Ravi", trade: "mason", is_active: true, daily_rate: null },
    { id: "w2", name: "Imran", trade: "fitter", isActive: false, dailyRate: "850.50" },
    { id: "junk-no-name" },
    "not even an object",
  ];
  await db.putRecords(rows.map((r, i) => ({ id: `roster:${typeof r === "object" ? r.id : i}`, type: "roster", orgId, projectId: "p1", data: r, updatedAt: 1 })));
  await db.setMeta(doneKey("p1", "roster"), { at: 1_760_000_000_000, redacted: true, hiddenFields: ["daily_rate"] });
  db.close();
}

const shellData = (idb: IDBFactory, over: Partial<ShellData> = {}): ShellData => ({
  userId: "u1", name: "Asha", email: null, role: "site_engineer", orgId: "orgA", idb, projects: [{ id: "p1", name: "Cedar" }], ...over,
});

describe("readKind", () => {
  test("a synced pair: parsed rows, junk skipped, the hidden fields and when it was copied", async () => {
    const idb = new IDBFactory();
    await seed(idb);
    const r = await readKind(shellData(idb), "p1", "roster", parseWorker);
    if (!r.synced) throw new Error("expected synced");
    expect(r.rows.map((w) => w.id).sort()).toEqual(["w1", "w2"]);
    expect(r.hidden).toEqual(["daily_rate"]);
    expect(r.syncedAt).toBe(1_760_000_000_000);
  });

  test("a pair that never finished copying is not synced (never a partial list)", async () => {
    const idb = new IDBFactory();
    await seed(idb);
    expect(await readKind(shellData(idb), "p1", "attendance", parseAttendance)).toEqual({ synced: false });
  });

  test("another person's database contributes nothing, and neither does another organisation's copy", async () => {
    const idb = new IDBFactory();
    await seed(idb, "u2");
    expect(await readKind(shellData(idb), "p1", "roster", parseWorker)).toEqual({ synced: false });
    const idb2 = new IDBFactory();
    await seed(idb2, "u1", "orgB");
    const r = await readKind(shellData(idb2), "p1", "roster", parseWorker);
    expect(r.synced ? r.rows : []).toEqual([]);
  });
});

describe("parsers accept the wire's snake_case and the camelCase spelling, and refuse what is not that thing", () => {
  test("numbers: JSON numbers and numeric text, anything else is null (never 0)", () => {
    expect(num({ a: 2 }, "a")).toBe(2);
    expect(num({ a: "12.50" }, "a")).toBe(12.5);
    expect(num({ a: "" }, "a")).toBeNull();
    expect(num({ a: "12abc" }, "a")).toBeNull();
    expect(num({ a: null }, "a")).toBeNull();
  });

  test("progress", () => {
    expect(parseProgress({ id: "e1", activity_id: "a1", boq_line_item_id: "l1", entry_date: "2026-10-01", quantity_done: "3", percent_complete: 40, entry_basis: "DELTA" }))
      .toMatchObject({ id: "e1", activityId: "a1", boqLineItemId: "l1", entryDate: "2026-10-01", quantityDone: 3, percentComplete: 40, entryBasis: "DELTA" });
    expect(parseProgress({ id: "e2", entryDate: "2026-10-01T09:00:00Z", percentComplete: "10" })).toMatchObject({ entryDate: "2026-10-01", percentComplete: 10 });
    expect(parseProgress({ id: "e3" })).toBeNull();
    expect(parseProgress({ entry_date: "2026-10-01" })).toBeNull();
  });

  test("a hidden money field stays null", () => {
    expect(parseWorker({ id: "w", name: "N", daily_rate: null })!.dailyRate).toBeNull();
    expect(parseReceipt({ id: "r", material_id: "m", received_date: "2026-10-01", quantity: 5, unit_cost: null })!.unitCost).toBeNull();
  });

  test("receipts: a voided receipt is marked; one without quantity is refused", () => {
    expect(parseReceipt({ id: "r", material_id: "m", received_date: "2026-10-01", quantity: "5", voided_at: "2026-10-02T00:00:00Z" })!.voided).toBe(true);
    expect(parseReceipt({ id: "r", material_id: "m", received_date: "2026-10-01" })).toBeNull();
  });

  test("tasks: archived tasks are not shown", () => {
    expect(parseTask({ id: "t", title: "Pour slab", is_archived: true })).toBeNull();
    expect(parseTask({ id: "t", title: "Pour slab", start_date: "2026-10-01", due_date: "2026-10-05" })).toMatchObject({ startDate: "2026-10-01", dueDate: "2026-10-05" });
  });
});
