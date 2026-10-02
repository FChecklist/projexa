// Reads the rows a job runs over from THIS laptop's own copy (the replica), and answers "is this project here at all?".
// What the person may not see was already redacted by the server before it reached the replica, so a job can never
// compute from, or leak, data its person cannot read.
import type { LocalDb } from "../local-db";
import { MANIFEST_KEY, type StoredManifest } from "../replica";
import { isJobType, type JobType } from "./job-types";

export const BOQ_LINES_KIND = "boq_lines";
/** Kinds a search_index job covers when the request names none. */
export const DEFAULT_SEARCH_KINDS = ["rfis", "tasks", "boq_lines", "documents", "punch_items"];
const MAX_KINDS = 8;

export type JobInput = { rows: unknown[]; params: unknown };

export async function projectIsLocal(db: Pick<LocalDb, "getMeta">, projectId: string): Promise<boolean> {
  const m = await db.getMeta<StoredManifest | null>(MANIFEST_KEY);
  return !!m && Array.isArray(m.projectIds) && m.projectIds.includes(projectId);
}

export async function loadJobInput(db: Pick<LocalDb, "getMeta" | "listByProject">, job: { type: string; project_id: string; params: unknown }): Promise<JobInput | null> {
  if (!isJobType(job.type)) return null;
  const m = await db.getMeta<StoredManifest | null>(MANIFEST_KEY);
  if (!m || !m.projectIds.includes(job.project_id)) return null;
  const params = typeof job.params === "object" && job.params !== null && !Array.isArray(job.params) ? (job.params as Record<string, unknown>) : {};
  const list = async (kind: string) => (await db.listByProject(m.orgId, kind, job.project_id)).map((r) => r.data);
  const type: JobType = job.type;
  if (type === "boq_rollup") return { rows: await list(BOQ_LINES_KIND), params };
  if (type === "search_index") {
    const kinds = (Array.isArray(params.kinds) ? params.kinds.filter((k): k is string => typeof k === "string") : DEFAULT_SEARCH_KINDS).slice(0, MAX_KINDS);
    const rows: unknown[] = [];
    for (const kind of kinds) for (const row of await list(kind)) rows.push({ kind, row });
    return { rows, params };
  }
  // csv_export, report_preview: one kind
  const kind = typeof params.kind === "string" ? params.kind : "";
  if (!kind) return null;
  return { rows: await list(kind), params };
}
