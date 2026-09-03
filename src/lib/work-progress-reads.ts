// R67 D-55 / D-65 -- the Work Progress module's reads, and the one rule its
// two screens kept implementing separately.
//
// WHAT THIS EXISTS TO FIX. /work-progress and /work-progress?tab=analytics
// each opened the same four endpoints, and each wrote the same line:
//
//     fetch(`/api/work-progress?projectId=…`).then((r) => r.json())
//     setEntries(entriesRes.entries ?? []);
//
// The status was never read. A 500 answers with `{ error: "…" }`, so
// `.entries` was undefined, `?? []` made it an empty array, and the list
// printed "No progress entries logged yet." for a project with a hundred
// entries — while the analytics tab, from the very same body, printed
// "Total entries 0" and "Avg % Complete 0%". Worse on the list page: the
// batch had no catch at all, so a thrown fetch left `loading` true forever
// and the pane spun with no error and no way out.
//
// The repo's re-runnable guard (src/lib/no-swallowed-http-errors.test.ts)
// could not see either site: it looks for `const res = await fetch(…)`
// followed by `res.json()`, and this is the `.then(r => r.json())` shape.
// That gap is now closed by that file's own third guard; this module is the
// replacement those call sites move to.
//
// Nothing here renders. The two decisions live here so they can be asserted
// without a DOM: which BOQ revision the line-item lookup should use, and
// what an entry list is worth once a read has failed.

import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { listOutcomeFromError, listOutcomeFromRows, type ListOutcome } from "@/lib/read-outcome";

export type BoqSummary = { id: string; version: number; status: string };

/**
 * The BOQ revision whose line items a progress entry is described against.
 *
 * The rule the two screens both carried, verbatim: an approved revision wins;
 * failing that a submitted one; failing that the highest version number. It
 * is here rather than in either screen because the two copies could drift and
 * then the same entry would name two different BOQ lines depending on which
 * tab you were looking at.
 *
 * Sorting is done on a COPY -- the original array belongs to the caller's
 * state and reordering it in place would reorder what is on screen.
 */
export function pickCurrentBoq<T extends BoqSummary>(boqs: T[]): T | null {
  if (boqs.length === 0) return null;
  return (
    boqs.find((b) => b.status === "approved") ??
    boqs.find((b) => b.status === "submitted") ??
    [...boqs].sort((a, b) => b.version - a.version)[0] ??
    null
  );
}

export type ProgressEntry = {
  id: string;
  activityId: string;
  boqLineItemId: string | null;
  entryDate: string;
  quantityDone: string;
  percentComplete: string;
  entryBasis: string;
  remarks: string | null;
  // R67 F-24 (audit R-240): resolved SERVER-side and sent with the row.
  // activityName is null only when the activity row is gone; the BOQ pair is
  // null when the entry has no BOQ link (boq_line_item_id is nullable and
  // ON DELETE SET NULL). Optional so an older backend, or a fixture written
  // before #1579, still type-checks -- it renders exactly as null does.
  activityName?: string | null;
  boqItemCode?: string | null;
  boqDescription?: string | null;
};

// `unit` is on the wire and is what the FORM's picker labels with ("Blockwork
// (sqm)"); it was simply never declared here, because the only consumer at
// the time wanted the name. Optional, so a payload without it still narrows.
export type ProgressActivity = { id: string; name: string; unit?: string | null; categoryId?: string | null };
export type ProgressLineItem = { id: string; itemCode: string | null; description: string };
export type CategoryProgress = { categoryId: string; name: string; percentComplete: number };

