// LOCAL-FIRST shell, overview cluster: the DASHBOARD, read from the laptop's own database. It must open instantly offline.
//
// What it shows, and where each piece comes from (nothing here calls the server):
//   * the person's projects                     ShellData (the replica's manifest + cached names), each with how much of it is copied
//   * the sync state                            the replica's per-(project, kind) "pulled to the end" markers (replica.ts doneKey)
//   * edits waiting to be sent, what needs them the outbox store of THIS person's database (pending / conflicts / blocked) plus
//                                               the shell writer's own waiting edits (pending-edits.ts), passed in by the route
//   * non-money facts of the selected project   dashboard-facts.ts over the replica's rows, ONLY for kinds pulled to the end
//   * the server's project figures              the snapshot of GET /api/dashboard/project/<id> (the endpoint the online project
//                                               dashboard uses), shown "As of ..., from this laptop"; the screen refreshes it online
//
// Money, budgets, valuation, approvals and the critical path are never worked out here (see dashboard-facts.ts for the line).

import { localDbNameFor, openLocalDb, type LocalDb } from "../../local-db";
import { loadLocalFirst } from "../../local-reader";
import { MANIFEST_KEY, doneKey, type DoneMarker, type StoredManifest } from "../../replica";
import type { ShellData } from "../context";
import { snapshotCacheFor, type Snapshot, type SnapshotName } from "../snapshot-cache";
import { activityFacts, countByStatus, milestonesDueThisWeek, taskFacts, type ActivityFacts, type StatusCount, type TaskFacts } from "./dashboard-facts";

/** One kind's facts: the value when that (project, kind) is on the laptop to the end, else "not_synced" (never a partial count). */
export type Fact<T> = { state: "local"; syncedAt: number | null; value: T } | { state: "not_synced" };

export type DashboardFacts = {
  tasks: Fact<TaskFacts>;
  rfis: Fact<StatusCount[]>;
  punchList: Fact<StatusCount[]>;
  submittals: Fact<StatusCount[]>;
  /** Needs both `activities` and `progress` on the laptop. */
  activities: Fact<ActivityFacts>;
  milestonesDueThisWeek: Fact<number>;
};

export type ProjectSyncState = { id: string; name: string; kindsCopied: number; kindsTotal: number; lastCopiedAt: number | null };

export type Waiting = {
  /** Edits in the outbox not yet applied on the server (every status). */
  outbox: number;
  conflicts: number;
  blocked: number;
  /** The shell writer's own waiting edits (BOQ categories). */
  shellEdits: number;
};

/** The figures the online project dashboard shows, as the server computed them. Only the fields this screen shows are required. */
export type ProjectDashboardSnapshot = {
  projectId: string;
  progressPercent: number | null;
  percentByValue: number | null;
  contractValue: number | null;
  budget: number | null;
  expenses: number | null;
  delayedTaskCount: number | null;
  taskCount: number | null;
  permitsExpiringCount: number | null;
  /**
   * True when the server hid the money from this person (below the manager rank, compliance-tracker
   * src/app/api/v1/projexa/dashboard/[projectId]/route.ts): the money fields are then null because they are HIDDEN, not because they are
   * unset, and the screen leaves them out (lf-e10c, found in a real browser).
   */
  financialsRedacted?: boolean;
};

export type DashboardData = {
  projectId: string | null;
  projects: ProjectSyncState[];
  waiting: Waiting;
  facts: DashboardFacts | null;
  snapshot: Snapshot<ProjectDashboardSnapshot> | null;
};

export const PROJECT_DASHBOARD_ROUTE = "/api/dashboard/project";
export const projectDashboardSnapshotName = (projectId: string): SnapshotName => ({ route: PROJECT_DASHBOARD_ROUTE, projectId });
export const projectDashboardUrl = (projectId: string) => `${PROJECT_DASHBOARD_ROUTE}/${encodeURIComponent(projectId)}`;

const numOrNull = (v: unknown) => v === null || v === undefined || (typeof v === "number" && Number.isFinite(v));

/** The server's answer is untrusted until it looks like the project's dashboard (and is about THIS project). */
export function isProjectDashboard(v: unknown): v is ProjectDashboardSnapshot {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.projectId === "string"
    && ["progressPercent", "percentByValue", "contractValue", "budget", "expenses", "delayedTaskCount", "taskCount", "permitsExpiringCount"].every((k) => numOrNull(o[k]));
}

