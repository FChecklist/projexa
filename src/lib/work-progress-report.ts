// Work Progress Report (WPR) -- pure computation over data already fetched
// from VERIDIAN (BoQ line items + work-progress entries + attendance/labour
// roster/vendors). No I/O here on purpose: src/app/api/work-progress/report/
// route.ts does the fetching, this module just computes, so the exact
// Prev/Current/Total math is unit-testable without a live VERIDIAN call.
//
// Column spec (Owner-supplied, real, do not invent a different shape):
// S.No | Category | Code | Description | Qty[Unit | Rate | Amt] |
// Amt[Prev | Current | Total] | Percentage[Prev | Current | Total].
// The Percentage columns are ratios over the Amt columns (this line item's
// total BoQ value), not raw input:
//   Prev%  = amount done strictly BEFORE the report's `from` date / total BoQ amount
//   Current% = amount done WITHIN [from, to] / total BoQ amount
//   Total% = cumulative amount done up to and including `to` / total BoQ amount

import { formatDayMonthYearNumeric } from "./format-date";

export type BoqLineItem = {
  id: string;
  activityId: string | null;
  itemCode: string | null;
  description: string;
  unit: string;
  quantity: string | number;
  rate: string | number;
  amount: string | number;
  computedRate?: number | null;
  // R12 point 10: already present on VERIDIAN's v1 BOQ GET response (the
  // hierarchical-BOQ fields construction-boq-service.ts's line items always
  // carry), just never declared on this local type before -- so the field
  // was present on the wire and silently invisible to TypeScript here.
  parentLineItemId?: string | null;
  breakdownPercentage?: string | number | null;
  // R67 lane I (WS-I item I-05, R-177): the line's OWN category, from
  // compliance.construction_boq_line_items.category (drizzle/0532). This is
  // now the primary source of a row's categoryName -- see
  // computeLineItemProgress's own comment for the resolution order and why it
  // changed.
  category?: string | null;
};

export type Activity = { id: string; categoryId: string; name: string; unit?: string | null };
export type Category = { id: string; name: string };

// R67 lane I (WS-I item I-05, R-177): the bucket a line with no category at
// all falls into. ONE constant here and one in compliance-tracker's
// construction-reports-service.ts (UNCATEGORIZED_LABEL) -- they must stay the
// same word, or a Category filter chosen on this screen would not match the
// bucket the server-side report produces for the same rows.
export const UNCATEGORIZED_LABEL = "Uncategorized";

export type ProgressEntry = {
  id: string;
  activityId: string;
  // R12 point 7 (Option B, drizzle/0315): optional direct link to the BOQ
  // line the progress is actually against -- same field VERIDIAN's own
  // construction_work_progress_entries.boq_line_item_id column carries and
  // listProgressEntries() already returns on the wire, just never declared
  // on this local type before (same situation parentLineItemId was in on
  // BoqLineItem above). null for every pre-Option-B entry, which keeps
  // matching by activityId exactly as before -- see sumQtyInRange's
  // preference order.
  boqLineItemId?: string | null;
  entryDate: string; // "YYYY-MM-DD"
  quantityDone: string | number;
  // R39/R-46 (r39_wpr_entry_basis): 'DELTA' (default, additive -- summed
  // exactly as before) or 'SNAPSHOT' (cumulative-to-date, REPLACES rather
  // than sums -- see applySnapshotOverride below). Undefined/missing is
  // treated as 'DELTA', so every pre-migration entry and every existing
  // test fixture that never set this field behaves byte-for-byte as before.
  entryBasis?: "DELTA" | "SNAPSHOT" | string;
  percentComplete?: string | number;
  createdAt?: string;
};

function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// R12 point 7 (Option B): preference-order entry-to-line resolution -- an
// entry that carries boq_line_item_id is claimed EXCLUSIVELY by the line it
// names (never also falls through to the activityId rule below, for this
// line or any other -- that would count the same entry twice under two
// different rules). Only entries with no boq_line_item_id at all still
// resolve by activityId, exactly as before -- today's behavior, unchanged,
// for every line/entry that predates Option B.
function entryBelongsToLine(e: ProgressEntry, line: Pick<BoqLineItem, "id" | "activityId">): boolean {
  if (e.boqLineItemId) return e.boqLineItemId === line.id;
  return line.activityId !== null && e.activityId === line.activityId;
}

function isDelta(e: ProgressEntry): boolean {
  return e.entryBasis !== "SNAPSHOT"; // undefined/missing (every pre-R39 entry) counts as DELTA -- unchanged behavior
}

