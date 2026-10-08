import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer } from "../__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "../local-db";
import { createReplica } from "../replica";
import { activeProjectFor, noteShownProject, selectedProjectKey } from "../shell/context";
import { createAutoSync } from "./auto-sync";
import { DEFAULTS, type SchedulerClock } from "./scheduler";
import { createServerStep } from "./server-step";

// AUDIT-100 B7 (a colleague's change lands on a second laptop) and B28 (back online, sync resumes without a refresh), WITHOUT the real
// backend: laptop B's whole auto-sync assembly as the browser wires it (peer-shared.ts) -- the REAL replica, sync client, server step
// (heads mode), scheduler and auto-sync -- against the shared fake sync service, under a fake clock. The service's head moves AFTER the
// laptop's first copy, and the laptop must pick every later change up within the documented interval (scheduler.ts header: the next
// timer run, 5 minutes while things change; at once when the network comes back), with no reload and no button.
//
// THE BUG IT PINS (measured against the real backend in e2e/audit37-real-b7-writeback.spec.ts, 4 of 5 runs): the server step reads a
// moved project's feed at once only for the OPEN project and at most hourly for the others; "open" came from the switcher's remembered
// choice only, so a person who never picked a project (the shell shows the first one, or the URL's) had none open. The FIRST later
// change still arrived (that project had never been read by the step), every one after it waited up to an hour, and an `online` trigger
// could not help. The fix: the shell notes the project it SHOWS (shell/context.ts noteShownProject / activeProjectFor).

const MIN = 60_000;
const tick = () => new Promise<void>((r) => setTimeout(r, 2));
/** Lets real async work (fake IndexedDB, the fake service) settle until `done` holds; never a fixed sleep. */
async function settle(done: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await tick();
  for (let i = 0; i < 5; i++) await tick();
}

function fakeClock(start: number) {
  let t = start;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: SchedulerClock = {
    now: () => t,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeout: (h) => { timers.delete(h as number); },
  };
  return {
    clock,
    pending: () => timers.size,
    now: () => t,
    async advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        t = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
        // a run ends by scheduling the next one: wait for that, so the run's real async work has finished
        await settle(() => timers.size > 0);
      }
      t = end;
      await settle(() => true);
    },
  };
}

const USER = "u1";
const stops: Array<() => void> = [];
afterEach(() => { while (stops.length) stops.pop()!(); noteShownProject(USER, null); });

/** Laptop B: first copy done (WorkspacePrepare), then the browser's auto-sync assembly started, the shell showing `shown`. */
async function laptopB(o: { projects: string[]; shown: string | null; remembered?: string | null }) {
  const fc = fakeClock(Date.parse("2026-10-05T09:00:00Z"));
  const idb = new IDBFactory();
  const server = createFakeSyncServer({ projects: [...o.projects], userId: USER });
  for (const p of o.projects) for (let i = 0; i < 2; i += 1) server.upsert({ kind: "rfis", projectId: p, id: `${p}-r${i}`, data: { subject: `RFI ${i}` } });
  const replica = createReplica({ userId: USER, client: server.client, idb, yieldFn: async () => {}, pacer: null, now: fc.now });
  expect((await replica.sync()).status).toBe("done"); // the first copy
  const db = await openLocalDb(idb, localDbNameFor(USER));
  noteShownProject(USER, o.shown); // what LocalShell does with chooseProject's answer
  const storage = { getItem: (k: string) => (k === selectedProjectKey(USER) ? o.remembered ?? null : null) };
  const env = { online: true };
  let redraws = 0;
  const auto = createAutoSync({
    userId: USER, selfId: "laptop-b", random: () => 0.5, db, fetchAttest: async () => { throw new Error("no peers in this test"); },
    remoteProviders: [], openLink: () => { throw new Error("no peers in this test"); },
    serverStep: createServerStep({
      meta: db, changes: (r) => server.client.changes(r), sync: () => replica.sync(),
      syncProject: (projectId, opts) => replica.syncProject(projectId, undefined, undefined, opts),
      heads: () => server.client.heads!(),
      feedCurrent: (projectId) => replica.noteFeedCurrent?.(projectId),
      activeProject: () => activeProjectFor(USER, storage), // exactly the resolver peer-shared.ts wires
      now: fc.now,
    }),
    isVisible: () => true, isOnline: () => env.online, clock: fc.clock, locks: null, now: fc.now,
    onChanged: () => { redraws += 1; },
  });
  stops.push(() => { auto.stop(); db.close(); });
  await settle(() => fc.pending() > 0); // attestation (none) -> the scheduler starts: the "open" run, which ends by scheduling the next
  const subject = async (id: string) => ((await db.getRecord("rfis", id))?.data as { subject?: string } | undefined)?.subject ?? null;
  return { fc, server, env, auto, subject, redraws: () => redraws };
}

