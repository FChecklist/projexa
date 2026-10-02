import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY, doneKey } from "../../replica";
import { BOQ_LINES_KIND } from "../../boq-local";
import type { ShellData } from "../context";
import type { PendingEdit } from "../pending-edits";
import { groupBoqs, loadScopeList, loadScopeObject } from "./scope-adapter";

function line(id: string, boqId: string, over: Record<string, unknown> = {}) {
  return {
    id, boqId, boqTitle: boqId === "boqA" ? "Tower A" : "Tower B", boqVersion: boqId === "boqA" ? 2 : 1, boqStatus: boqId === "boqA" ? "approved" : "draft",
    parentLineItemId: null, activityId: null, itemCode: `C${id}`, category: null, description: `line ${id}`, unit: "m3", quantity: "2", rate: "10", amount: "20",
    createdAt: `2026-01-0${id}T00:00:00Z`, ...over,
  };
}

async function seed(idb: IDBFactory, opts: { doneP1?: boolean; doneP2?: boolean } = {}) {
  const db = await openLocalDb(idb, localDbNameFor("u1"));
  await db.setMeta(MANIFEST_KEY, { userId: "u1", orgId: "orgA", projectIds: ["p1", "p2"], kinds: [BOQ_LINES_KIND], at: 1 });
  const rows = [
    { projectId: "p1", data: line("1", "boqA") },
    { projectId: "p1", data: line("2", "boqA", { parentLineItemId: "1", amount: "5" }) },
    { projectId: "p1", data: line("3", "boqB") },
    { projectId: "p1", data: { id: "junk" } },
    { projectId: "p2", data: line("7", "boqC", { boqTitle: "Annexe", boqVersion: 1, boqStatus: "draft" }) },
  ];
  await db.putRecords(rows.map((r) => ({ id: `${BOQ_LINES_KIND}:${(r.data as { id: string }).id}`, type: BOQ_LINES_KIND, orgId: "orgA", projectId: r.projectId, data: r.data, updatedAt: 1 })));
  if (opts.doneP1 !== false) await db.setMeta(doneKey("p1", BOQ_LINES_KIND), { at: 1_760_000_000_000, redacted: false, hiddenFields: [] });
  if (opts.doneP2 === true) await db.setMeta(doneKey("p2", BOQ_LINES_KIND), { at: 1_760_000_100_000, redacted: false, hiddenFields: [] });
  db.close();
}

const shellData = (idb: IDBFactory): ShellData => ({
  userId: "u1", name: "Asha", email: "a@x.test", role: "pm", orgId: "orgA", idb,
  projects: [{ id: "p1", name: "Cedar Heights" }, { id: "p2", name: "Annexe Works" }],
});

describe("the BOQ list, read from the laptop", () => {
  test("a synced project's BOQs are derived from its lines: one row per BOQ with its lines and total (children are inside their parent's amount)", async () => {
    const idb = new IDBFactory();
    await seed(idb);
    const result = await loadScopeList(shellData(idb), "p1");
    expect(result.state).toBe("local");
    if (result.state !== "local") throw new Error("unreachable");
    expect(result.syncedAt).toBe(1_760_000_000_000);
    expect(result.rows).toEqual([
      { id: "boqA", title: "Tower A", version: 2, status: "approved", lineCount: 2, total: 20 }, // 20 + a child's 5 is NOT added: sub-tasks are contained in their parent
      { id: "boqB", title: "Tower B", version: 1, status: "draft", lineCount: 1, total: 20 },
    ]);
  });

  test("a project that has not been copied to the end is 'not_synced', never a partial list", async () => {
    const idb = new IDBFactory();
    await seed(idb);
    expect(await loadScopeList(shellData(idb), "p2")).toEqual({ state: "not_synced", projectId: "p2" });
  });

  test("no project selected, or a person with nothing on the laptop", async () => {
    expect(await loadScopeList(shellData(new IDBFactory()), null)).toEqual({ state: "no_project" });
    expect(await loadScopeList(shellData(new IDBFactory()), "p1")).toEqual({ state: "not_synced", projectId: "p1" });
  });

  test("rows that do not look like a BOQ line are skipped (the replica's rows are untrusted input)", async () => {
    const idb = new IDBFactory();
    await seed(idb);
    const result = await loadScopeList(shellData(idb), "p1");
    if (result.state !== "local") throw new Error("unreachable");
    expect(result.rows.flatMap((r) => r.id)).not.toContain("junk");
  });

  test("groupBoqs sorts by title then newest revision first", () => {
    const rows = groupBoqs([line("1", "boqA", { boqTitle: "B", boqVersion: 1 }), line("2", "boqX", { boqTitle: "B", boqVersion: 3 }), line("3", "boqY", { boqTitle: "A", boqVersion: 1 })] as never);
    expect(rows.map((r) => `${r.title}${r.version}`)).toEqual(["A1", "B3", "B1"]);
  });
});

