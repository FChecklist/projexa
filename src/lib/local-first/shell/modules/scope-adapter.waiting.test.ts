import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY, doneKey } from "../../replica";
import { BOQS_KIND, BOQ_LINES_KIND } from "../../boq-local";
import type { ShellData } from "../context";
import { rememberBoqAlias } from "./boq-alias";
import { loadScopeList, loadScopeObject } from "./scope-adapter";

// R-19 on the laptop-first screen: a BOQ saved here (with a nested sub-task) must open at once from the laptop's own copy as "Waiting to sync",
// and keep opening after the server accepts it (the temporary id is replaced by a real one). It used to land on "BOQ not in the copy".

const TEMP = "local-abc";
const tempRow = {
  id: TEMP, project_id: "p1", title: "Villa fit-out", version: 1, status: null, parent_boq_id: null, created_at: null,
  local_lines: [
    { id: `${TEMP}:0`, item_code: "A1", description: "Flooring", unit: "m2", quantity: 10, rate: 100, amount: 1000, category: null, parent_item_code: null, breakdown_percentage: null },
    { id: `${TEMP}:1`, item_code: "A1.1", description: "Skirting", unit: "m", quantity: 5, rate: 40, amount: 200, category: null, parent_item_code: "A1", breakdown_percentage: 20 },
  ],
};
const realLine = (id: string) => ({
  id, boqId: "boq-real", boqTitle: "Villa fit-out", boqVersion: 1, boqStatus: "draft", parentLineItemId: null, activityId: null, itemCode: "A1", category: null,
  description: "Flooring", unit: "m2", quantity: "10", rate: "100", amount: "1000", createdAt: "2026-10-01T00:00:00Z",
});

async function seed(idb: IDBFactory, opts: { temp?: boolean; boqsDone?: boolean; linesDone?: boolean; realLines?: boolean } = {}) {
  const db = await openLocalDb(idb, localDbNameFor("u1"));
  await db.setMeta(MANIFEST_KEY, { userId: "u1", orgId: "orgA", projectIds: ["p1"], kinds: [BOQ_LINES_KIND], at: 1 });
  const puts: Parameters<Awaited<ReturnType<typeof openLocalDb>>["putRecords"]>[0] = [];
  if (opts.temp !== false) puts.push({ id: `${BOQS_KIND}:${TEMP}`, type: BOQS_KIND, orgId: "orgA", projectId: "p1", data: tempRow, updatedAt: 1 });
  if (opts.realLines) puts.push({ id: `${BOQ_LINES_KIND}:r1`, type: BOQ_LINES_KIND, orgId: "orgA", projectId: "p1", data: realLine("r1"), updatedAt: 1 });
  await db.putRecords(puts);
  if (opts.linesDone !== false) await db.setMeta(doneKey("p1", BOQ_LINES_KIND), { at: 1, redacted: false, hiddenFields: [] });
  if (opts.boqsDone) await db.setMeta(doneKey("p1", BOQS_KIND), { at: 1, redacted: false, hiddenFields: [] });
  db.close();
}
const shellData = (idb: IDBFactory): ShellData => ({ userId: "u1", name: "Asha", email: "a@x.test", role: "pm", orgId: "orgA", idb, projects: [{ id: "p1", name: "Cedar" }] });

describe("a BOQ saved on the laptop is readable at once, whatever the laptop's copy of the BOQ headers looks like", () => {
  test("the temporary BOQ opens as 'waiting' with its nested sub-task even though the boqs kind was never pulled to the end", async () => {
    const idb = new IDBFactory();
    await seed(idb, { boqsDone: false });
    const result = await loadScopeObject(shellData(idb), TEMP, "p1");
    if (result.state !== "waiting") throw new Error(`expected waiting, got ${result.state}`);
    expect(result.waiting.title).toBe("Villa fit-out");
    expect(result.waiting.lines.map((l) => [l.itemCode, l.parentItemCode])).toEqual([["A1", null], ["A1.1", "A1"]]);
  });

  test("the list shows it too, marked waiting", async () => {
    const idb = new IDBFactory();
    await seed(idb, { boqsDone: false });
    const result = await loadScopeList(shellData(idb), "p1");
    if (result.state !== "local") throw new Error("unreachable");
    expect(result.rows).toEqual([expect.objectContaining({ id: TEMP, waiting: true, status: "waiting", lineCount: 2 })]);
  });
});

describe("after the server accepts it, the temporary address still leads to the BOQ", () => {
  test("alias + the real lines on the laptop: the real BOQ opens", async () => {
    const idb = new IDBFactory();
    await seed(idb, { temp: false, realLines: true });
    await rememberBoqAlias(shellData(idb), TEMP, "boq-real");
    const result = await loadScopeObject(shellData(idb), TEMP, "p1");
    if (result.state !== "local") throw new Error(`expected local, got ${result.state}`);
    expect(result.boq.id).toBe("boq-real");
  });

  test("alias but the real lines are not copied back yet: a calm 'sent' state, never 'not in the copy'", async () => {
    const idb = new IDBFactory();
    await seed(idb, { temp: false });
    await rememberBoqAlias(shellData(idb), TEMP, "boq-real");
    expect(await loadScopeObject(shellData(idb), TEMP, "p1")).toEqual({ state: "sent", projectId: "p1" });
  });

  test("a temporary id nobody ever heard of is still 'not_found'", async () => {
    const idb = new IDBFactory();
    await seed(idb, { temp: false });
    expect(await loadScopeObject(shellData(idb), "local-zzz", "p1")).toEqual({ state: "not_found", projectId: "p1" });
  });
});
