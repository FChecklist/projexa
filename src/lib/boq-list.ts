// R67 lane D22 (item D-76, rec R-288): how the BOQ list orders itself, and
// what a status pill is allowed to look like.
//
// TWO REAL DEFECTS THIS FIXES.
//
// 1. ORDER. /scope printed BOQs in whatever order the backend returned them,
//    so a revision you had just created could appear anywhere in the list --
//    including below the Rev0 it supersedes. The newest BOQ is the one you
//    came to look at, so the list is newest-first by default, with an explicit
//    Version toggle for the other question a QS asks ("show me the revisions
//    in order").
//
// 2. COLOUR. "superseded" was rendered with the destructive (rose) badge
//    variant. Rose in this system means REJECTED or LATE -- something is
//    wrong and somebody has to act. A superseded revision is neither: it is
//    the ordinary, expected consequence of raising Rev2, and colouring it like
//    a failure teaches a reader to distrust the colour everywhere else. The
//    tones themselves belong to WS-G's src/components/ui/status-pill.tsx --
//    the one map in this app that turns a status into a tone, a glyph and a
//    word. What lives here is only the BOQ's own vocabulary and the rule that
//    none of it may reach the rose tone.
//
// Pure, and in its own file, so both rules are unit-provable without rendering
// a table.

import type { SemanticStatus } from "@/components/ui/status-pill";

export type BoqSortField = "createdAt" | "version";
export type BoqSortDir = "asc" | "desc";
export type BoqSort = { field: BoqSortField; dir: BoqSortDir };

/** Newest first. The BOQ you just created, or the revision just raised, is the row you came for. */
export const DEFAULT_BOQ_SORT: BoqSort = { field: "createdAt", dir: "desc" };

type SortableBoq = { createdAt: string; version: number };

/**
 * Pure: the list in display order.
 *
 * Ties on createdAt break by version, descending -- an import or a revision
 * raised in the same second as its parent must still read in a sane order, and
 * a stable-looking list that reshuffles on reload is its own bug.
 */
export function sortBoqs<T extends SortableBoq>(boqs: readonly T[], sort: BoqSort = DEFAULT_BOQ_SORT): T[] {
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...boqs].sort((a, b) => {
    if (sort.field === "version") {
      if (a.version !== b.version) return (a.version - b.version) * factor;
      return (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * factor;
    }
    const at = Date.parse(a.createdAt);
    const bt = Date.parse(b.createdAt);
    if (at !== bt) return (at - bt) * factor;
    return (a.version - b.version) * factor;
  });
}

/**
 * Pure: what pressing a sortable column header does.
 *
 * Pressing the column already sorted flips its direction; pressing a different
 * one starts it at the direction that column is actually useful in -- newest
 * first for a date, highest revision first for a version. Nobody opens a BOQ
 * list wanting Rev0 at the top.
 */
export function nextBoqSort(current: BoqSort, field: BoqSortField): BoqSort {
  if (current.field === field) return { field, dir: current.dir === "asc" ? "desc" : "asc" };
  return { field, dir: "desc" };
}

/**
 * A BOQ's own status words, mapped onto the app-wide status vocabulary.
 *
 * R67 lane D22 (item D-76) first shipped its own pill function here, with its
 * own tone table and its own Tailwind class strings. That was a SECOND mapping
 * for one vocabulary: origin/main already carries
 * src/components/ui/status-pill.tsx (R67 WS-G), whose STATUS_MAP is the single
 * place a status becomes a tone, a glyph and a word -- the very rule D-76's own
 * change text cited. Two maps drift the first time a status is added, so the
 * tones are gone from here and only the BOQ's own vocabulary remains: which
 * words this backend really emits, and what each one means.
 *
 * "submitted" and "approved" are BOQ words the shared map has no key for, which
 * is exactly why this translation exists rather than handing the raw status to
 * StatusPillFor: without it both would fall through to neutral, and a BOQ
 * awaiting approval would look identical to one nobody has touched.
 *
 * Nothing here maps to "late", the only rose tone. A superseded revision is
 * history, not a fault -- which is the whole of defect 2 above, now enforced by
 * what this map is ALLOWED to contain rather than by a second colour table.
 */
export const BOQ_SEMANTIC_STATUS: Record<string, SemanticStatus> = {
  draft: "draft",
  submitted: "running",
  approved: "current",
  superseded: "superseded",
};

/**
 * Pure: this row's variation against its parent revision.
 *
 * DE-15 widens GET /api/scope so each BOQ carries its own variation, which
 * removes the N+1 /compare call this list makes per revision. That payload is
 * not on this branch, so the field is read WHEN PRESENT and the per-row
 * compare result is used otherwise -- the list is correct either way and gets
 * faster on its own the day DE-15 lands, with no second change here.
 */
export function boqVariation(
  boq: { id: string; parentBoqId: string | null; totalVariation?: number | null; variation?: number | null },
  fetched: Record<string, number>
): number | undefined {
  if (!boq.parentBoqId) return undefined;
  if (typeof boq.totalVariation === "number") return boq.totalVariation;
  if (typeof boq.variation === "number") return boq.variation;
  return fetched[boq.id];
}
