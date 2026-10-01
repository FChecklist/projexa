import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "./local-db";
import { MANIFEST_KEY, doneKey } from "./replica";
import { LOCAL_FIRST_FLAG } from "./local-reader";
import { BOQ_LINES_KIND, isGatewayLine, loadBoqFromReplica, rememberBoq, revalidateBoq } from "./boq-local";
import type { Boq } from "@/lib/boq-helpers";

const header: Boq = { id: "boq1", projectId: "p1", version: 1, title: "Old title", status: "draft", parentBoqId: null, createdAt: "2026-01-01T00:00:00Z" };

function line(id: string, boqId: string, over: Record<string, unknown> = {}) {
  return {
    id, boqId, boqTitle: boqId === "boq1" ? "Tower A" : "Tower B", boqVersion: 2, boqStatus: "approved", parentLineItemId: null, activityId: null,
    itemCode: `C${id}`, category: null, description: `line ${id}`, unit: "m3", quantity: "2", rate: "10", amount: "20", createdAt: `2026-01-0${id}T00:00:00Z`, ...over,
  };
}

async function seed(idb: IDBFactory, done = true) {
  const db = await openLocalDb(idb, localDbNameFor("u1"));
  await db.setMeta(MANIFEST_KEY, { userId: "u1", orgId: "orgA", projectIds: ["p1"], kinds: [BOQ_LINES_KIND], at: 1 });
  const all = [line("1", "boq1"), line("2", "boq1", { parentLineItemId: "1" }), line("3", "boq2"), { id: "junk" }];
  await db.putRecords(all.map((d) => ({ id: `${BOQ_LINES_KIND}:${d.id}`, type: BOQ_LINES_KIND, orgId: "orgA", projectId: "p1", data: d, updatedAt: 1 })));
  if (done) await db.setMeta(doneKey("p1", BOQ_LINES_KIND), { at: 1_760_000_000_000, redacted: false, hiddenFields: [] });
  db.close();
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { localStorage.clear(); });

describe("BOQ screen, read from the laptop (behind px-local-first)", () => {
  test("flag off (the default): nothing is remembered and the replica is not consulted", async () => {
    const idb = new IDBFactory();
    await seed(idb);
    rememberBoq(header);
    expect(localStorage.getItem("px-local-first-boq:boq1")).toBeNull();
    localStorage.setItem("px-local-first-boq:boq1", JSON.stringify(header)); // even with a hint present
    expect(await loadBoqFromReplica("boq1", { userId: "u1", idb })).toBeNull();
  });

  test("only the exact text 1 turns the flag on", async () => {
    const idb = new IDBFactory();
    await seed(idb);
    localStorage.setItem(LOCAL_FIRST_FLAG, "true");
    rememberBoq(header);
    expect(await loadBoqFromReplica("boq1", { userId: "u1", idb })).toBeNull();
  });

  test("flag on, BOQ opened here before, project synced: this BOQ's lines (not another BOQ's) come from the replica", async () => {
    const idb = new IDBFactory();
    await seed(idb);
    localStorage.setItem(LOCAL_FIRST_FLAG, "1");
    rememberBoq(header);
    const load = await loadBoqFromReplica("boq1", { userId: "u1", idb });
    expect(load).not.toBeNull();
    expect(load!.source).toBe("local-replica");
    expect(load!.lines.map((l) => l.id)).toEqual(["1", "2"]); // parent before child, boq2's line and the junk row left out
    expect(load!.boq).toMatchObject({ id: "boq1", projectId: "p1", title: "Tower A", version: 2, status: "approved" }); // fresh fields from the rows
    expect(load!.lines[0]).not.toHaveProperty("boqId");
  });

  test("a BOQ never opened on this laptop, or a project not synced to the end, falls back (null)", async () => {
    const idb = new IDBFactory();
    await seed(idb, false);
    localStorage.setItem(LOCAL_FIRST_FLAG, "1");
    expect(await loadBoqFromReplica("boq1", { userId: "u1", idb })).toBeNull(); // no hint yet
    rememberBoq(header);
    expect(await loadBoqFromReplica("boq1", { userId: "u1", idb })).toBeNull(); // hint, but the copy is incomplete
  });

  test("a damaged hint is ignored", async () => {
    const idb = new IDBFactory();
    await seed(idb);
    localStorage.setItem(LOCAL_FIRST_FLAG, "1");
    localStorage.setItem("px-local-first-boq:boq1", "{not json");
    expect(await loadBoqFromReplica("boq1", { userId: "u1", idb })).toBeNull();
  });

  test("rows that are not lines of a BOQ are not trusted", () => {
    expect(isGatewayLine(line("1", "boq1"))).toBe(true);
    expect(isGatewayLine({ id: "x" })).toBe(false);
    expect(isGatewayLine(null)).toBe(false);
    expect(isGatewayLine({ ...line("1", "boq1"), quantity: 5 })).toBe(false);
  });

  test("revalidation runs only with the flag on and asks for this project's boq_lines", async () => {
    const seen: unknown[] = [];
    await revalidateBoq(header, async (ctx) => { seen.push(ctx); }, "u1");
    expect(seen).toEqual([]);
    localStorage.setItem(LOCAL_FIRST_FLAG, "1");
    await revalidateBoq(header, async (ctx) => { seen.push(ctx); }, "u1");
    expect(seen).toEqual([{ kind: "boq_lines", projectId: "p1", userId: "u1" }]);
    await revalidateBoq(header, async () => { throw new Error("service down"); }, "u1"); // best effort: never throws
  });
});
