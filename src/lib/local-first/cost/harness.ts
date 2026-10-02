// TEST ONLY (package lf-e6, R14/G4): the invocation-count harness. It builds simulated laptops out of the REAL laptop code
// -- the sync client, the replica, the outbox, the flush scheduler, the auto-sync scheduler with its server step and
// attestation refresh, the jobs claim loop and the shell's once-a-day manifest refresh -- points them at the shared fake
// sync server (__fixtures__/fake-sync-server.ts, which speaks real HTTP Responses) and COUNTS every request each laptop
// sends, by route, on a simulated clock. Nothing here is a model of the code: where a request is counted, the real code
// decided to send it.
//
// How a laptop is put together mirrors the app's own wiring, file by file:
//   * auto-sync (peer/auto-sync.ts + peer/peer-shared.ts): one scheduler; its server half is createServerStep over the
//     laptop's database and the shared replica, followed by an attestation refresh; its peer half is the peer network.
//     Peers are not simulated here (they cost no Edge invocation: rows move over WebRTC, signalling over Realtime); a
//     scenario says how many are connected and the peer step answers "nothing new".
//   * the outbox and its flush scheduler (shell/LocalShell.tsx): an edit is enqueued, the scheduler is nudged, and the
//     send step is LocalShell's own: flush, then bring the BOQ lines of the touched project up to date.
//   * a screen opened (local-reader.ts useLocalFirst / boq-local.ts): one background syncProject(project, kind).
//   * the boot pass (boot.ts runBootPass): the shell manifest refresh is the REAL refreshShellManifest; the release check
//     (persistence.ts runLocalFirstBoot: at most every six hours, GET /release/current for ensureRegistered and once more
//     for applyRegistryNumbers) is counted by rule, because the release installer needs Cache Storage and a service
//     worker this harness does not have. That is the one modelled count, and it is named "release_current".
//   * the jobs claim loop (jobs/runner.ts), when a scenario switches it on, against the fake jobs queue.
//
// The simulated clock fires timers in order; after each, the harness waits until every tracked piece of async work (a
// scheduler run, a flush, a claim, a screen's revalidation) has finished, so IndexedDB work on fake-indexeddb completes
// before time moves on.

import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, FAKE_BASE_URL, type FakeSyncServer, type FakeKind } from "../__fixtures__/fake-sync-server";
import { createFakeJobsServer, type FakeJobsServer } from "../jobs/__fixtures__/fake-jobs-server";
import { createJobRunner, type JobRunner } from "../jobs/runner";
import { createInProcessExecutor } from "../jobs/worker";
import { localDbNameFor, openLocalDb, type LocalDb } from "../local-db";
import { createOutbox, type Outbox } from "../outbox";
import { createAttestationSource } from "../peer/attest";
import { createSyncScheduler, type SchedulerClock, type SyncScheduler } from "../peer/scheduler";
import { createServerStep } from "../peer/server-step";
import { createReplica, type Replica } from "../replica";
import { refreshShellManifest } from "../shell/manifest-cache";
import { createFlushScheduler } from "../shell/pending-edits";
import { createSyncClient, type SyncClient } from "../sync-client";
import { routeOf, type RouteCounts } from "./budget";

/** The 28 project kinds of the backend (handler.ts SYNC_KINDS). `progress` has no updated_at cursor, like the fake's default. */
export const BACKEND_KINDS: FakeKind[] = [
  "project", "tasks", "boqs", "boq_lines", "activities", "progress", "rfis", "submittals", "punch_list", "change_orders", "milestones", "materials", "documents",
  "roster", "attendance", "timesheets", "meetings", "meeting_minutes", "site_diaries", "site_instructions", "progress_claims", "interim_bills",
  "material_receipts", "material_issues", "expenses", "schedule_baselines", "ffe_items", "wiki_pages",
].map((kind) => (kind === "progress" ? { kind, cursor_field: null } : { kind }));

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
const START = Date.parse("2026-10-05T08:00:00Z");
const SIX_HOURS = 6 * HOUR;

// ─── the simulated clock ─────────────────────────────────────────────────────────────────────────────────────

