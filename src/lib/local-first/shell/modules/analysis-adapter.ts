// LOCAL-FIRST shell, overview cluster: ANALYSIS, read from the laptop's own database.
//
//   /analysis               the hub: the online hub's own list (analysisScreens() from src/lib/analysis-screens.ts), project carried
//   /analysis/exceptions    the 28 checks are the SERVER's (construction-exceptions-service): the last answer of GET /api/exceptions kept
//                           on this laptop, "As of ..., from this laptop"; refreshed while online
//   /analysis/project-360   margin, cost and profit are the SERVER's: the last answer of GET /api/reports/boq-analysis kept here. Beside
//                           it, the non-money facts the replica answers exactly: change orders, milestones and progress claims by
//                           status (their amounts are never added up here). The critical path is "recalculated when online".

import { analysisScreens, type AnalysisScreen } from "@/lib/analysis-screens";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { loadLocalFirst } from "../../local-reader";
import type { ShellData } from "../context";
import { snapshotCacheFor, type Snapshot, type SnapshotName } from "../snapshot-cache";
import { countByStatus, type StatusCount } from "./dashboard-facts";
import type { Fact } from "./dashboard-adapter";

// ─── the hub ─────────────────────────────────────────────────────────────────────────────────────

export type AnalysisHubData = { projectId: string | null; screens: AnalysisScreen[] };

export function loadAnalysisHub(projectId: string | null): AnalysisHubData {
  return { projectId, screens: analysisScreens(projectId) };
}

// ─── exceptions ──────────────────────────────────────────────────────────────────────────────────

export type ExceptionRecord = { id: string; detail: string; recordType?: string; linkId?: string };
export type ExceptionCheck = { item: number; title: string; flagged: boolean; count: number; records: ExceptionRecord[]; formula?: string };
export type ExceptionsBody = { checks: ExceptionCheck[] };

const isRecord = (v: unknown): v is ExceptionRecord =>
  typeof v === "object" && v !== null && typeof (v as ExceptionRecord).id === "string" && typeof (v as ExceptionRecord).detail === "string";

/** The server's answer, untrusted until it looks like the 28 checks. Records that do not look right are dropped, not the whole answer. */
export function isExceptionsBody(v: unknown): v is ExceptionsBody {
  if (typeof v !== "object" || v === null || !Array.isArray((v as ExceptionsBody).checks)) return false;
  return (v as ExceptionsBody).checks.every((c) =>
    typeof c === "object" && c !== null && typeof c.item === "number" && typeof c.title === "string" && typeof c.flagged === "boolean"
    && typeof c.count === "number" && Array.isArray(c.records));
}

export const exceptionsUrl = (projectId: string) => `/api/exceptions?projectId=${encodeURIComponent(projectId)}`;
export const exceptionsSnapshotName = (projectId: string): SnapshotName => ({ route: "/api/exceptions", projectId });

export type ExceptionsData =
  | { state: "no_project" }
  | { state: "local"; projectId: string; snapshot: Snapshot<ExceptionsBody> | null };

export async function loadExceptions(data: ShellData, projectId: string | null): Promise<ExceptionsData> {
  if (!projectId) return { state: "no_project" };
  const snapshot = await snapshotCacheFor({ userId: data.userId, role: data.role, idb: data.idb }).read(exceptionsSnapshotName(projectId), isExceptionsBody);
  if (snapshot) snapshot.body = { checks: snapshot.body.checks.map((c) => ({ ...c, records: c.records.filter(isRecord) })) };
  return { state: "local", projectId, snapshot };
}

// ─── project 360 ─────────────────────────────────────────────────────────────────────────────────

export type BoqAnalysisBody = { row: Record<string, unknown> };

export function isBoqAnalysisBody(v: unknown): v is BoqAnalysisBody {
  const row = (v as BoqAnalysisBody | null)?.row;
  return typeof v === "object" && v !== null && typeof row === "object" && row !== null && !Array.isArray(row);
}

export const boqAnalysisUrl = (projectId: string) => `/api/reports/boq-analysis?projectId=${encodeURIComponent(projectId)}`;
export const boqAnalysisSnapshotName = (projectId: string): SnapshotName => ({ route: "/api/reports/boq-analysis", projectId });

export type Project360Data =
  | { state: "no_project" }
  | {
      state: "local";
      projectId: string;
      snapshot: Snapshot<BoqAnalysisBody> | null;
      changeOrders: Fact<StatusCount[]>;
      milestones: Fact<StatusCount[]>;
      progressClaims: Fact<StatusCount[]>;
    };

export async function loadProject360(data: ShellData, projectId: string | null): Promise<Project360Data> {
  if (!projectId) return { state: "no_project" };
  const idb = data.idb ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  const snapshot = await snapshotCacheFor({ userId: data.userId, role: data.role, idb }).read(boqAnalysisSnapshotName(projectId), isBoqAnalysisBody);
  const none: Fact<StatusCount[]> = { state: "not_synced" };
  if (!idb) return { state: "local", projectId, snapshot, changeOrders: none, milestones: none, progressClaims: none };
  const db = await openLocalDb(idb, localDbNameFor(data.userId));
  try {
    const byStatus = async (kind: string): Promise<Fact<StatusCount[]>> => {
      const r = await loadLocalFirst<unknown>(kind, projectId, async () => [], { db });
      return r.state === "local" ? { state: "local", syncedAt: r.syncedAt, value: countByStatus(r.rows) } : none;
    };
    const [changeOrders, milestones, progressClaims] = await Promise.all([byStatus("change_orders"), byStatus("milestones"), byStatus("progress_claims")]);
    return { state: "local", projectId, snapshot, changeOrders, milestones, progressClaims };
  } finally {
    db.close();
  }
}
