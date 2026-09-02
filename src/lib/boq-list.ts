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
//    a failure teaches a reader to distrust the colour everywhere else. WS-G's
//    rule is followed literally here: draft = grey outline + word, superseded =
//    grey filled + glyph + word, approved = sage + tick + word, rose ONLY for
//    rejected or late.
//
// Pure, and in its own file, so both rules are unit-provable without rendering
// a table.

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

export type BoqPillGlyph = "none" | "tick" | "archive" | "clock" | "alert";

export type BoqStatusPill = {
  /** The status word itself -- every pill shows the word, never a bare colour. */
  label: string;
  glyph: BoqPillGlyph;
  className: string;
};

// Grey outline, grey fill, sage, amber, rose -- named once so a reader can see
// at a glance that only the last one is a failure colour.
const GREY_OUTLINE = "border border-px-border2 bg-transparent text-px-muted";
const GREY_FILLED = "border border-px-border2 bg-px-cloud text-px-slate";
const SAGE = "border border-px-success-border bg-px-success-light text-px-success";
const AMBER = "border border-px-warning-border bg-px-warning-light text-px-warning";
const ROSE = "border border-px-error-border bg-px-error-light text-px-error";

const PILLS: Record<string, BoqStatusPill> = {
  // Not started, nothing wrong: the quietest pill on the screen.
  draft: { label: "draft", glyph: "none", className: GREY_OUTLINE },
  // Waiting on a person -- amber, because it is neither done nor failed.
  submitted: { label: "submitted", glyph: "clock", className: AMBER },
  approved: { label: "approved", glyph: "tick", className: SAGE },
  // Historical, not failed. Grey, filled, with the archive glyph.
  superseded: { label: "superseded", glyph: "archive", className: GREY_FILLED },
  // The only two things rose is for.
  rejected: { label: "rejected", glyph: "alert", className: ROSE },
  late: { label: "late", glyph: "alert", className: ROSE },
};

/** Pure: the pill for a BOQ status. An unrecognised status is neutral, never rose. */
export function boqStatusPill(status: string): BoqStatusPill {
  return PILLS[status] ?? { label: status, glyph: "none", className: GREY_OUTLINE };
}

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