export type SimClock = SchedulerClock & {
  advance(ms: number): Promise<void>;
  /** Tracks one piece of async work so advance() waits for it. */
  track<T>(p: Promise<T>): Promise<T>;
  settle(): Promise<void>;
};

export function createSimClock(start = START): SimClock {
  let t = start;
  let seq = 0;
  let inflight = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const tick = () => new Promise<void>((r) => setImmediate(r));
  const clock: SimClock = {
    now: () => t,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: t + Math.max(0, ms), fn }); return id; },
    clearTimeout(h) { timers.delete(h as number); },
    track(p) {
      inflight += 1;
      return p.finally(() => { inflight -= 1; });
    },
    async settle() {
      // Quiet = nothing tracked in flight for several consecutive macrotasks (fake-indexeddb completes on setImmediate).
      let quiet = 0;
      for (let guard = 0; guard < 200_000 && quiet < 6; guard += 1) {
        await tick();
        quiet = inflight === 0 ? quiet + 1 : 0;
      }
    },
    async advance(ms) {
      const end = t + ms;
      await clock.settle();
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | null = null;
        for (const e of timers) if (e[1].at <= end && (!next || e[1].at < next[1].at || (e[1].at === next[1].at && e[0] < next[0]))) next = e;
        if (!next) break;
        timers.delete(next[0]);
        t = Math.max(t, next[1].at);
        next[1].fn();
        await clock.settle();
      }
      t = end;
      await clock.settle();
    },
  };
  return clock;
}

// ─── the shared world ────────────────────────────────────────────────────────────────────────────────────────

export type World = { clock: SimClock; server: FakeSyncServer; jobs: FakeJobsServer; projects: string[] };

/** One organisation's server, seeded with `rowsPerKind` rows of every kind in every project (and 10 editable tasks each). */
export function createWorld(o: { projects?: number; rowsPerKind?: number } = {}): World {
  const clock = createSimClock();
  const projects = Array.from({ length: o.projects ?? 5 }, (_, i) => `p${i + 1}`);
  const server = createFakeSyncServer({ projects, kinds: BACKEND_KINDS, includeServerOnApplied: true });
  for (const p of projects) {
    for (const k of BACKEND_KINDS) {
      for (let i = 0; i < (o.rowsPerKind ?? 2); i += 1) server.upsert({ kind: k.kind, projectId: p, id: `${p}-${k.kind}-${i}`, data: { name: `${k.kind} ${i}` } });
    }
    for (let i = 0; i < 20; i += 1) server.upsert({ kind: "tasks", projectId: p, id: `${p}-task-${i}`, data: { title: `Task ${i}` } });
  }
  return { clock, server, jobs: createFakeJobsServer(clock.now), projects };
}

/** A colleague (another laptop, or the online app) changes a row on the server. */
export function colleagueEdit(world: World, n: number): void {
  const p = world.projects[n % world.projects.length];
  world.server.upsert({ kind: "tasks", projectId: p, id: `${p}-task-${n % 10}`, data: { title: `Colleague edit ${n}` } });
}

// ─── one laptop ───────────────────────────────────────────────────────────────────────────────────────────────

export type LaptopOptions = {
  userId?: string;
  /** Peers connected the whole time (same organisation and view class). */
  peers?: number;
  /** Start the jobs claim loop (it is not wired into the app today; see COST_MODEL.md). */
  jobs?: boolean;
  /** The project the person has open (the shell's remembered selection). */
  activeProject?: string;
  /** Wire the server step in its original head-check mode instead of peer-shared.ts's project mode (comparison only). */
  headMode?: boolean;
  /** This person edits tasks offset..offset+9 of the open project (two people on one project edit different tasks). */
  taskOffset?: number;
};

export type SimLaptop = {
  userId: string;
  counts: RouteCounts;
  replica: Replica;
  outbox: Outbox;
  scheduler: SyncScheduler | null;
  runner: JobRunner | null;
  db(): Promise<LocalDb>;
  /** The app is opened: the boot pass, the outbox resume, auto-sync and (if on) the claim loop start. */
  open(): Promise<void>;
  /** The first copy, as WorkspacePrepare / the boot's ensureWorkspaceData run it (a whole replica.sync()). */
  prepare(): Promise<void>;
  /** The person edits one task (the outbox path, exactly like an edit screen). */
  edit(n: number): Promise<void>;
  /** The person opens a screen: the screen's background revalidation of one (project, kind). */
  openScreen(projectId: string, kind: string): Promise<void>;
  setOnline(online: boolean): void;
  setVisible(visible: boolean): void;
  resetCounts(): void;
  total(): number;
  stop(): void;
};