// R39/R-46: only DELTA entries are additive. A SNAPSHOT entry's quantityDone
// (if any) is NEVER summed here -- it is a cumulative-to-date reading, not a
// this-period delta, and blindly adding it would double-count exactly the
// way the schema's own ambiguity (quantity_done + percent_complete on one
// undiscriminated row) warned about. SNAPSHOT entries are picked up instead
// by latestSnapshot()/applySnapshotOverride() below.
function sumQtyInRange(entries: ProgressEntry[], line: Pick<BoqLineItem, "id" | "activityId">, predicate: (date: string) => boolean): { sum: number; touched: boolean } {
  const matches = entries.filter((e) => entryBelongsToLine(e, line) && isDelta(e) && predicate(e.entryDate));
  return { sum: matches.reduce((s, e) => s + num(e.quantityDone), 0), touched: matches.length > 0 };
}

// R39/R-46: the latest SNAPSHOT entry (by entryDate, then createdAt) for this
// line whose date satisfies `predicate` -- "latest" is the whole point of a
// replacing (not additive) reading, matching AIA G703 col G/C semantics.
function latestSnapshot(entries: ProgressEntry[], line: Pick<BoqLineItem, "id" | "activityId">, predicate: (date: string) => boolean): ProgressEntry | undefined {
  const matches = entries.filter((e) => entryBelongsToLine(e, line) && e.entryBasis === "SNAPSHOT" && predicate(e.entryDate));
  if (matches.length === 0) return undefined;
  return matches.reduce((latest, e) => {
    if (e.entryDate !== latest.entryDate) return e.entryDate > latest.entryDate ? e : latest;
    return (e.createdAt ?? "") > (latest.createdAt ?? "") ? e : latest;
  });
}

// Point 111 (WPR-14): his sheet distinguishes a value that was CALCULATED
// and came out zero (dash) from a cell for which NO progress entry exists
// at all (blank) -- both compute to the number 0 today and are otherwise
// indistinguishable on screen. `touched` on LineItemProgress/CategoryRollup
// carries that distinction alongside the existing numeric qty/amt/percentage
// fields (which are left exactly as they were -- this changes nothing about
// the arithmetic, including the weighted-parent-rollup and category-rollup
// totals, only what a caller CAN choose to render for a given number).
// formatProgressCell() is the one place that turns (value, touched) into
// what actually appears on screen -- "" for never-touched, "-" for a real
// computed zero, the raw number (for the caller to format "as today")
// otherwise.
export function formatProgressCell(value: number, touched: boolean): string | number {
  if (!touched) return "";
  if (value === 0) return "-";
  return value;
}

// CONS-05 (R46 P4 consistency sweep): WPR-06's own rule -- percentage cells
// are PARENT rows only; a hierarchical child always renders blank, never a
// number -- already shipped as one-off inline JSX inside
// WorkProgressReportClient.tsx's ScopeTable (`isChild ? "" : `${value}%`),
// with no shared, testable home. The public share-link page instead called
// formatProgressCell(value, touched) below, which answers a different
// question ("was this bucket ever logged at all?") and blanks an
// UNTOUCHED PARENT row exactly like a child row -- that mismatch is the
// real CONS-05 bug: a parent whose report window has no logged entries
// read blank on the share page but "0%" on the authenticated Report tab
// and the PDF export. `touched` is irrelevant to WPR-06's actual rule -- a
// parent line always renders a real number (0% included); only a child's
// cell is ever blank. Factored out here so the share page can apply the
// exact same rule the live tab already does, rather than re-deriving it.
export function formatParentOnlyPercent(value: number, isChild: boolean): string {
  return isChild ? "" : `${value}%`;
}

// CONS-04 (R46 P4 consistency sweep): the public share-link page's table
// previously carried no Rate/Contract-Amt/Grand-Total field at all (only
// Item/Prev%/Current%/Total%), unlike the Dashboard, the live Report tab,
// and (as of CONS-03) the PDF export. Grand Total sums root (non-child)
// lines' own amtTotal only -- the SAME D-3 "parent BOQ lines only" rule
// WorkProgressReportClient.tsx's own computeGrandTotal() and the CONS-03
// PDF fix both already use for this exact figure (a child's own amtTotal
// is a separate, informational number, never a portion carved out of its
// parent's -- see applyWeightedParentRollup's own comment above). Factored
// out here, once, so every consumer of this figure -- the live tab, the
// PDF, and now the share page -- stays computed by the identical rule
// instead of three independently hand-copied sums that could drift apart.
export function sumRootAmtTotal(rows: Pick<LineItemProgress, "amtTotal" | "parentLineItemId">[]): number {
  return rows.filter((r) => !r.parentLineItemId).reduce((s, r) => s + r.amtTotal, 0);
}

