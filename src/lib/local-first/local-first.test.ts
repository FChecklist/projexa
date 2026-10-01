import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { openLocalDb } from "./local-db";
import {
  formatCountdown,
  prepareWorkspace,
  readyKey,
  type PrepareProgress,
  type PrepareStep,
} from "./prepare-workspace";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function step(id: PrepareStep["id"], weight: number, run: PrepareStep["run"]): PrepareStep {
  return { id, label: id, weight, run };
}

describe("local database (the laptop's own copy)", () => {
  test("keeps meta and records across a close and reopen", async () => {
    const idb = new IDBFactory();
    const a = await openLocalDb(idb, "t1");
    await a.setMeta("workspace", { userId: "u1" });
    await a.putRecord({ id: "boq:1", type: "boq", orgId: "orgA", projectId: "p1", data: { qty: 5 } });
    a.close();
    const b = await openLocalDb(idb, "t1");
    expect(await b.getMeta("workspace")).toEqual({ userId: "u1" });
    expect((await b.getRecord("boq", "1"))?.data).toEqual({ qty: 5 });
    b.close();
  });

  test("bumps the revision on every local write", async () => {
    const db = await openLocalDb(new IDBFactory(), "t2");
    const first = await db.putRecord({ id: "boq:1", type: "boq", orgId: "orgA", projectId: null, data: 1 });
    const second = await db.putRecord({ id: "boq:1", type: "boq", orgId: "orgA", projectId: null, data: 2 });
    expect([first.rev, second.rev]).toEqual([1, 2]);
    db.close();
  });

  test("lists only one organisation's records and refuses to mix tenants", async () => {
    const db = await openLocalDb(new IDBFactory(), "t3");
    await db.putRecord({ id: "boq:1", type: "boq", orgId: "orgA", projectId: null, data: "a" });
    await db.putRecord({ id: "boq:2", type: "boq", orgId: "orgB", projectId: null, data: "b" });
    expect((await db.listByOrg("orgA")).map((r) => r.id)).toEqual(["boq:1"]);
    expect(await db.countRecords("orgB")).toBe(1);
    await expect(
      db.putRecord({ id: "boq:1", type: "boq", orgId: "orgB", projectId: null, data: "stolen" })
    ).rejects.toThrow(/different organisation/);
    expect((await db.getRecord("boq", "1"))?.data).toBe("a");
    db.close();
  });
});

describe("prepareWorkspace (real progress, 3 minute ceiling)", () => {
  test("finishes early when the work is done, at 100% and ready", async () => {
    const seen: PrepareProgress[] = [];
    const result = await prepareWorkspace({
      steps: [step("worker", 20, async () => {}), step("app", 60, async () => {}), step("database", 20, async () => {})],
      onProgress: (p) => seen.push(p),
    });
    expect(result.ready).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(seen.at(-1)!.percent).toBe(100);
    expect(seen.at(-1)!.finished).toBe(true);
    expect(seen.map((p) => p.percent)).toEqual([...seen.map((p) => p.percent)].sort((a, b) => a - b)); // never goes backwards
  });

  test("a step's own detail moves the bar, it is not a fake timer", async () => {
    const seen: number[] = [];
    await prepareWorkspace({
      steps: [step("app", 100, async ({ onDetail }) => { onDetail(1, 4); onDetail(2, 4); })],
      onProgress: (p) => seen.push(p.percent),
    });
    expect(seen).toContain(25);
    expect(seen).toContain(50);
  });

  test("a failing step does not block the others, and the laptop is not marked ready", async () => {
    const result = await prepareWorkspace({
      steps: [
        step("worker", 20, async () => { throw new Error("no service worker"); }),
        step("database", 80, async () => {}),
      ],
      onProgress: () => {},
    });
    expect(result.failed).toEqual(["worker"]);
    expect(result.ready).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  test("a slow step is cut at the ceiling, the person is let through and it is not marked ready", async () => {
    const seen: PrepareProgress[] = [];
    const result = await prepareWorkspace({
      budgetMs: 40,
      steps: [step("app", 100, ({ signal }) => new Promise<void>((resolve) => { signal.addEventListener("abort", () => resolve()); }))],
      onProgress: (p) => seen.push(p),
    });
    expect(result.timedOut).toBe(true);
    expect(result.ready).toBe(false);
    expect(seen.at(-1)!.steps[0]!.state).toBe("skipped");
    expect(seen.at(-1)!.percent).toBeLessThan(100);
  });

  test("steps after a timeout are skipped, not run", async () => {
    let ran = false;
    await prepareWorkspace({
      budgetMs: 20,
      steps: [
        step("app", 50, async () => { await sleep(60); }),
        step("database", 50, async () => { ran = true; }),
      ],
      onProgress: () => {},
    });
    await sleep(80);
    expect(ran).toBe(false);
  });
});

describe("helpers", () => {
  test("countdown reads as minutes and seconds", () => {
    expect(formatCountdown(180_000)).toBe("3:00");
    expect(formatCountdown(61_000)).toBe("1:01");
    expect(formatCountdown(0)).toBe("0:00");
  });

  test("the ready flag is per person, so two people on one laptop are prepared separately", () => {
    expect(readyKey("u1")).not.toBe(readyKey("u2"));
  });
});
