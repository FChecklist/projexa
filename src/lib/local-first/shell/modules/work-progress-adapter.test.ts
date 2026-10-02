import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { deliveryShellData as shellData, seedDelivery, type SeedPair } from "./delivery-test-seed";
import { loadWorkProgress, loadWorkProgressEntry, progressCsv } from "./work-progress-adapter";

// Work Progress read from the laptop: entries with their activity and BOQ line resolved locally, the Daily Entry form's offline state,
// one entry, and the CSV export of the laptop's copy.

const progress = (over: Record<string, unknown>[] = []): SeedPair => ({
  projectId: "p1", kind: "progress",
  rows: [
    { id: "e1", activity_id: "a1", boq_line_item_id: "l1", entry_date: "2026-09-30", quantity_done: "10", percent_complete: 10, entry_basis: "DELTA", remarks: "Grid A", created_at: "2026-09-30T08:00:00Z" },
    { id: "e2", activity_id: "a1", boq_line_item_id: "l2", entry_date: "2026-10-01", quantity_done: 4, percent_complete: "20.5", entry_basis: "SNAPSHOT", created_at: "2026-10-01T08:00:00Z" },
    { id: "local-t1", activity_id: "a1", boq_line_item_id: "l1", entry_date: "2026-10-02", quantity_done: 3, percent_complete: null, entry_basis: "DELTA" },
    { id: "bad-no-date" },
    ...over,
  ],
});
const activities = (n = 1): SeedPair => ({ projectId: "p1", kind: "activities", rows: Array.from({ length: n }, (_, i) => ({ id: `a${i + 1}`, name: `Blockwork ${i + 1}`, unit: "m2", planned_quantity: "100" })) });
const lines: SeedPair = { projectId: "p1", kind: "boq_lines", rows: [{ id: "l2", item_code: "02", description: "Plaster", unit: "m2", quantity: "50" }, { id: "l1", item_code: "01", description: "Blocks", unit: "nos", quantity: "200" }] };

describe("the Work Progress list", () => {
  test("newest first, names resolved from the laptop's activities and BOQ lines, the pending entry marked, junk skipped", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [progress(), activities(), lines]);
    const r = await loadWorkProgress(shellData(idb), "p1");
    if (r.state !== "local") throw new Error(`expected local, got ${r.state}`);
    expect(r.entries.map((e) => e.id)).toEqual(["local-t1", "e2", "e1"]);
    expect(r.entries[0]).toMatchObject({ waiting: true, activityName: "Blockwork 1", boqLabel: "01 · Blocks", unit: "nos" });
    expect(r.entries[1]).toMatchObject({ waiting: false, percentComplete: 20.5, entryBasis: "SNAPSHOT", boqLabel: "02 · Plaster" });
    expect(r.namesKnown).toEqual({ activities: true, lines: true });
  });

  test("the form can keep an entry offline with one activity; lines sorted by item code", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [progress(), activities(1), lines]);
    const r = await loadWorkProgress(shellData(idb), "p1");
    if (r.state !== "local") throw new Error("unreachable");
    expect(r.form.mode).toBe("offline");
    if (r.form.mode !== "offline") throw new Error("unreachable");
    expect(r.form.activity?.id).toBe("a1");
    expect(r.form.lines.map((l) => l.id)).toEqual(["l1", "l2"]);
  });

  test("with several activities the form needs the server; with activities not copied it says so too", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [progress(), activities(2), lines]);
    const r = await loadWorkProgress(shellData(idb), "p1");
    expect(r.state === "local" && r.form).toEqual({ mode: "needs_server", reason: "several_activities" });

    const idb2 = new IDBFactory();
    await seedDelivery(idb2, [progress(), { ...activities(1), synced: false }, lines]);
    const r2 = await loadWorkProgress(shellData(idb2), "p1");
    if (r2.state !== "local") throw new Error("unreachable");
    expect(r2.form).toEqual({ mode: "needs_server", reason: "not_synced" });
    expect(r2.namesKnown.activities).toBe(false);
    expect(r2.entries.find((e) => e.id === "e1")!.activityName).toBeNull(); // never guessed
  });

  test("not synced, no project, and another person's database contributes nothing", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [{ ...progress(), synced: false }]);
    expect(await loadWorkProgress(shellData(idb), "p1")).toEqual({ state: "not_synced", projectId: "p1" });
    expect(await loadWorkProgress(shellData(idb), null)).toEqual({ state: "no_project" });
    const idb2 = new IDBFactory();
    await seedDelivery(idb2, [progress(), activities(), lines], { userId: "u2" });
    expect((await loadWorkProgress(shellData(idb2), "p1")).state).toBe("not_synced");
  });
});

describe("one entry", () => {
  test("found in its project, with the activity's planned quantity; searched across projects without ?projectId=", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [progress(), activities(), lines, { projectId: "p2", kind: "progress", rows: [{ id: "e9", entry_date: "2026-10-01" }] }]);
    const r = await loadWorkProgressEntry(shellData(idb), "e1", "p1");
    if (r.state !== "local") throw new Error("unreachable");
    expect(r.entry).toMatchObject({ id: "e1", activityName: "Blockwork 1", quantityDone: 10, remarks: "Grid A" });
    expect(r.activityPlanned).toEqual({ quantity: 100, unit: "m2" });
    const other = await loadWorkProgressEntry(shellData(idb), "e9", null);
    expect(other.state === "local" && other.projectId).toBe("p2");
    expect(await loadWorkProgressEntry(shellData(idb), "nope", "p1")).toEqual({ state: "not_found", projectId: "p1" });
  });
});

describe("CSV export", () => {
  test("the online list's columns, quoted where needed, a formula-looking cell neutralised, waiting rows marked", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [progress([{ id: "e3", entry_date: "2026-09-01", remarks: '=HYPERLINK("x"), "quoted"' }]), activities(), lines]);
    const r = await loadWorkProgress(shellData(idb), "p1");
    if (r.state !== "local") throw new Error("unreachable");
    const csv = progressCsv(r.entries);
    const rows = csv.trim().split("\r\n");
    expect(rows[0]).toBe("Date,Activity,BOQ line,Qty done,Unit,% complete,Basis,Remarks,Saved");
    expect(rows[1]).toBe("2026-10-02,Blockwork 1,01 · Blocks,3,nos,,DELTA,,waiting to be sent");
    expect(rows.at(-1)).toBe(`2026-09-01,,,,,,,"'=HYPERLINK(""x""), ""quoted""",on server`);
  });
});