export type LineItemProgress = {
  lineItemId: string;
  parentLineItemId: string | null; // R12 point 10: which line this is a hierarchical BOQ child of, if any
  code: string;
  description: string;
  categoryId: string | null;
  categoryName: string;
  unit: string;
  rate: number;
  qtyTotal: number; // BoQ's total planned quantity for this line
  amtTotal: number; // BoQ's total value (qty * rate) for this line -- the denominator for Percentage
  qty: { prev: number; current: number; total: number; balance: number };
  amt: { prev: number; current: number; total: number; balance: number };
  percentage: { prev: number; current: number; total: number; balance: number };
  // Point 111 (WPR-14): whether ANY progress entry contributed to each
  // bucket -- false means never-touched (render blank), true with a 0 value
  // means a real computed zero (render a dash). Separate from qty/amt/
  // percentage on purpose so their existing {prev,current,total} shape
  // (and every existing toEqual() assertion against it) is unchanged.
  touched: { prev: boolean; current: boolean; total: boolean };
};

/** Computes one BoQ line item's Prev/Current/Total qty+amt+percentage for the [from, to] window. */
export function computeLineItemProgress(
  line: BoqLineItem,
  entries: ProgressEntry[],
  activitiesById: Map<string, Activity>,
  categoriesById: Map<string, Category>,
  from: string,
  to: string
): LineItemProgress {
  const rate = line.computedRate ?? num(line.rate);
  const qtyTotalBoq = num(line.quantity);
  const amtTotalBoq = num(line.amount) || qtyTotalBoq * rate;

  const activity = line.activityId ? activitiesById.get(line.activityId) : undefined;
  const category = activity ? categoriesById.get(activity.categoryId) : undefined;
  // R67 lane I (WS-I item I-05, R-177). CATEGORY RESOLUTION ORDER:
  //   1. the line's own `category` text (the new column);
  //   2. failing that, activityId -> activity.categoryId -> category.name
  //      (what this file did exclusively before, so every pre-existing
  //      categorised line reports exactly as it always has);
  //   3. failing both, "Uncategorized".
  // The direct column wins because most real lines have no activityId at all
  // -- an imported BOQ never does -- which is precisely why the Category-wise
  // tab used to put nearly everything in Uncategorized. Trimmed and
  // blank-checked so a stray "" can never masquerade as a real category name.
  const directCategory = typeof line.category === "string" && line.category.trim() !== "" ? line.category.trim() : null;

  // No `line.activityId ?` guard here anymore -- a line with no activityId
  // at all can still have real Option-B entries keyed by boq_line_item_id,
  // and entryBelongsToLine() already returns false for the activityId leg
  // when line.activityId is null, so this is safe for every pre-existing
  // (activityId-only) line too.
  const prevResult = sumQtyInRange(entries, line, (d) => d < from);
  const currentResult = sumQtyInRange(entries, line, (d) => d >= from && d <= to);
  let prevQty = prevResult.sum;
  let currentQty = currentResult.sum;
  let totalQty = prevQty + currentQty;
  let touched = { prev: prevResult.touched, current: currentResult.touched, total: prevResult.touched || currentResult.touched };

  let amtPrev = prevQty * rate;
  let amtCurrent = currentQty * rate;
  let amtTotal = totalQty * rate;

  const pct = (amt: number) => (amtTotalBoq > 0 ? Math.round((amt / amtTotalBoq) * 10000) / 100 : 0);

  let percentage = { prev: pct(amtPrev), current: pct(amtCurrent), total: pct(amtTotal), balance: pct(amtTotalBoq - amtTotal) };

  // R39/R-46 (TC-32) + SNAPSHOT progress-entry bug (R46 L2 01): a SNAPSHOT
  // entry (30% then 60%, both rows kept in history -- createProgressEntry
  // never overwrites, only inserts) reports whatever the LATEST reading
  // says, replacing rather than adding -- and that now applies to qty/amt
  // exactly as it already applied to percentage, not just percentage alone.
  // schema.ts's own R39/R-46 comment (construction_work_progress_entries)
  // is explicit that quantity_done and percent_complete are "two mutually
  // exclusive measurement bases": for a SNAPSHOT row the meaningful,
  // authoritative reading is the cumulative-to-date PERCENTAGE (G703 col
  // G/C) -- quantity_done on a SNAPSHOT row is not a this-period delta and
  // is not guaranteed to be a populated/authoritative figure (every existing
  // SNAPSHOT fixture in this file's own TC-32 tests carries quantityDone: 0
  // for exactly this reason). So qty/amt for a SNAPSHOT-basis line are
  // derived FROM the already-resolved percentage (qty = pct/100 * qtyTotal,
  // amt = pct/100 * amtTotal) rather than from that entry's own
  // quantityDone -- this is what keeps qty/amt/percentage mutually
  // consistent by construction, and is the literal meaning of "the same
  // entry_basis-aware logic already used for percentage": one resolved
  // reading, expressed in all three units, not three independent readings
  // that can drift apart. Scoped to a line that actually has a SNAPSHOT
  // entry -- a line with zero SNAPSHOT entries (every T-WPR-03/TC-30/
  // existing-test line) takes neither branch and produces byte-identical
  // output to before this change.
  const snapTotal = latestSnapshot(entries, line, (d) => d <= to);
  if (snapTotal) {
    const snapPrev = latestSnapshot(entries, line, (d) => d < from);
    const totalPct = num(snapTotal.percentComplete);
    const prevPct = snapPrev ? num(snapPrev.percentComplete) : 0;
    const currentPct = Math.round((totalPct - prevPct) * 100) / 100;
    percentage = { prev: prevPct, current: currentPct, total: totalPct, balance: Math.round((100 - totalPct) * 100) / 100 };
    touched = { prev: !!snapPrev, current: true, total: true };

    prevQty = (percentage.prev / 100) * qtyTotalBoq;
    currentQty = (percentage.current / 100) * qtyTotalBoq;
    totalQty = (percentage.total / 100) * qtyTotalBoq;
    amtPrev = (percentage.prev / 100) * amtTotalBoq;
    amtCurrent = (percentage.current / 100) * amtTotalBoq;
    amtTotal = (percentage.total / 100) * amtTotalBoq;
  }

  // Point 11 (Rajat, 21 Aug: "SHOW BOTH TOTAL AND BALANCE, USER CHOOSES --
  // it's a mathematical formula"): balance = original (this line's own BoQ
  // total) - total (previous + current). Both are legitimate readings of
  // the same three stored numbers -- nothing new is persisted. Oracle:
  // his Gypsum Board 01 row shows 300 + 100 with a third column of 72, and
  // 472 - 400 = 72. (percentage.balance was already set above -- via
  // pct(amtTotalBoq - amtTotal) on the DELTA path, or directly from
  // percentComplete on the SNAPSHOT path -- both read the SAME final
  // amtTotal used here, so qty/amt/percentage balance stay consistent too.)
  const qtyBalance = qtyTotalBoq - totalQty;
  const amtBalance = amtTotalBoq - amtTotal;

  return {
    lineItemId: line.id,
    parentLineItemId: line.parentLineItemId ?? null,
    code: line.itemCode ?? "",
    description: line.description,
    // A direct-category row has no constructionCategories id behind it, so
    // categoryId stays null and the roll-up groups it by NAME instead (see
    // buildWorkProgressReport's grouping key) -- never by a fabricated id.
    categoryId: directCategory ? null : (category?.id ?? null),
    categoryName: directCategory ?? category?.name ?? UNCATEGORIZED_LABEL,
    unit: line.unit,
    rate,
    qtyTotal: qtyTotalBoq,
    amtTotal: amtTotalBoq,
    qty: { prev: prevQty, current: currentQty, total: totalQty, balance: qtyBalance },
    amt: { prev: amtPrev, current: amtCurrent, total: amtTotal, balance: amtBalance },
    percentage,
    touched,
  };
}

