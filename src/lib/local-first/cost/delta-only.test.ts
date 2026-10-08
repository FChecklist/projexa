import { describe, expect, test } from "bun:test";
import { RECOPY_LOG_KEY, type RecopyEntry } from "../replica-class";
import { resetLocalCopy } from "../peer/reset-copy";
import { DAY, MINUTE, colleagueEdit, createLaptop, createWorld } from "./harness";

// DELTA-ONLY, path 2 (docs/local-first/DELTA_ONLY.md): the data pull from Supabase after the first copy, on the REAL replica / scheduler /
// server step against the fake sync server. The delta scenario itself (one edit, one row) is cost-budget.test.ts (f).
// Run: bun test --isolate src/lib/local-first/cost/delta-only.test.ts

async function syncedLaptop() {
  const world = createWorld({ requestsPerMinute: Number.MAX_SAFE_INTEGER });
  const a = createLaptop(world, { userId: "u1" });
  await a.prepare();
  const firstCopyBodies = a.wire.rowBodies;
  a.resetCounts();
  return { world, a, firstCopyBodies };
}

describe("after the first copy the server is asked for changes, never for the data again", () => {
  test("8 days open and idle: every daily whole sync moves NO row body; nothing is re-copied", async () => {
    const { world, a, firstCopyBodies } = await syncedLaptop();
    expect(firstCopyBodies).toBeGreaterThanOrEqual(5 * 28);
    await a.open();
    a.resetCounts();
    await world.clock.advance(8 * DAY);
    a.stop();
    expect(a.wire.rowBodies).toBe(0); // eight days, eight whole syncs, one weekly id check: not one record body
    expect(a.counts.pull ?? 0).toBe(0);
    expect(a.counts.pull_ids ?? 0).toBe(0);
  }, 600_000);

  test("a change in ONE project: only that row is fetched; the four unchanged projects cost no row body and no feed read", async () => {
    const { world, a } = await syncedLaptop();
    await a.open();
    a.resetCounts();
    colleagueEdit(world, 2); // project p3
    await world.clock.advance(15 * MINUTE);
    a.stop();
    expect(a.wire.rowBodies).toBe(1);
    expect(a.counts.pull ?? 0).toBe(0);
    expect(a.counts.changes).toBe(1); // exactly one project's feed was read
    expect(a.counts.ids ?? 0).toBe(0);
  }, 120_000);

  test("the reconciliation of deletes (/ids) lists ids and carries no row body", async () => {
    const { world, a } = await syncedLaptop();
    const { server } = world;
    // a row deleted on the server without a feed entry is what the id check exists for; here we only measure what the check costs
    await a.replica.syncProject("p1", "tasks");
    a.resetCounts();
    await world.clock.advance(1 * MINUTE);
    const r = await a.replica.sync(); // a whole run: the reconcile stamps are young after the first copy, so this stays cheap
    expect(r.status).toBe("done");
    expect(a.wire.rowBodies).toBe(0);
    void server;
  }, 120_000);
});

describe("the documented full re-copies are rare and always logged on the laptop", () => {
  test("a changed role / restored server (resetLocalCopy) re-copies once, and the laptop's log says why", async () => {
    const { world, a, firstCopyBodies } = await syncedLaptop();
    const d = await a.db();
    expect(await d.getMeta(RECOPY_LOG_KEY)).toBeFalsy(); // nothing before: a normal first copy is not a re-copy
    await resetLocalCopy(d);
    const log = (await d.getMeta<RecopyEntry[]>(RECOPY_LOG_KEY)) ?? [];
    expect(log.length).toBe(world.projects.length);
    expect(log.every((e) => e.reason === "heads_view_class_or_epoch" && e.removed > 0)).toBe(true);
    a.resetCounts();
    await a.prepare();
    expect(a.wire.rowBodies).toBeGreaterThanOrEqual(firstCopyBodies); // this is the documented exception: the copy is made again
    a.stop();
  }, 300_000);
});
