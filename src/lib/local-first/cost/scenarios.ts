// TEST ONLY (package lf-e6): the five named cost scenarios of the brief, run on the harness (harness.ts). Each returns what
// every laptop sent, by route; cost-budget.test.ts holds them to SCENARIO_BUDGETS and COST_MODEL.md records the numbers.
//
//   (a) idle8h          one laptop, online, tab visible, 8 hours, nothing changes anywhere
//   (b) workday         one laptop, 8 hours: 30 own edits, 30 changes by colleagues, 40 screens opened
//   (c) coldStart       a person with 5 projects opens the app on an empty database: the whole first copy, then the rest of the first hour
//   (d) reconnect3d     a synced laptop goes offline for 3 days (200 changes are made meanwhile), then reconnects: the catch-up
//   (e) tenLaptops      10 laptops of one organisation, peers connected, each a working day like (b) (their edits are each other's colleague changes)
//
// Common setting: 5 projects x 28 kinds (the backend's SYNC_KINDS), 2 rows per kind plus 10 tasks per project.

import { addCounts, type RouteCounts } from "./budget";
import { HOUR, MINUTE, colleagueEdit, createLaptop, createWorld, type LaptopOptions, type SimLaptop, type World } from "./harness";

export type ScenarioResult = {
  name: string;
  laptops: number;
  /** Sum over the laptops, divided by their number (a whole-number average per route). */
  perLaptop: RouteCounts;
  perLaptopTotal: number;
  /** Requests made while the laptop was offline (must be 0). */
  whileOffline?: number;
};

const SCREEN_KINDS = ["tasks", "boq_lines", "rfis", "progress", "documents", "punch_list", "materials", "meetings"];

function summarise(name: string, laptops: SimLaptop[], extra: Partial<ScenarioResult> = {}): ScenarioResult {
  let sum: RouteCounts = {};
  for (const l of laptops) sum = addCounts(sum, l.counts);
  const perLaptop: RouteCounts = {};
  let total = 0;
  for (const [k, v] of Object.entries(sum) as [keyof RouteCounts, number][]) {
    perLaptop[k] = Math.round((v / laptops.length) * 10) / 10;
    total += v;
  }
  return { name, laptops: laptops.length, perLaptop, perLaptopTotal: Math.round((total / laptops.length) * 10) / 10, ...extra };
}

async function synced(world: World, o: LaptopOptions = {}): Promise<SimLaptop> {
  const l = createLaptop(world, o);
  await l.prepare();
  l.resetCounts();
  return l;
}

/** Runs timed events in order on the shared clock. */
async function timeline(world: World, events: { at: number; run: () => Promise<void> | void }[], until: number): Promise<void> {
  const start = world.clock.now();
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    const wait = start + e.at - world.clock.now();
    if (wait > 0) await world.clock.advance(wait);
    await e.run();
  }
  const rest = start + until - world.clock.now();
  if (rest > 0) await world.clock.advance(rest);
}

/** One person's working day: an own edit every 16 minutes, a screen opened every 12 minutes (rotating kinds). */
function workdayEvents(l: SimLaptop, world: World, offsetMs = 0, project = world.projects[0]): { at: number; run: () => Promise<void> }[] {
  const events: { at: number; run: () => Promise<void> }[] = [];
  for (let i = 0; i < 30; i += 1) events.push({ at: offsetMs + 5 * MINUTE + i * 16 * MINUTE, run: () => l.edit(i) });
  for (let i = 0; i < 40; i += 1) events.push({ at: offsetMs + 2 * MINUTE + i * 12 * MINUTE, run: () => l.openScreen(project, SCREEN_KINDS[i % SCREEN_KINDS.length]) });
  return events;
}

export async function idle8h(o: LaptopOptions = {}): Promise<ScenarioResult> {
  const world = createWorld();
  const l = await synced(world, o);
  await l.open();
  await world.clock.advance(8 * HOUR);
  l.stop();
  return summarise("idle8h", [l]);
}

export async function workday(o: LaptopOptions = {}): Promise<ScenarioResult> {
  const world = createWorld();
  const l = await synced(world, o);
  await l.open();
  const events = workdayEvents(l, world);
  for (let i = 0; i < 30; i += 1) events.push({ at: 13 * MINUTE + i * 16 * MINUTE, run: () => colleagueEdit(world, i) });
  await timeline(world, events, 8 * HOUR);
  l.stop();
  return summarise("workday", [l]);
}

export async function coldStart(o: LaptopOptions = {}): Promise<ScenarioResult & { complete: boolean }> {
  const world = createWorld();
  const l = createLaptop(world, o);
  await l.open();
  await world.clock.advance(1 * HOUR);
  const report = l.replica.getStatus().report;
  l.stop();
  return { ...summarise("coldStart5Projects", [l]), complete: report?.status === "done" || report?.status === "idle" ? true : !!report && report.issues.length === 0 };
}

export async function reconnect3d(o: LaptopOptions = {}): Promise<ScenarioResult & { caughtUp: boolean }> {
  const world = createWorld();
  const l = await synced(world, o);
  await l.open();
  await world.clock.advance(1 * HOUR);
  l.setOnline(false);
  l.resetCounts();
  const events: { at: number; run: () => void }[] = [];
  for (let i = 0; i < 200; i += 1) events.push({ at: i * 21 * MINUTE, run: () => colleagueEdit(world, i) });
  await timeline(world, events, 72 * HOUR);
  const whileOffline = l.total();
  l.resetCounts();
  l.setOnline(true);
  await world.clock.advance(30 * MINUTE);
  // caught up: the laptop holds the server's latest version of every task
  const d = await l.db();
  let caughtUp = true;
  for (const p of world.projects) {
    for (let i = 0; i < 10; i += 1) {
      const local = await d.getRecord("tasks", `${p}-task-${i}`);
      const remote = world.server.getRow("tasks", `${p}-task-${i}`);
      if (!local || !remote || local.serverVersion !== remote.version) caughtUp = false;
    }
  }
  l.stop();
  return { ...summarise("reconnectAfter3Days", [l], { whileOffline }), caughtUp };
}

export async function tenLaptops(o: { laptops?: number } = {}): Promise<ScenarioResult> {
  const world = createWorld();
  const count = o.laptops ?? 10;
  const laptops: SimLaptop[] = [];
  // two people per project (5 projects), each editing their own ten tasks: their edits are each other's colleague changes
  for (let i = 0; i < count; i += 1) {
    laptops.push(await synced(world, { userId: `u${i + 1}`, peers: count - 1, activeProject: world.projects[i % world.projects.length], taskOffset: (Math.floor(i / world.projects.length) % 2) * 10 }));
  }
  for (const l of laptops) await l.open();
  const events = laptops.flatMap((l, i) => workdayEvents(l, world, i * 90_000, world.projects[i % world.projects.length]));
  await timeline(world, events, 8 * HOUR);
  for (const l of laptops) l.stop();
  return summarise("tenLaptopsPerLaptop", laptops);
}

/** The claim loop alone, if it is switched on: 8 visible, idle hours, no job ever offered. */
export async function jobsIdle8h(): Promise<ScenarioResult> {
  const world = createWorld({ projects: 1 });
  const l = await synced(world, { jobs: true });
  await l.open();
  l.resetCounts();
  await world.clock.advance(8 * HOUR);
  l.stop();
  const r = summarise("jobsClaimIdle8h", [l]);
  return { ...r, perLaptopTotal: r.perLaptop.jobs_claim ?? 0 };
}
