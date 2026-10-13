import { beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { loadScopeRevise } from "./scope-adapter";
import { cumulativeProgress, scopeReductions } from "./scope-writes";
import { seedDesignChange } from "./design-change-test-fixtures";
import type { ShellData } from "../context";
import { toDrafts, type BoqLineItemRow } from "@/lib/boq-helpers";

// UAT 2026-10-13, F60 / checklist 2.22: the revision guard and its message quoted the LATEST progress entry's own percent ("15% complete")
// where the line is 80% done. A progress entry is "today's work" (DELTA) by default, so how far a line is = the quantities added up against
// the line's quantity (a SNAPSHOT entry is "total to date"). These tests read the laptop's own database through the real adapter.

let idb: IDBFactory;
beforeEach(() => { idb = new IDBFactory(); });

const BOQ = { id: "b1", project_id: "p1", title: "Villa", version: 1, status: "approved", parent_boq_id: null, created_at: "2026-09-01T08:00:00Z" };
const line = (id: string, code: string, quantity: number) => ({
  id, boq_id: "b1", item_code: code, description: `Line ${code}`, unit: "m3", quantity, rate: 10, amount: quantity * 10, parent_line_item_id: null, activity_id: null,
  category: null, breakdown_percentage: null, created_at: "2026-09-01T08:00:00Z",
});
const entry = (id: string, lineId: string, date: string, qty: number, pct: number, basis: "DELTA" | "SNAPSHOT" = "DELTA") => ({
  id, activity_id: "act1", boq_line_item_id: lineId, entry_date: date, quantity_done: qty, percent_complete: pct, entry_basis: basis, created_at: `${date}T08:00:00Z`,
});

const shell = (): ShellData => ({ userId: "u1", name: null, email: null, role: "manager", orgId: "orgA", projects: [{ id: "p1", name: "Villa" }], idb });

async function seed(progress: unknown[]) {
  await seedDesignChange(idb, "u1", [
    { kind: "boqs", projectId: "p1", data: BOQ },
    { kind: "boq_lines", projectId: "p1", data: line("li1", "A1", 100) },
    { kind: "boq_lines", projectId: "p1", data: line("li2", "A2", 200) },
    ...progress.map((data) => ({ kind: "progress", projectId: "p1", data })),
  ], { done: { boqs: ["p1"], boq_lines: ["p1"], progress: ["p1"] } });
}

describe("the progress the revision guard holds is the CUMULATIVE figure", () => {
  test("three 'today's work' entries (40 + 25 + 15 of 100 m3): the line is 80% done, not 15% (the last entry's own percent)", async () => {
    await seed([entry("e1", "li1", "2026-10-01", 40, 40), entry("e2", "li1", "2026-10-05", 25, 25), entry("e3", "li1", "2026-10-10", 15, 15)]);
    const data = await loadScopeRevise(shell(), "b1", "p1");
    expect(data.state).toBe("ready");
    if (data.state !== "ready") return;
    expect(data.progress).toEqual({ li1: 80 });
  });

  test("the guard's own words quote the cumulative figure", async () => {
    await seed([entry("e1", "li1", "2026-10-01", 40, 40), entry("e2", "li1", "2026-10-05", 25, 25), entry("e3", "li1", "2026-10-10", 15, 15)]);
    const data = await loadScopeRevise(shell(), "b1", "p1");
    if (data.state !== "ready") throw new Error("not ready");
    const unchanged = toDrafts(data.parent);
    const removed = unchanged.filter((d) => d.itemCode !== "A1");
    expect(scopeReductions(data.parent, new Map(Object.entries(data.progress!)), removed)).toEqual(['"Line A1" is 80% complete on site and would be removed entirely']);
  });

  test("a 'total to date' (SNAPSHOT) entry stands as it is, and is not added to; the larger of the two measures wins", () => {
    const parent: BoqLineItemRow[] = [{ id: "li1", itemCode: "A1", description: "x", unit: "m3", quantity: "100", rate: "10", amount: "1000", activityId: null }];
    const qty = new Map([["li1", 100]]);
    expect(cumulativeProgress([entry("s1", "li1", "2026-10-01", 0, 60, "SNAPSHOT") as never].map(toLike), qty).get("li1")).toBe(60);
    expect(cumulativeProgress([entry("s1", "li1", "2026-10-01", 0, 60, "SNAPSHOT"), entry("d1", "li1", "2026-10-02", 10, 10)].map(toLike), qty).get("li1")).toBe(60);
    expect(parent).toHaveLength(1);
  });

  test("never above 100; an entry with no quantity to measure against falls back to its own percent, as before", () => {
    const qty = new Map([["li1", 100], ["li2", 0]]);
    const rows = [entry("a", "li1", "2026-10-01", 70, 70), entry("b", "li1", "2026-10-02", 70, 70), entry("c", "li2", "2026-10-01", 0, 35)].map(toLike);
    const out = cumulativeProgress(rows, qty);
    expect(out.get("li1")).toBe(100);
    expect(out.get("li2")).toBe(35);
  });
});

function toLike(e: ReturnType<typeof entry>) {
  return { boqLineItemId: e.boq_line_item_id, entryDate: e.entry_date, percentComplete: e.percent_complete, createdAt: e.created_at, quantityDone: e.quantity_done, entryBasis: e.entry_basis };
}
