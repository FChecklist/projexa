import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { deliveryShellData as shellData, seedDelivery, type SeedPair } from "./delivery-test-seed";
import { loadAttendanceSheet, loadLabour, loadWorker } from "./labour-adapter";

// Labour read from the laptop: the roster, attendance with worker names, a day's counts, one worker, the day's sheet; and the money
// columns (daily_rate, daily_cost) never shown to a role the sync hid them from.

const roster = (hidden: string[] = []): SeedPair => ({
  projectId: "p1", kind: "roster", hidden,
  rows: [
    { id: "w1", name: "Ravi", trade: "mason", employee_code: "M-01", is_active: true, daily_rate: hidden.length ? null : "900" },
    { id: "w2", name: "Imran", trade: "fitter", is_active: true, daily_rate: hidden.length ? null : 1100 },
    { id: "w3", name: "Old Hand", trade: "mason", is_active: false, daily_rate: null },
    { id: "nameless" },
  ],
});
const attendance = (hidden: string[] = [], extra: unknown[] = []): SeedPair => ({
  projectId: "p1", kind: "attendance", hidden,
  rows: [
    { id: "t1", roster_id: "w1", attendance_date: "2026-10-02", status: "present", hours_worked: 8, daily_cost: hidden.length ? null : "900" },
    { id: "t2", roster_id: "w2", attendance_date: "2026-10-02", status: "absent", hours_worked: 0, daily_cost: hidden.length ? null : 0 },
    { id: "t3", roster_id: "w1", attendance_date: "2026-10-01", status: "half_day", hours_worked: 4, daily_cost: hidden.length ? null : 450 },
    ...extra,
  ],
});

describe("the Labour screen", () => {
  test("roster by name (junk skipped), attendance newest first with names, today's counts", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [roster(), attendance()]);
    const r = await loadLabour(shellData(idb), "p1", "2026-10-02");
    if (r.state !== "local") throw new Error(`expected local, got ${r.state}`);
    expect(r.workers.map((w) => w.name)).toEqual(["Imran", "Old Hand", "Ravi"]);
    expect(r.workers.find((w) => w.id === "w1")!.dailyRate).toBe(900);
    expect(r.attendance!.map((m) => m.id)).toEqual(["t2", "t1", "t3"]);
    expect(r.attendance![1]).toMatchObject({ workerName: "Ravi", trade: "mason", dailyCost: 900, waiting: false });
    expect(r.today).toEqual({ present: 1, halfDay: 0, absent: 1, marked: 2 });
  });

  test("a viewer-role copy: rates and costs are hidden, even when a row carries a value the marker says is hidden", async () => {
    const idb = new IDBFactory();
    const leaky = { id: "t9", roster_id: "w2", attendance_date: "2026-10-01", status: "present", daily_cost: 1234 };
    await seedDelivery(idb, [
      { ...roster(["daily_rate"]), rows: [{ id: "w1", name: "Ravi", daily_rate: "999" }] },
      attendance(["daily_cost"], [leaky]),
    ]);
    const r = await loadLabour(shellData(idb, { role: "viewer" }), "p1", "2026-10-02");
    if (r.state !== "local") throw new Error("unreachable");
    expect(r.rateHidden).toBe(true);
    expect(r.costHidden).toBe(true);
    expect(r.workers.every((w) => w.dailyRate === null)).toBe(true);
    expect(r.attendance!.every((m) => m.dailyCost === null)).toBe(true);
  });

  test("a mark waiting to be sent counts over the server's mark for the same worker and day", async () => {
    const idb = new IDBFactory();
    // "0aa" sorts BEFORE "local-x" (and t2 after it): the waiting mark must win whatever the ids are
    await seedDelivery(idb, [roster(), attendance([], [
      { id: "0aa", roster_id: "w2", attendance_date: "2026-10-02", status: "absent", daily_cost: 0 },
      { id: "local-x", roster_id: "w2", attendance_date: "2026-10-02", status: "present", daily_cost: null },
    ])]);
    const r = await loadLabour(shellData(idb), "p1", "2026-10-02");
    if (r.state !== "local") throw new Error("unreachable");
    expect(r.today).toEqual({ present: 2, halfDay: 0, absent: 0, marked: 2 });
    expect(r.attendance!.find((m) => m.id === "local-x")!.waiting).toBe(true);
  });

  test("roster not copied: not_synced; attendance not copied: the roster shows and attendance is null", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [{ ...roster(), synced: false }, attendance()]);
    expect(await loadLabour(shellData(idb), "p1", "2026-10-02")).toEqual({ state: "not_synced", projectId: "p1" });
    const idb2 = new IDBFactory();
    await seedDelivery(idb2, [roster(), { ...attendance(), synced: false }]);
    const r = await loadLabour(shellData(idb2), "p1", "2026-10-02");
    expect(r.state === "local" && r.attendance).toBeNull();
    expect(await loadLabour(shellData(idb2), null, "2026-10-02")).toEqual({ state: "no_project" });
  });

  test("another person's database contributes nothing", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [roster(), attendance()], { userId: "u2" });
    expect((await loadLabour(shellData(idb), "p1", "2026-10-02")).state).toBe("not_synced");
  });
});

describe("one worker and the day's sheet", () => {
  test("a worker with their own attendance only", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [roster(), attendance()]);
    const r = await loadWorker(shellData(idb), "w1", null);
    if (r.state !== "local") throw new Error("unreachable");
    expect(r.worker.name).toBe("Ravi");
    expect(r.attendance!.map((m) => m.id)).toEqual(["t1", "t3"]);
    expect((await loadWorker(shellData(idb), "nobody", "p1")).state).toBe("not_found");
  });

  test("the sheet lists every active worker (and an inactive one only if marked that day) with that day's mark", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [roster(), attendance()]);
    const r = await loadAttendanceSheet(shellData(idb), "p1", "2026-10-01");
    if (r.state !== "local") throw new Error("unreachable");
    expect(r.rows.map((x) => [x.worker.id, x.mark?.status ?? null])).toEqual([["w2", null], ["w1", "half_day"]]);
    expect(r.counts).toEqual({ present: 0, halfDay: 1, absent: 0, marked: 1 });
    expect(await loadAttendanceSheet(shellData(idb), "p1", "yesterday")).toEqual({ state: "invalid_date" });
  });
});