export type CategoryRollup = {
  categoryId: string | null;
  categoryName: string;
  amtTotal: number;
  amt: { prev: number; current: number; total: number; balance: number };
  percentage: { prev: number; current: number; total: number; balance: number };
};

function rollupBy<T>(rows: LineItemProgress[], keyFn: (r: LineItemProgress) => T, nameFn: (r: LineItemProgress) => string) {
  const groups = new Map<string, { key: T; name: string; amtTotal: number; prev: number; current: number; total: number }>();
  for (const r of rows) {
    const key = keyFn(r);
    const mapKey = String(key);
    const g = groups.get(mapKey) ?? { key, name: nameFn(r), amtTotal: 0, prev: 0, current: 0, total: 0 };
    g.amtTotal += r.amtTotal;
    g.prev += r.amt.prev;
    g.current += r.amt.current;
    g.total += r.amt.total;
    groups.set(mapKey, g);
  }
  return Array.from(groups.values()).map((g) => {
    const balance = g.amtTotal - g.total;
    const pct = (a: number) => (g.amtTotal > 0 ? Math.round((a / g.amtTotal) * 10000) / 100 : 0);
    return {
      key: g.key,
      name: g.name,
      amtTotal: g.amtTotal,
      amt: { prev: g.prev, current: g.current, total: g.total, balance },
      percentage: { prev: pct(g.prev), current: pct(g.current), total: pct(g.total), balance: pct(balance) },
    };
  });
}

