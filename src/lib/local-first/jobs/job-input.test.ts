import { afterEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb, type LocalDb } from "../local-db";
import { MANIFEST_KEY } from "../replica";
import { loadJobInput, projectIsLocal } from "./job-input";
import { readJobsOptOut, writeJobsOptOut } from "./opt-out";

let db: LocalDb | null = null;
afterEach(() => { db?.close(); db = null; });

async function seed() {
  db = await openLocalDb(new IDBFactory(), localDbNameFor("u1"));
  await db.setMeta(MANIFEST_KEY, { userId: "u1", orgId: "orgA", projectIds: ["p1"], kinds: [], at: 1 });
  const put = (type: string, id: string, projectId: string, data: unknown) => ({ id: `${type}:${id}`, type, orgId: "orgA", projectId, data, updatedAt: 1 });
  await db.putRecords([
    put("boq_lines", "1", "p1", { id: "1", boqId: "b", amount: "5" }),
    put("boq_lines", "9", "p2", { id: "9", boqId: "b", amount: "500" }),
    put("rfis", "r1", "p1", { id: "r1", title: "Concrete" }),
  ]);
  return db;
}

describe("job input comes only from this laptop's own copy of a project that is in the manifest", () => {
  test("boq_rollup reads this project's lines only; other projects' rows never enter", async () => {
    const d = await seed();
    expect((await loadJobInput(d, { type: "boq_rollup", project_id: "p1", params: {} }))!.rows).toEqual([{ id: "1", boqId: "b", amount: "5" }]);
  });
  test("a project that is not in the manifest yields nothing, even if rows exist", async () => {
    const d = await seed();
    expect(await projectIsLocal(d, "p1")).toBe(true);
    expect(await projectIsLocal(d, "p2")).toBe(false);
    expect(await loadJobInput(d, { type: "boq_rollup", project_id: "p2", params: {} })).toBeNull();
  });
  test("csv_export needs a kind; search_index wraps rows with their kind; unknown types give nothing", async () => {
    const d = await seed();
    expect(await loadJobInput(d, { type: "csv_export", project_id: "p1", params: {} })).toBeNull();
    expect((await loadJobInput(d, { type: "csv_export", project_id: "p1", params: { kind: "rfis" } }))!.rows).toEqual([{ id: "r1", title: "Concrete" }]);
    expect((await loadJobInput(d, { type: "search_index", project_id: "p1", params: { kinds: ["rfis"] } }))!.rows).toEqual([{ kind: "rfis", row: { id: "r1", title: "Concrete" } }]);
    expect(await loadJobInput(d, { type: "drop", project_id: "p1", params: {} })).toBeNull();
  });
  test("the opt-out choice is kept in the laptop's own database", async () => {
    const d = await seed();
    expect(await readJobsOptOut(d)).toBe(false);
    await writeJobsOptOut(d, true);
    expect(await readJobsOptOut(d)).toBe(true);
    await writeJobsOptOut(d, false);
    expect(await readJobsOptOut(d)).toBe(false);
  });
});
