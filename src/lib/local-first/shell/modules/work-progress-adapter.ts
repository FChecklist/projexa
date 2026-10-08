// LOCAL-FIRST shell, Work Progress, read from the laptop's own database.
//
// THE ONLINE SCREENS (src/app/(app)/work-progress): /work-progress with ?tab=entry (Daily Entry: the entries list + the entry form,
// the default), ?tab=analytics (KPIs and a value-weighted category chart, computed by the server), ?tab=report (the WPR: scope-,
// category-, manpower- and vendor-wise, computed by the server, with PDF/XLSX export); /work-progress/:id (one entry).
//
// WHAT THE LAPTOP HAS. Kinds `progress` (id, activity_id, boq_line_item_id, entry_date, quantity_done, percent_complete, remarks,
// recorded_by_id, entry_basis, created_at), `activities` (id, category_id, name, unit, planned_quantity) and `boq_lines`. The online
// list's "Activity", "BOQ line" and "Unit" are resolved here from those two kinds; when one of them is not on the laptop the column
// says so rather than guessing.
//
// WHAT IT DOES NOT HAVE (GAPS, see the package report): the WPR and the analytics are the server's calculations (value weights,
// previous/current split, manpower and vendor costs) and are not recomputed here; entry photos live in Supabase storage, not in the
// replica; who recorded an entry is an id (no people master on the laptop yet).

import type { ShellData } from "../context";
import { progressCanNameActivity } from "./delivery-writes";
import {
  DELIVERY_KINDS, parseActivity, parseBoqLineRef, parseProgress, readKind,
  type Activity, type BoqLineRef, type ProgressEntry,
} from "./delivery-local";

export type ProgressRow = ProgressEntry & {
  activityName: string | null;
  boqLabel: string | null;
  unit: string | null;
  /** Kept on this laptop and not yet accepted by the server (a temporary id). */
  waiting: boolean;
};

/** Whether the Daily Entry form can keep an entry on this laptop, and if not, why (the screen says it). */
export type EntryFormState =
  /**
   * `activity` is the project's only activity (or null); `activities` is the list the person chooses from when there are several
   * (empty otherwise). Several activities are offered only when record_work_progress can be told which one (delivery-writes.ts, P2).
   */
  | { mode: "offline"; activity: Activity | null; activities: Activity[]; lines: BoqLineRef[] }
  | { mode: "needs_server"; reason: "several_activities" | "not_synced" | "no_lines" };

export type WorkProgressData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string }
  | {
      state: "local";
      projectId: string;
      entries: ProgressRow[];
      syncedAt: number;
      /** False when activities / BOQ lines are not on the laptop: their names show as unknown. */
      namesKnown: { activities: boolean; lines: boolean };
      form: EntryFormState;
    };

export type WorkProgressEntryData =
  | { state: "no_project" }
  | { state: "not_synced"; projectId: string | null }
  | { state: "not_found"; projectId: string | null }
  | { state: "local"; projectId: string; entry: ProgressRow; activityPlanned: { quantity: number | null; unit: string | null } | null; syncedAt: number };

export const isTempId = (id: string): boolean => id.startsWith("local-");

function lineLabel(l: BoqLineRef): string {
  return l.itemCode ? `${l.itemCode} · ${l.description}` : l.description;
}

function enrich(entries: ProgressEntry[], activities: Activity[], lines: BoqLineRef[]): ProgressRow[] {
  const act = new Map(activities.map((a) => [a.id, a]));
  const line = new Map(lines.map((l) => [l.id, l]));
  return entries
    .map((e) => {
      const a = e.activityId ? act.get(e.activityId) : undefined;
      const l = e.boqLineItemId ? line.get(e.boqLineItemId) : undefined;
      return { ...e, activityName: a?.name ?? null, boqLabel: l ? lineLabel(l) : null, unit: l?.unit ?? a?.unit ?? null, waiting: isTempId(e.id) };
    })
    .sort((x, y) => y.entryDate.localeCompare(x.entryDate) || (y.createdAt ?? "").localeCompare(x.createdAt ?? "") || x.id.localeCompare(y.id));
}