/**
 * R12 point 10: weighted parent roll-up. computeLineItemProgress() above
 * only ever computes a line's OWN directly-recorded progress from its own
 * activityId -- it knows nothing about hierarchical BOQ children (Main ->
 * Sub-Task). When a line has children (other lines whose parentLineItemId
 * points at it), its Qty/Amt/Percentage are REPLACED by a weighted roll-up
 * of those children:
 *   cum qty = SUM(child cum qty * child breakdownPercentage / 100)
 *   cum amt = PLAIN SUM of child cum amts -- each child's own cum amt here
 *             is computed with a DERIVED rate (the PARENT's own rate *
 *             that child's breakdownPercentage / 100), not the child's own
 *             stored rate (typically 0/unset for a hierarchical sub-task
 *             row -- see construction-boq-service.ts's insertLineItems,
 *             which stores a child's raw input quantity/rate verbatim,
 *             usually blank/0 on a real prospect BoQ export, and computes
 *             `amount` separately via the hierarchical formula). The
 *             weighting is applied exactly ONCE, inside that derived rate
 *             -- summing plainly after that is what "never re-weight"
 *             means; multiplying by breakdownPercentage a second time
 *             here would double-apply it.
 *   percent  = cum amt / parent's own total BOQ amount
 * Deliberately done here, as a roll-up over rows, rather than by mutating
 * each child row's own rate/amt in place: every child row keeps reading
 * its own real BOQ-stored qty/rate/amt figures untouched, so byCategory's
 * plain sum-of-every-row still adds up correctly with no double count --
 * a child's own (small/zero) amt contributes once, and the parent's new
 * weighted total is the only place the full weighted value appears.
 * IF a line has no parentLineItemId THEN it is a parent by definition and
 * is never anyone's own child (never grouped as such below). IF a parent
 * has no children (e.g. items 2.01/2.06) it is returned completely
 * unchanged -- its own directly-recorded progress stands.
 *
 * KNOWN LIMITATION (cycle 2, R12 point 10): only ONE level of nesting is
 * rolled up correctly. Every acceptance figure and oracle datapoint given
 * across every run so far is a flat Main -> Sub-Task pair; none exercise a
 * THREE-level chain (Main -> Sub -> Sub-sub). For a middle node, this
 * function weights its children against ITS OWN `rate` field -- but a
 * hierarchical child's own stored `rate` is typically 0 (see the comment
 * above), so a middle node with its own children would roll up to 0, not
 * a real number. construction-boq-service.ts's OWN computeHierarchicalAmount
 * establishes the relevant convention already (a descendant's amount is
 * ROOT-ancestor qty*rate times THAT DESCENDANT'S OWN breakdownPercentage,
 * never compounded through intermediate levels) -- extending this function
 * to match would mean weighting every descendant against its ROOT
 * ancestor's rate directly, not cascading level by level. Deliberately NOT
 * implemented here without a real 3-level oracle figure to validate
 * against (there is a real, non-trivial design question -- does a
 * mid-level node get its own separate rolled-up total at all, or only the
 * ultimate root? -- that no run's oracle data answers). See the
 * corresponding test below for what actually happens today.
 */
function applyWeightedParentRollup(rows: LineItemProgress[], lineItemsById: Map<string, BoqLineItem>): LineItemProgress[] {
  const childrenByParentId = new Map<string, LineItemProgress[]>();
  for (const row of rows) {
    const parentId = lineItemsById.get(row.lineItemId)?.parentLineItemId;
    if (!parentId) continue;
    const list = childrenByParentId.get(parentId) ?? [];
    list.push(row);
    childrenByParentId.set(parentId, list);
  }

  return rows.map((row) => {
    const children = childrenByParentId.get(row.lineItemId);
    if (!children || children.length === 0) return row;

    const breakdownPctOf = (child: LineItemProgress) => num(lineItemsById.get(child.lineItemId)?.breakdownPercentage);

    const cumQty = (pick: (c: LineItemProgress) => number) =>
      children.reduce((sum, c) => sum + pick(c) * (breakdownPctOf(c) / 100), 0);

    // Each child's own cum amt = child cum qty * derived rate (parent's
    // rate weighted by that child's breakdown %) -- then plainly summed.
    const cumAmt = (pick: (c: LineItemProgress) => number) =>
      children.reduce((sum, c) => sum + pick(c) * (row.rate * (breakdownPctOf(c) / 100)), 0);

    const totalQty = cumQty((c) => c.qty.total);
    const totalAmt = cumAmt((c) => c.qty.total);
    // Point 11: same balance = original - total formula as computeLineItemProgress,
    // against the PARENT's own unchanged qtyTotal/amtTotal (its own BoQ contract),
    // not any child's.
    const qty = { prev: cumQty((c) => c.qty.prev), current: cumQty((c) => c.qty.current), total: totalQty, balance: row.qtyTotal - totalQty };
    const amt = { prev: cumAmt((c) => c.qty.prev), current: cumAmt((c) => c.qty.current), total: totalAmt, balance: row.amtTotal - totalAmt };
    const pct = (a: number) => (row.amtTotal > 0 ? Math.round((a / row.amtTotal) * 10000) / 100 : 0);
    // A parent is "touched" for a bucket iff ANY child was touched for that
    // same bucket -- its own weighted total is a real computed zero (dash)
    // when children exist but none had entries in that window, and only
    // ever blank (never-touched) if not one of its children was ever touched.
    const touched = {
      prev: children.some((c) => c.touched.prev),
      current: children.some((c) => c.touched.current),
      total: children.some((c) => c.touched.total),
    };

    return { ...row, qty, amt, percentage: { prev: pct(amt.prev), current: pct(amt.current), total: pct(amt.total), balance: pct(amt.balance) }, touched };
  });
}