export function createLaptop(world: World, o: LaptopOptions = {}): SimLaptop {
  const { clock, server } = world;
  const userId = o.userId ?? "u1";
  const idb = new IDBFactory();
  const env = { online: true, visible: true, lastActivity: clock.now(), peers: o.peers ?? 0, active: o.activeProject ?? world.projects[0] };
  let counts: RouteCounts = {};
  const count = (route: keyof RouteCounts, n = 1) => { counts[route] = (counts[route] ?? 0) + n; };

  // Every request this laptop sends goes through here: counted by route, refused when the laptop is offline, and the
  // manifest's person rewritten to this laptop's (the fake server serves one person; ten laptops are ten people).
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.slice(FAKE_BASE_URL.length);
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    if (!env.online) throw new TypeError("offline");
    const route = routeOf(path, body);
    count(route);
    if (route === "push" && Array.isArray(body?.ops)) count("execOps", body.ops.length);
    const res = await server.fetchImpl(input, init);
    if (route !== "manifest" || !res.ok) return res;
    const json = await res.json();
    json.user = { ...json.user, id: userId };
    return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const client: SyncClient = createSyncClient({
    getAccessToken: async () => "token", baseUrl: FAKE_BASE_URL, fetchImpl, sleep: async () => {}, maxRetries: 1, getReleaseVersion: () => "2026.10.02-3",
  });

  const replica = createReplica({ userId, client, idb, yieldFn: async () => {}, now: clock.now });
  let n = 0;
  const outbox = createOutbox({ userId, client, deviceId: `device-${userId}`, idb, now: clock.now, sleep: (ms) => clock.track(new Promise<void>((r) => clock.setTimeout(r, ms))), autoFlush: false, locks: null, newOpId: () => `${userId}-op-${++n}` });

  let dbHandle: Promise<LocalDb> | null = null;
  const db = () => (dbHandle ??= openLocalDb(idb, localDbNameFor(userId)));
  const deviceMeta = new Map<string, unknown>();
  const meta = { async getMeta<T>(k: string) { return deviceMeta.get(k) as T | undefined; }, async setMeta(k: string, v: unknown) { deviceMeta.set(k, v); } };

  // the boot pass (boot.ts): release check every six hours (counted by rule, see the header), the shell manifest once a day (real)
  let lastReleaseCheck = Number.NEGATIVE_INFINITY;
  const bootPass = async () => {
    if (!env.online) return;
    if (clock.now() - lastReleaseCheck >= SIX_HOURS) {
      count("release_current", 2);
      lastReleaseCheck = clock.now();
    }
    await refreshShellManifest({ client, meta, userId, now: clock.now });
  };

  // LocalShell's flush scheduler and its send step
  const send = async () => {
    const before = await outbox.listPending();
    const report = await outbox.flush();
    if (report.sent > 0) {
      for (const projectId of new Set(before.map((op) => op.projectId))) await replica.syncProject(projectId, "boq_lines").catch(() => null);
    }
    return { sent: report.sent, kept: report.remaining, rejected: report.rejected, stoppedBecause: env.online ? ("none" as const) : ("offline" as const) };
  };
  const flusher = createFlushScheduler({
    writer: { list: async () => (await outbox.listPending()) as never[], flush: () => clock.track(send()) },
    isOnline: () => env.online,
    setTimer: (fn, ms) => clock.setTimeout(() => { void clock.track(Promise.resolve().then(fn)); }, ms),
    clearTimer: (h) => clock.clearTimeout(h),
  });

  let scheduler: SyncScheduler | null = null;
  let runner: JobRunner | null = null;
  let attestation: ReturnType<typeof createAttestationSource> | null = null;

  const laptop: SimLaptop = {
    userId,
    get counts() { return counts; },
    replica,
    outbox,
    get scheduler() { return scheduler; },
    get runner() { return runner; },
    db,
    async open() {
      await clock.track(bootPass());
      const d = await db();
      attestation = createAttestationSource({
        meta: d, userId, now: clock.now,
        fetchAttest: async () => {
          if (!env.online) throw new TypeError("offline");
          count("attest");
          return { token: "t", expires_at: new Date(clock.now() + DAY).toISOString(), org_id: server.orgId, user_id: userId, view_class: "v", projects: world.projects, channel: "c", public_keys: [], server_time: new Date(clock.now()).toISOString() };
        },
      });
      // peer-shared.ts's wiring: project mode, the open project every run (o.headMode: the original head-check mode, for comparison)
      const serverStep = createServerStep({
        meta: d, changes: (r) => client.changes(r), sync: () => replica.sync(), now: clock.now,
        ...(o.headMode ? {} : { syncProject: (projectId: string) => replica.syncProject(projectId), activeProject: () => env.active }),
      });
      const att = attestation;
      scheduler = createSyncScheduler({
        clock, locks: null,
        isVisible: () => env.visible, isOnline: () => env.online, peersConnected: () => env.peers,
        // auto-sync.ts: the server step, then the attestation refresh
        serverStep: () => clock.track((async () => { const r = await serverStep(); await att.refresh(); return r; })()),
        peerStep: () => clock.track(Promise.resolve({ changed: false })),
      });
      scheduler.start();
      flusher.nudge();
      if (o.jobs) {
        world.jobs.addUser({ id: userId, org: server.orgId, viewClass: "v", projects: world.projects });
        const api = world.jobs.apiFor(userId);
        const tracked = Object.fromEntries(Object.entries(api).map(([k, fn]) => [k, (...a: unknown[]) => {
          if (k === "claim") count("jobs_claim");
          else count(`jobs_${k}` as keyof RouteCounts);
          return clock.track((fn as (...x: unknown[]) => Promise<unknown>)(...a));
        }])) as unknown as typeof api;
        runner = createJobRunner({
          api: tracked, executor: createInProcessExecutor(), timers: clock, deviceId: `device-${userId}`,
          env: { now: clock.now, isVisible: () => env.visible, isOnline: () => env.online, isLowBattery: () => false, saveData: () => false, lastActivityAt: () => env.lastActivity },
          loadInput: async () => ({ rows: [], params: {} }), hasProject: async (p) => world.projects.includes(p),
          loadOptOut: async () => false, saveOptOut: async () => {},
        });
        await runner.start();
      }
      await clock.settle();
    },
    async prepare() {
      await clock.track(replica.sync());
    },
    async edit(i) {
      env.lastActivity = clock.now();
      const p = env.active;
      const id = `${p}-task-${(o.taskOffset ?? 0) + (i % 10)}`;
      const d = await db();
      const row = await d.getRecord("tasks", id);
      const title = `My edit ${i}`;
      await clock.track(outbox.enqueue({
        functionId: "update_task", projectId: p, params: { issueId: id, title }, label: "Task change",
        record: { kind: "tasks", id, baseVersion: (row?.dirty ? row.serverCopy?.version : row?.serverVersion) ?? row?.serverVersion ?? 0 },
        optimistic: async (tx) => {
          const r = await tx.getRecord("tasks", id);
          if (r) await tx.patchRecord("tasks", id, { data: { ...(r.data as object), title } });
        },
      }));
      flusher.nudge();
      runner?.refresh();
      await clock.settle();
    },
    async openScreen(projectId, kind) {
      env.lastActivity = clock.now();
      env.active = projectId;
      await clock.track(replica.syncProject(projectId, kind).catch(() => null));
    },
    setOnline(online) {
      env.online = online;
      if (online) {
        void clock.track(bootPass());
        void scheduler?.trigger("online");
        flusher.nudge({ immediate: true });
      }
      runner?.refresh();
    },
    setVisible(visible) {
      env.visible = visible;
      scheduler?.visibilityChanged();
      runner?.refresh();
    },
    resetCounts() { counts = {}; },
    total() { return Object.values(counts).reduce((a, b) => a + (b ?? 0), 0); },
    stop() {
      scheduler?.stop();
      runner?.stop();
      flusher.stop();
      outbox.dispose();
    },
  };
  return laptop;
}
