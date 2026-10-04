import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { MANIFEST_KEY, doneKey } from "../../replica";
import { BOQS_KIND, BOQ_LINES_KIND, linesFromReplica, loadBoqFromReplica, rememberBoq, toGatewayLine } from "../../boq-local";
import type { ShellData } from "../context";
import { loadScopeList, loadScopeObject } from "./scope-adapter";
import golden from "../../__fixtures__/real-sync-rows.json";

// LOCAL-FIRST review F09: the BOQ readers were written for the BOQ GATEWAY's shape (boqId, boqTitle, quantity as a string ...), but the
// sync service sends the AI work link's record shape (boq_id, item_code, quantity as a number, no title: that is the `boqs` kind), so
// every real row was filtered out and the screen silently fell back to the server. These tests are fed rows the REAL handler produced:
// __fixtures__/real-sync-rows.json is captured by conformance/wire.integration.test.ts (W18b, LF_WRITE_GOLDEN=1), which also asserts on
// every run against the real backend that the captured key sets are still what the handler sends.

type Row = Record<string, unknown>;
const realBoqs = golden.boqs as Row[];
const realLines = golden.boq_lines as Row[];

async function seed(idb: IDBFactory, opts: { lines?: Row[]; boqs?: Row[] | null; user?: string } = {}) {
  const db = await openLocalDb(idb, localDbNameFor(opts.user ?? "u1"));
  await db.setMeta(MANIFEST_KEY, { userId: opts.user ?? "u1", orgId: "org-a", projectIds: ["proj-a"], kinds: [BOQ_LINES_KIND, BOQS_KIND], at: 1 });
  const put = (kind: string, rows: Row[]) =>
    db.putRecords(rows.map((data) => ({ id: `${kind}:${String(data.id)}`, type: kind, orgId: "org-a", projectId: "proj-a", data, updatedAt: 1 })));
  await put(BOQ_LINES_KIND, opts.lines ?? realLines);
  await db.setMeta(doneKey("proj-a", BOQ_LINES_KIND), { at: 1_760_000_000_000, redacted: false, hiddenFields: [] });
  if (opts.boqs !== null) {
    await put(BOQS_KIND, opts.boqs ?? realBoqs);
    await db.setMeta(doneKey("proj-a", BOQS_KIND), { at: 1_760_000_000_000, redacted: false, hiddenFields: [] });
  }
  db.close();
}

const shell = (idb: IDBFactory, userId = "u1"): ShellData => ({ userId, name: "Asha", email: "a@x.test", role: "pm", orgId: "org-a", idb, projects: [{ id: "proj-a", name: "Villa" }] });

describe("the scope module draws a BOQ synced from the REAL service", () => {
  test("the golden rows are the real wire shape (snake_case, numbers, no title on a line)", () => {
    expect(realLines.length).toBe(2);
    expect(typeof realLines[0]!.quantity).toBe("number");
    expect(realLines[0]).toHaveProperty("boq_id");
    expect(realLines[0]).not.toHaveProperty("boqTitle");
    expect(realBoqs[0]).toMatchObject({ id: "boq1", title: "Villa BOQ" });
  });

  test("list: one row per BOQ, title/version/status from the `boqs` row, total from the lines", async () => {
    const idb = new IDBFactory();
    await seed(idb);
    expect(await loadScopeList(shell(idb), "proj-a")).toEqual({
      state: "local", projectId: "proj-a", syncedAt: 1_760_000_000_000,
      rows: [{ id: "boq1", title: "Villa BOQ", version: 1, status: "draft", lineCount: 2, total: 54225 + 156000 }],
    });
  });

  test("object: the BOQ's lines with every drawn value as the screen's string, money exactly as sent", async () => {
    const idb = new IDBFactory();
    await seed(idb);
    const result = await loadScopeObject(shell(idb), "boq1", "proj-a");
    if (result.state !== "local") throw new Error(`expected local, got ${result.state}`);
    expect(result.boq).toMatchObject({ id: "boq1", projectId: "proj-a", title: "Villa BOQ", version: 1, status: "draft" });
    expect(result.lines.map((l) => [l.id, l.itemCode, l.description, l.unit, l.quantity, l.rate, l.amount, l.budgetPercentage])).toEqual([
      ["li1", "1.1", "Excavation", "m3", "120.5", "450", "54225", "25"],
      ["li2", "1.2", "PCC", "m3", "30", "5200", "156000", "25"], // the column's default (25) as the real row carries it
    ]);
    expect(result.total).toBe(210225);
  });

  test("nothing is invented: a line whose money is hidden (null) is not drawn as zero; a line without its BOQ's header row is not drawn", async () => {
    const hidden = realLines.map((l) => ({ ...l, rate: null, amount: null }));
    expect(linesFromReplica(hidden, realBoqs)).toEqual([]);
    for (const field of ["quantity", "rate", "amount"]) expect(linesFromReplica(realLines.map((l) => ({ ...l, [field]: null })), realBoqs)).toEqual([]);
    expect(linesFromReplica(realLines, [])).toEqual([]);
    expect(toGatewayLine(realLines[0])).toBeNull();
    const idb = new IDBFactory();
    await seed(idb, { boqs: null });
    expect(await loadScopeObject(shell(idb), "boq1", "proj-a")).toEqual({ state: "not_found", projectId: "proj-a" });
  });

  test("untrusted rows: a string that is not a number, or a missing description, is skipped", () => {
    const bad = [{ ...realLines[0], quantity: "lots" }, { ...realLines[1], description: 7 }];
    expect(linesFromReplica(bad, realBoqs)).toEqual([]);
  });

  test("another person's database contributes nothing", async () => {
    const idb = new IDBFactory();
    await seed(idb, { user: "someone-else" });
    expect(await loadScopeList(shell(idb, "u1"), "proj-a")).toEqual({ state: "not_synced", projectId: "proj-a" });
  });
});

describe("the online BOQ screen's local-first reader (ScopeObjectClient -> loadBoqFromReplica) on the real rows", () => {
  function withStorage(fn: () => Promise<void>) {
    const store = new Map<string, string>([["px-local-first", "1"]]);
    const saved = (globalThis as { localStorage?: Storage }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
    return fn().finally(() => {
      (globalThis as { localStorage?: unknown }).localStorage = saved;
    });
  }
  const remembered = { id: "boq1", projectId: "proj-a", title: "Remembered title", version: 1, status: "draft", parentBoqId: null, createdAt: "" };

  test("the synced `boqs` row's title wins over the remembered header; the lines come from the laptop", () =>
    withStorage(async () => {
      const idb = new IDBFactory();
      await seed(idb);
      rememberBoq(remembered);
      const loaded = await loadBoqFromReplica("boq1", { userId: "u1", idb });
      expect(loaded?.source).toBe("local-replica");
      expect(loaded?.boq.title).toBe("Villa BOQ");
      expect(loaded?.lines.map((l) => [l.id, l.quantity, l.amount])).toEqual([["li1", "120.5", "54225"], ["li2", "30", "156000"]]);
    }));

  test("without the `boqs` row on the laptop, the remembered header supplies title/version/status", () =>
    withStorage(async () => {
      const idb = new IDBFactory();
      await seed(idb, { boqs: null });
      rememberBoq(remembered);
      const loaded = await loadBoqFromReplica("boq1", { userId: "u1", idb });
      expect(loaded?.boq.title).toBe("Remembered title");
      expect(loaded?.lines.length).toBe(2);
    }));
});