export type WorkProgressReport = {
  from: string;
  to: string;
  rows: LineItemProgress[]; // scope-wise: one row per BoQ line item (the base report itself)
  byCategory: ReturnType<typeof rollupBy>;
  /** R67 I-05: every category name present BEFORE the filter was applied -- what the multi-select offers. */
  availableCategories: string[];
  /**
   * R67 B-09 -- how many entries in this window resolve to NO BOQ line at
   * all, and are therefore absent from every figure above.
   *
   * This report has always silently dropped them: entryBelongsToLine()
   * claims an entry for a line by boq_line_item_id or, failing that, by
   * activity, and an entry matching neither simply never appears in any
   * row. On a project with no BOQ that is the whole day's work. Counting
   * them here is what lets the screen say so instead of showing a total the
   * site engineer knows is wrong and cannot explain.
   */
  unlinkedEntryCount: number;
};

/**
 * Entries inside [from, to] that no line item in this BOQ can claim. Pure and
 * exported so the rule is testable on its own, and so the number the note
 * quotes is computed by the same predicate the report itself uses -- not by a
 * second, drifting definition of "linked".
 */
export function countUnlinkedEntries(params: {
  lineItems: Pick<BoqLineItem, "id" | "activityId">[];
  entries: ProgressEntry[];
  from: string;
  to: string;
}): number {
  return params.entries.filter(
    (e) => inRange(e.entryDate, params.from, params.to) && !params.lineItems.some((line) => entryBelongsToLine(e, line))
  ).length;
}

/**
 * The sentence shown above the table. null when there is nothing to say --
 * a note that renders "0 entries ..." is noise, and the commonest case is
 * zero.
 */
export function unlinkedEntriesNote(count: number): string | null {
  if (count <= 0) return null;
  if (count === 1) return "1 entry not linked to a BOQ line is not counted";
  return `${count} entries not linked to a BOQ line are not counted`;
}

/**
 * R67 lane I (WS-I item I-05, R-177): keeps only the rows whose category is in
 * `categoryFilter`. Case-insensitive, matching compliance-tracker's own
 * rollUpLinesByCategory -- a line imported as "civil" must not silently
 * disappear from a "Civil" filter, which would be a MISSING ROW in a money
 * report. An empty or all-blank filter means every category, never none:
 * returning an empty report there would look exactly like "this project has no
 * BOQ", a different and much more alarming fact.
 */
export function filterRowsByCategory(rows: LineItemProgress[], categoryFilter?: string[]): LineItemProgress[] {
  const cleaned = (categoryFilter ?? []).map((c) => c.trim().toLowerCase()).filter((c) => c !== "");
  if (cleaned.length === 0) return rows;
  const wanted = new Set(cleaned);
  return rows.filter((r) => wanted.has(r.categoryName.toLowerCase()));
}