export type WorkProgressReadResult = {
  /**
   * The entries read. This is the outcome, not an array -- so a caller
   * physically cannot reach "there are none" without a 200 having happened.
   */
  entries: ListOutcome<ProgressEntry>;
  /**
   * The activity lookup, for the FORM's picker. A failure here is NOT fatal to
   * the list -- the entry rows already carry their own activity name -- so it
   * is a plain array, empty on failure, and the entry read alone decides the
   * pane.
   */
  activities: ProgressActivity[];
  /**
   * R67 D-29 (lane D1, folded in). Why the array above is empty, when it is.
   *
   * The array alone cannot tell "this project has no activities" from "the
   * activity lookup failed", and this read used to collapse both to `[]`. That
   * is the same class of lie the entries outcome above exists to prevent, one
   * level down: a silently missing lookup is how the form's picker comes up
   * empty and a row's activity renders as a raw id, with nothing on screen
   * saying a read failed. null when the lookup answered.
   */
  activitiesError: string | null;
};

/**
 * One read for both Work Progress screens.
 *
 * R67 MERGE (lane F2's F-24, audit R-240). THIS USED TO FETCH THE BOQ TOO, AND
 * THAT IS WHAT COST 7.4 s. The chain was: entries and activities, then
 * `/api/scope`, then `/api/scope/{id}` for the resolved revision -- pulling a
 * whole BOQ's line items across the wire, in series, and holding the table
 * behind it. All of that existed to translate ONE column, and it still
 * rendered a raw id whenever the resolution missed.
 *
 * VERIDIAN now LEFT JOINs both names into the progress query and sends
 * `activityName`, `boqItemCode` and `boqDescription` with each entry
 * (compliance-tracker #1579), so the translation table is not needed and the
 * two /api/scope calls are gone from this read entirely. What is left is one
 * batch of two independent requests.
 *
 * pickCurrentBoq() below is unchanged and still exported: WorkProgressFormClient
 * uses it for its own BOQ PICKER, which is a control the user operates, not a
 * translation table -- without it a site engineer cannot record progress
 * against a line at all.
 */
export async function readWorkProgress(
  projectId: string,
  signal?: AbortSignal
): Promise<WorkProgressReadResult> {
  const q = `projectId=${encodeURIComponent(projectId)}`;

  const [entriesR, activitiesR] = await Promise.allSettled([
    fetchJson<{ entries?: ProgressEntry[] }>(`/api/work-progress?${q}`, { signal }),
    fetchJson<{ activities?: ProgressActivity[] }>(`/api/work-progress/activities?${q}`, { signal }),
  ]);

  const entries: ListOutcome<ProgressEntry> =
    entriesR.status === "fulfilled"
      ? listOutcomeFromRows(entriesR.value.entries ?? [])
      : listOutcomeFromError<ProgressEntry>(entriesR.reason);

  const activities = activitiesR.status === "fulfilled" ? (activitiesR.value.activities ?? []) : [];
  // R67 D-29: the backend's own words when the lookup failed, so the pane can
  // SAY the names may be missing rather than showing an empty picker.
  const activitiesError =
    activitiesR.status === "fulfilled"
      ? null
      : errorMessage(activitiesR.reason, "Could not load activities");

  return { entries, activities, activitiesError };
}

/**
 * The category bars on the analytics tab. Separate from readWorkProgress()
 * because only one of the two screens wants it, and because its failure is
 * the chart's problem, not the table's.
 */
export async function readCategoryProgress(
  projectId: string,
  signal?: AbortSignal
): Promise<ListOutcome<CategoryProgress>> {
  try {
    const body = await fetchJson<{ categories?: CategoryProgress[] }>(
      `/api/reports/category-progress?projectId=${encodeURIComponent(projectId)}`,
      { signal }
    );
    return listOutcomeFromRows(body.categories ?? []);
  } catch (err) {
    return listOutcomeFromError<CategoryProgress>(err);
  }
}

/**
 * The flat average the analytics tab shows, or null when there is nothing
 * honest to say. Null -- not 0 -- because 0 % is a claim about the work done
 * on site, and "we could not read the entries" is not that claim.
 */
export function averagePercentComplete(entries: ProgressEntry[]): number | null {
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, e) => sum + Number(e.percentComplete), 0);
  if (!Number.isFinite(total)) return null;
  return Math.round(total / entries.length);
}