export async function loadWorkProgress(
  data: ShellData,
  projectId: string | null,
  options: { canNameActivity?: boolean } = {}
): Promise<WorkProgressData> {
  if (!projectId) return { state: "no_project" };
  const [progress, activities, lines] = await Promise.all([
    readKind(data, projectId, DELIVERY_KINDS.progress, parseProgress),
    readKind(data, projectId, DELIVERY_KINDS.activities, parseActivity),
    readKind(data, projectId, DELIVERY_KINDS.boqLines, parseBoqLineRef),
  ]);
  if (!progress.synced) return { state: "not_synced", projectId };
  const acts = activities.synced ? activities.rows : [];
  const ls = lines.synced ? lines.rows : [];
  let form: EntryFormState;
  if (!activities.synced || !lines.synced) form = { mode: "needs_server", reason: "not_synced" };
  else if (acts.length > 1 && !(options.canNameActivity ?? progressCanNameActivity())) form = { mode: "needs_server", reason: "several_activities" };
  else if (ls.length === 0) form = { mode: "needs_server", reason: "no_lines" };
  else form = {
    mode: "offline",
    activity: acts.length === 1 ? acts[0]! : null,
    activities: acts.length > 1 ? [...acts].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) : [],
    lines: [...ls].sort((a, b) => (a.itemCode ?? "").localeCompare(b.itemCode ?? "") || a.description.localeCompare(b.description)) };
  return {
    state: "local",
    projectId,
    entries: enrich(progress.rows, acts, ls),
    syncedAt: progress.syncedAt,
    namesKnown: { activities: activities.synced, lines: lines.synced },
    form,
  };
}

/** One entry. Without ?projectId= every project of this person on the laptop is searched. */
export async function loadWorkProgressEntry(data: ShellData, entryId: string, projectId: string | null): Promise<WorkProgressEntryData> {
  const candidates = projectId ? [projectId] : data.projects.map((p) => p.id);
  if (candidates.length === 0) return { state: "no_project" };
  let anySynced = false;
  for (const candidate of candidates) {
    const progress = await readKind(data, candidate, DELIVERY_KINDS.progress, parseProgress);
    if (!progress.synced) continue;
    anySynced = true;
    const own = progress.rows.find((e) => e.id === entryId);
    if (!own) continue;
    const [activities, lines] = await Promise.all([
      readKind(data, candidate, DELIVERY_KINDS.activities, parseActivity),
      readKind(data, candidate, DELIVERY_KINDS.boqLines, parseBoqLineRef),
    ]);
    const acts = activities.synced ? activities.rows : [];
    const [entry] = enrich([own], acts, lines.synced ? lines.rows : []);
    const a = acts.find((x) => x.id === own.activityId);
    return { state: "local", projectId: candidate, entry: entry!, activityPlanned: a ? { quantity: a.plannedQuantity, unit: a.unit } : null, syncedAt: progress.syncedAt };
  }
  return anySynced ? { state: "not_found", projectId } : { state: "not_synced", projectId };
}

// ─── export (the laptop's own copy, as CSV) ─────────────────────────────────────────────────────────────────────

function cell(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  // a leading = + - @ would be a formula in a spreadsheet: quoted with a leading apostrophe, as the online exports do
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === "string" ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The entries list as CSV (the columns of the online list), from the laptop's copy. Waiting entries are marked. */
export function progressCsv(rows: readonly ProgressRow[]): string {
  const head = ["Date", "Activity", "BOQ line", "Qty done", "Unit", "% complete", "Basis", "Remarks", "Saved"];
  const body = rows.map((r) =>
    [r.entryDate, r.activityName, r.boqLabel, r.quantityDone, r.unit, r.percentComplete, r.entryBasis, r.remarks, r.waiting ? "waiting to be sent" : "on server"].map(cell).join(",")
  );
  return [head.join(","), ...body].join("\r\n") + "\r\n";
}