/** Builds the scope-wise (base) report plus its category-wise rollup for the [from, to] date range. */
export function buildWorkProgressReport(params: {
  lineItems: BoqLineItem[];
  entries: ProgressEntry[];
  activities: Activity[];
  categories: Category[];
  from: string;
  to: string;
  /** R67 I-05: applied server-side, before the rollup, so subtotals and the Grand Total both describe the filtered set. */
  categoryFilter?: string[];
}): WorkProgressReport {
  const activitiesById = new Map(params.activities.map((a) => [a.id, a]));
  const categoriesById = new Map(params.categories.map((c) => [c.id, c]));
  const lineItemsById = new Map(params.lineItems.map((l) => [l.id, l]));
  const ownRows = params.lineItems.map((line) =>
    computeLineItemProgress(line, params.entries, activitiesById, categoriesById, params.from, params.to)
  );
  // The weighted parent roll-up runs over EVERY row, before filtering: a
  // parent's numbers come from its children, so filtering first would silently
  // change a parent's total whenever a child sat in another category.
  const allRows = applyWeightedParentRollup(ownRows, lineItemsById);
  const availableCategories = [...new Set(allRows.map((r) => r.categoryName))].sort((a, b) => {
    if (a === UNCATEGORIZED_LABEL) return 1;
    if (b === UNCATEGORIZED_LABEL) return -1;
    return a.localeCompare(b);
  });
  const rows = filterRowsByCategory(allRows, params.categoryFilter);
  const byCategory = rollupBy(
    rows,
    // R67 I-05: grouped by categoryId when there is one, else by the category
    // NAME -- a direct-category row has no constructionCategories id, and
    // collapsing every one of them onto the single "uncategorized" key (what
    // `r.categoryId ?? "uncategorized"` alone would do) would merge Civil,
    // Gypsum and Paint into one bucket the moment the new column is populated.
    (r) => r.categoryId ?? `name:${r.categoryName.toLowerCase()}`,
    (r) => r.categoryName
  );
  return {
    from: params.from,
    to: params.to,
    rows,
    byCategory,
    availableCategories,
    // R67 B-09: counted over the UNFILTERED entry set, deliberately -- an
    // entry no line can claim is missing from the report whatever category
    // filter is applied, so scoping this to the filter would understate it.
    unlinkedEntryCount: countUnlinkedEntries({
      lineItems: params.lineItems,
      entries: params.entries,
      from: params.from,
      to: params.to,
    }),
  };
}

// -- Manpower-wise / Vendor-wise --------------------------------------------
// No progress entry anywhere in this system carries a vendor/roster
// attribution (confirmed absent -- see PROGRESS.md); VERIDIAN's OWN real
// manpowerCostReport/vendorCostReport (construction-reports-service.ts)
// already establish the precedent that these breakdowns are attendance-cost
// based for the project/date-range, not per-line attribution -- followed
// here rather than inventing a fake per-line link.

export type Attendance = { id: string; rosterId: string; attendanceDate: string; dailyCost: string | number };
export type LabourRoster = { id: string; trade: string | null; vendorId: string | null; name: string };
export type Vendor = { id: string; name: string };

function inRange(date: string, from: string, to: string) {
  return date >= from && date <= to;
}

export type ManpowerRow = { trade: string; workerDays: number; totalCost: number };

export function buildManpowerBreakdown(params: { roster: LabourRoster[]; attendance: Attendance[]; from: string; to: string }): ManpowerRow[] {
  const rosterById = new Map(params.roster.map((r) => [r.id, r]));
  const groups = new Map<string, ManpowerRow>();
  for (const a of params.attendance) {
    if (!inRange(a.attendanceDate, params.from, params.to)) continue;
    const trade = rosterById.get(a.rosterId)?.trade ?? "Unspecified";
    const g = groups.get(trade) ?? { trade, workerDays: 0, totalCost: 0 };
    g.workerDays += 1;
    g.totalCost += num(a.dailyCost);
    groups.set(trade, g);
  }
  return Array.from(groups.values());
}

export type VendorRow = { vendorId: string; vendorName: string; totalCost: number };

export function buildVendorBreakdown(params: { roster: LabourRoster[]; attendance: Attendance[]; vendors: Vendor[]; from: string; to: string }): VendorRow[] {
  const rosterById = new Map(params.roster.map((r) => [r.id, r]));
  const vendorsById = new Map(params.vendors.map((v) => [v.id, v]));
  const groups = new Map<string, VendorRow>();
  for (const a of params.attendance) {
    if (!inRange(a.attendanceDate, params.from, params.to)) continue;
    const vendorId = rosterById.get(a.rosterId)?.vendorId;
    if (!vendorId) continue;
    const g = groups.get(vendorId) ?? { vendorId, vendorName: vendorsById.get(vendorId)?.name ?? vendorId, totalCost: 0 };
    g.totalCost += num(a.dailyCost);
    groups.set(vendorId, g);
  }
  return Array.from(groups.values());
}

// ---------------------------------------------------------------------------
// R67 D-28 (R-069): the blast radius of deleting one progress entry.
//
// Deleting a progress entry silently moves a project's completion figure. The
// object page's confirmation therefore has to state, before the click, what
// the running total actually becomes -- and it must state it using the SAME
// arithmetic the report and the PDF use, not a second rule invented for a
// dialog. So this reuses computeLineItemProgress() verbatim, twice: once over
// the entries as they are, once over the entries with this one removed. That
// automatically inherits the DELTA/SNAPSHOT convention, the boq_line_item_id
// preference order, and the amount-weighted percentage, and it cannot drift
// from them because there is nothing here to drift.
//
// The window is deliberately unbounded: "running total" means everything ever
// recorded against this target, not a report period, so `total` is the reading
// we want and every entry must fall inside [from, to].
const ALL_TIME_FROM = "0000-01-01";
const ALL_TIME_TO = "9999-12-31";