describe("one BOQ, read from the laptop", () => {
  test("its own lines only, parents before children, header from the rows", async () => {
    const idb = new IDBFactory();
    await seed(idb);
    const result = await loadScopeObject(shellData(idb), "boqA", "p1");
    if (result.state !== "local") throw new Error(`expected local, got ${result.state}`);
    expect(result.boq).toMatchObject({ id: "boqA", projectId: "p1", title: "Tower A", version: 2, status: "approved" });
    expect(result.lines.map((l) => l.id)).toEqual(["1", "2"]);
    expect(result.total).toBe(20);
    expect(result.waitingLineIds).toEqual([]);
  });

  test("with no project in the URL, the person's projects are searched until one has the BOQ", async () => {
    const idb = new IDBFactory();
    await seed(idb, { doneP2: true });
    const result = await loadScopeObject(shellData(idb), "boqC", null);
    if (result.state !== "local") throw new Error(`expected local, got ${result.state}`);
    expect(result.boq.projectId).toBe("p2");
    expect(result.lines.map((l) => l.id)).toEqual(["7"]);
  });

  test("a BOQ that is in no synced project is 'not_found'; when nothing is synced at all it is 'not_synced'", async () => {
    const idb = new IDBFactory();
    await seed(idb);
    expect(await loadScopeObject(shellData(idb), "nope", "p1")).toEqual({ state: "not_found", projectId: "p1" });
    expect(await loadScopeObject(shellData(idb), "boqC", "p2")).toEqual({ state: "not_synced", projectId: "p2" });
    expect((await loadScopeObject(shellData(new IDBFactory()), "boqA", null)).state).toBe("not_synced");
    expect(await loadScopeObject({ ...shellData(idb), projects: [] }, "boqA", null)).toEqual({ state: "no_project" });
  });

  test("another BOQ of the same project never leaks into this one", async () => {
    const idb = new IDBFactory();
    await seed(idb);
    const result = await loadScopeObject(shellData(idb), "boqB", "p1");
    if (result.state !== "local") throw new Error("unreachable");
    expect(result.lines.map((l) => l.id)).toEqual(["3"]);
  });

  test("the person's waiting category edits are laid over the rows and flagged, for THIS BOQ only", async () => {
    const idb = new IDBFactory();
    await seed(idb);
    const edits: PendingEdit[] = [
      { id: "e1", lineId: "2", boqId: "boqA", projectId: "p1", patch: { category: "Steel" }, at: 1, attempts: 0 },
      { id: "e2", lineId: "3", boqId: "boqB", projectId: "p1", patch: { category: "Other" }, at: 1, attempts: 0 },
    ];
    const result = await loadScopeObject(shellData(idb), "boqA", "p1", edits);
    if (result.state !== "local") throw new Error("unreachable");
    expect(result.lines.find((l) => l.id === "2")!.category).toBe("Steel");
    expect(result.lines.find((l) => l.id === "1")!.category).toBeNull();
    expect(result.waitingLineIds).toEqual(["2"]);
  });

  test("it reads ONLY this person's database: another person's copy of the same project is never used", async () => {
    const idb = new IDBFactory();
    await seed(idb);
    const other: ShellData = { ...shellData(idb), userId: "u2" };
    expect((await loadScopeObject(other, "boqA", "p1")).state).toBe("not_synced");
  });
});