setDefaultTimeout(60_000);

describe("B7: an idle colleague laptop picks up EVERY later change of the project it shows, within the documented interval", () => {
  test("one project, shown but never picked: a new RFI, then an update of a row it holds, then another new RFI -- each by the next timer run", async () => {
    const B = await laptopB({ projects: ["p1"], shown: "p1" });
    expect(B.auto.scheduler.runs).toBe(1);

    // 1) a colleague's NEW RFI, one minute after the open run
    await B.fc.advance(1 * MIN);
    B.server.upsert({ kind: "rfis", projectId: "p1", id: "p1-new1", data: { subject: "Sprinkler drops" } });
    await B.fc.advance(DEFAULTS.baseMs - 1 * MIN); // the idle laptop's next timer run: 5 minutes after the open run
    expect(await B.subject("p1-new1")).toBe("Sprinkler drops");
    expect(B.redraws()).toBe(1);

    // 2) an UPDATE of a row the laptop already holds (the answer), two minutes later -- the case that waited an hour before the fix
    await B.fc.advance(2 * MIN);
    B.server.upsert({ kind: "rfis", projectId: "p1", id: "p1-r0", data: { subject: "RFI 0 - answered" } });
    await B.fc.advance(DEFAULTS.baseMs - 2 * MIN); // a run that brought rows keeps the 5-minute rhythm
    expect(await B.subject("p1-r0")).toBe("RFI 0 - answered");
    expect(B.redraws()).toBe(2);

    // 3) a second new RFI
    B.server.upsert({ kind: "rfis", projectId: "p1", id: "p1-new2", data: { subject: "Door schedule" } });
    await B.fc.advance(DEFAULTS.baseMs);
    expect(await B.subject("p1-new2")).toBe("Door schedule");
    expect(B.redraws()).toBe(3);
  });

  test("two projects, the shell shows the FIRST (dashboard at /local/, nothing picked): its changes arrive every run; the other's within the hour", async () => {
    const B = await laptopB({ projects: ["p1", "p2"], shown: "p1" });
    for (const [i, delay] of [[1, DEFAULTS.baseMs], [2, DEFAULTS.baseMs], [3, DEFAULTS.baseMs]] as const) {
      B.server.upsert({ kind: "rfis", projectId: "p1", id: "p1-r1", data: { subject: `change ${i}` } });
      await B.fc.advance(delay);
      expect(await B.subject("p1-r1")).toBe(`change ${i}`);
    }
    // a project NOT open: FRESHNESS (2026-10-08) -- /heads says it moved, so it is read within one poll. (Was: at most hourly, never lost
    B.server.upsert({ kind: "rfis", projectId: "p2", id: "p2-r1", data: { subject: "elsewhere" } });
    await B.fc.advance(DEFAULTS.baseMs);
    expect(await B.subject("p2-r1")).toBe("elsewhere");
  });

  test("the remembered switcher choice still counts when the shell shows nothing yet", async () => {
    const B = await laptopB({ projects: ["p1", "p2"], shown: null, remembered: "p2" });
    B.server.upsert({ kind: "rfis", projectId: "p2", id: "p2-r0", data: { subject: "first" } });
    await B.fc.advance(DEFAULTS.baseMs);
    B.server.upsert({ kind: "rfis", projectId: "p2", id: "p2-r0", data: { subject: "second" } });
    await B.fc.advance(DEFAULTS.baseMs);
    expect(await B.subject("p2-r0")).toBe("second");
  });
});

describe("B28: back online, the laptop catches up by itself, without a refresh", () => {
  test("the network drops right after a run and comes back 20 s later: what changed meanwhile arrives within the minimum gap, not 5-30 minutes later", async () => {
    const B = await laptopB({ projects: ["p1"], shown: "p1" });
    B.server.upsert({ kind: "rfis", projectId: "p1", id: "p1-new1", data: { subject: "before the drop" } });
    await B.fc.advance(DEFAULTS.baseMs); // a run that brought rows
    expect(await B.subject("p1-new1")).toBe("before the drop");
    B.env.online = false;
    await B.fc.advance(10_000);
    B.server.upsert({ kind: "rfis", projectId: "p1", id: "p1-r1", data: { subject: "changed while B was offline" } });
    await B.fc.advance(10_000);
    B.env.online = true;
    void B.auto.scheduler.trigger("online"); // the browser's `online` event (peer-shared.ts)
    await B.fc.advance(DEFAULTS.minGapMs);
    expect(await B.subject("p1-r1")).toBe("changed while B was offline");
    expect(B.redraws()).toBe(2);
  });
});
