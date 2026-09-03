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

import { fetchJson } from "@/lib/fetch-json";
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
};

export type ProgressActivity = { id: string; name: string; categoryId?: string | null };
export type ProgressLineItem = { id: string; itemCode: string | null; description: string };
export type CategoryProgress = { categoryId: string; name: string; percentComplete: number };

export type WorkProgressReadResult = {
  /**
   * The entries read. This is the outcome, not an array -- so a caller
   * physically cannot reach "there are none" without a 200 having happened.
   */
  entries: ListOutcome<ProgressEntry>;
  /**
   * The lookups. A failure here is NOT fatal: the list still renders, with
   * the activity's own id in place of its name, which is what the screens
   * already did for an id the lookup did not contain. So these are plain
   * arrays, empty on failure, and the entry read alone decides the pane.
   */
  activities: ProgressActivity[];
  lineItems: ProgressLineItem[];
};

/**
 * One read for both Work Progress screens.
 *
 * The entry list and the two lookups are issued together, because they are
 * independent and running them in series is the same serial-hop latency
 * decision D-04 measured on /scope and /labour. The BOQ line items need the
 * BOQ list first, so that pair stays sequential -- there is no way to know
 * which revision to open before the list answers.
 */
export async function readWorkProgress(
  projectId: string,
  signal?: AbortSignal
): Promise<WorkProgressReadResult> {
  const q = `projectId=${encodeURIComponent(projectId)}`;

  const [entriesR, activitiesR, boqsR] = await Promise.allSettled([
    fetchJson<{ entries?: ProgressEntry[] }>(`/api/work-progress?${q}`, { signal }),
    fetchJson<{ activities?: ProgressActivity[] }>(`/api/work-progress/activities?${q}`, { signal }),
    fetchJson<{ boqs?: BoqSummary[] }>(`/api/scope?${q}`, { signal }),
  ]);

  const entries: ListOutcome<ProgressEntry> =
    entriesR.status === "fulfilled"
      ? listOutcomeFromRows(entriesR.value.entries ?? [])
      : listOutcomeFromError<ProgressEntry>(entriesR.reason);

  const activities = activitiesR.status === "fulfilled" ? (activitiesR.value.activities ?? []) : [];

  let lineItems: ProgressLineItem[] = [];
  if (boqsR.status === "fulfilled") {
    const current = pickCurrentBoq(boqsR.value.boqs ?? []);
    if (current) {
      try {
        const boq = await fetchJson<{ lineItems?: ProgressLineItem[] }>(
          `/api/scope/${encodeURIComponent(current.id)}`,
          { signal }
        );
        lineItems = boq.lineItems ?? [];
      } catch {
        // A missing line-item lookup degrades the BOQ column to the raw id,
        // which the screens already handled. It must not take the entry list
        // -- which succeeded -- down with it.
        lineItems = [];
      }
    }
  }

  return { entries, activities, lineItems };
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