export type ProgressDeleteImpact = {
  /** The quantity this entry carries -- always known, even with no BOQ line. */
  quantity: number;
  /** BOQ line unit when the entry names a line, else the activity's, else null. */
  unit: string | null;
  entryDate: string;
  /** The BOQ line's item code, or null for an activity-only entry. */
  lineCode: string | null;
  /**
   * Running total before and after, as a percentage of the line's contracted
   * amount. BOTH are null when the entry names no BOQ line (or the line
   * carries no contracted amount): there is no denominator, so a percentage
   * would be a fabricated number and the confirmation says so instead.
   */
  percentBefore: number | null;
  percentAfter: number | null;
};

export function describeProgressDeleteImpact(params: {
  entry: ProgressEntry;
  /** Every entry currently known for this project -- filtering to the right target is this function's job, not the caller's. */
  entries: ProgressEntry[];
  /** The BOQ line the entry names, when it names one and its figures are known. */
  line: BoqLineItem | null;
  unit: string | null;
}): ProgressDeleteImpact {
  const { entry, entries, line, unit } = params;
  const quantity = num(entry.quantityDone);

  if (!line) {
    return { quantity, unit, entryDate: entry.entryDate, lineCode: null, percentBefore: null, percentAfter: null };
  }

  const noActivities = new Map<string, Activity>();
  const noCategories = new Map<string, Category>();
  const before = computeLineItemProgress(line, entries, noActivities, noCategories, ALL_TIME_FROM, ALL_TIME_TO);
  const remaining = entries.filter((e) => e.id !== entry.id);
  const after = computeLineItemProgress(line, remaining, noActivities, noCategories, ALL_TIME_FROM, ALL_TIME_TO);

  // A line with no contracted amount has no denominator: computeLineItemProgress
  // answers 0 for every percentage in that case, which would read as a real
  // "drops from 0% to 0%" rather than as "unknown". Say unknown.
  const hasDenominator = (num(line.amount) || num(line.quantity) * (line.computedRate ?? num(line.rate))) > 0;

  return {
    quantity,
    unit: unit ?? line.unit ?? null,
    entryDate: entry.entryDate,
    lineCode: line.itemCode ?? null,
    percentBefore: hasDenominator ? before.percentage.total : null,
    percentAfter: hasDenominator ? after.percentage.total : null,
  };
}

/**
 * R67 D-28: the delete confirmation's own sentence, in one place, so the
 * dialog can never say something the arithmetic above does not support.
 * `fallbackLabel` names the target when the entry has no BOQ line to name
 * (the activity's name), because "against nothing" is not a sentence.
 */
export function progressDeleteConfirmSentence(impact: ProgressDeleteImpact, fallbackLabel: string): string {
  const unit = impact.unit ? ` ${impact.unit}` : "";
  const target = impact.lineCode ?? fallbackLabel;
  const head = `This removes ${impact.quantity}${unit} logged on ${formatDayMonthYearNumeric(impact.entryDate)} against ${target}`;
  // No denominator means no honest percentage. Say what IS known and stop --
  // never print "from 0% to 0%", which reads as a real, measured reading.
  if (impact.percentBefore === null || impact.percentAfter === null) return `${head}. This cannot be undone.`;
  return `${head}; the running total drops from ${impact.percentBefore}% to ${impact.percentAfter}%.`;
}

/** What a row shows when the entry names no BOQ line at all. */
export const NO_BOQ_LINE_LABEL = "–";

/**
 * R67 D-28: "R60SK-A — R60 skiphop sub", or an en-dash when the entry names no
 * BOQ line. One function, so the list cell, the object page's facet and its
 * subtitle cannot render the same entry three ways -- and so neither of them
 * ever falls back to printing a raw id, which is what the list used to do for
 * any entry recorded against a revision the screen had not fetched.
 *
 * R67 INTEGRATION: F-24 shipped the SAME join first, inline in
 * WorkProgressListClient, with an EM dash. Two functions at two separators is
 * exactly what this one exists to prevent, so the component's copy now
 * delegates here and the em dash wins -- item codes themselves contain hyphens
 * ("R60SK-A"), which makes a hyphen separator genuinely ambiguous. D-28's own
 * test string is corrected to the merged separator rather than dropped.
 */
export function boqLineLabel(itemCode: string | null | undefined, description: string | null | undefined): string {
  if (!itemCode && !description) return NO_BOQ_LINE_LABEL;
  if (!itemCode) return description!;
  if (!description) return itemCode;
  return `${itemCode} — ${description}`;
}