export const projectDashboardFor = (projectId: string) => (v: unknown): v is ProjectDashboardSnapshot => isProjectDashboard(v) && v.projectId === projectId;

async function readKind(db: LocalDb, kind: string, projectId: string): Promise<{ rows: unknown[]; syncedAt: number | null } | null> {
  const result = await loadLocalFirst<unknown>(kind, projectId, async () => [], { db });
  return result.state === "local" ? { rows: result.rows, syncedAt: result.syncedAt } : null;
}

async function factsFor(db: LocalDb, projectId: string, now: number): Promise<DashboardFacts> {
  const [tasks, rfis, punch, submittals, activities, progress, milestones] = await Promise.all(
    ["tasks", "rfis", "punch_list", "submittals", "activities", "progress", "milestones"].map((k) => readKind(db, k, projectId))
  );
  const fact = <T>(src: { rows: unknown[]; syncedAt: number | null } | null, fn: (rows: unknown[]) => T): Fact<T> =>
    src ? { state: "local", syncedAt: src.syncedAt, value: fn(src.rows) } : { state: "not_synced" };
  return {
    tasks: fact(tasks ?? null, (rows) => taskFacts(rows, now)),
    rfis: fact(rfis ?? null, countByStatus),
    punchList: fact(punch ?? null, countByStatus),
    submittals: fact(submittals ?? null, countByStatus),
    activities: activities && progress
      ? { state: "local", syncedAt: Math.min(activities.syncedAt ?? 0, progress.syncedAt ?? 0) || null, value: activityFacts(activities.rows, progress.rows) }
      : { state: "not_synced" },
    milestonesDueThisWeek: fact(milestones ?? null, (rows) => milestonesDueThisWeek(rows, now)),
  };
}

async function projectStates(db: LocalDb, data: ShellData, manifest: StoredManifest | null): Promise<ProjectSyncState[]> {
  const kinds = manifest && manifest.userId === data.userId && Array.isArray(manifest.kinds) ? manifest.kinds.filter((k) => typeof k === "string") : [];
  const out: ProjectSyncState[] = [];
  for (const project of data.projects) {
    let copied = 0;
    let last: number | null = null;
    for (const kind of kinds) {
      const marker = await db.getMeta<DoneMarker | null>(doneKey(project.id, kind));
      if (marker && typeof marker.at === "number") {
        copied += 1;
        last = last === null ? marker.at : Math.max(last, marker.at);
      }
    }
    out.push({ id: project.id, name: project.name, kindsCopied: copied, kindsTotal: kinds.length, lastCopiedAt: last });
  }
  return out;
}

async function waitingOps(db: LocalDb): Promise<Omit<Waiting, "shellEdits">> {
  const ops = await db.listOps();
  return {
    outbox: ops.length,
    conflicts: ops.filter((o) => o.status === "conflict").length,
    blocked: ops.filter((o) => o.status === "blocked").length,
  };
}

export async function loadDashboard(data: ShellData, projectId: string | null, options: { shellEdits?: number; now?: number } = {}): Promise<DashboardData> {
  const now = options.now ?? Date.now();
  const idb = data.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  const empty: DashboardData = {
    projectId, projects: data.projects.map((p) => ({ id: p.id, name: p.name, kindsCopied: 0, kindsTotal: 0, lastCopiedAt: null })),
    waiting: { outbox: 0, conflicts: 0, blocked: 0, shellEdits: options.shellEdits ?? 0 }, facts: null, snapshot: null,
  };
  if (!idb) return empty;
  const db = await openLocalDb(idb, localDbNameFor(data.userId));
  try {
    const manifest = (await db.getMeta<StoredManifest | null>(MANIFEST_KEY)) ?? null;
    const [projects, ops, facts] = await Promise.all([
      projectStates(db, data, manifest),
      waitingOps(db).catch(() => ({ outbox: 0, conflicts: 0, blocked: 0 })),
      projectId ? factsFor(db, projectId, now) : Promise.resolve(null),
    ]);
    const snapshot = projectId
      ? await snapshotCacheFor({ userId: data.userId, role: data.role, idb }).read(projectDashboardSnapshotName(projectId), projectDashboardFor(projectId))
      : null;
    return { projectId, projects, waiting: { ...ops, shellEdits: options.shellEdits ?? 0 }, facts, snapshot };
  } finally {
    db.close();
  }
}
