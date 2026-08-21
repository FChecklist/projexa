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
};

export type Activity = { id: string; categoryId: string; name: string; unit?: string | null };
export type Category = { id: string; name: string };

export type ProgressEntry = {
  id: string;
  activityId: string;
  entryDate: string; // "YYYY-MM-DD"
  quantityDone: string | number;
};

function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sumQtyInRange(entries: ProgressEntry[], activityId: string, predicate: (date: string) => boolean): { sum: number; touched: boolean } {
  const matches = entries.filter((e) => e.activityId === activityId && predicate(e.entryDate));
  return { sum: matches.reduce((s, e) => s + num(e.quantityDone), 0), touched: matches.length > 0 };
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
  qty: { prev: number; current: number; total: number };
  amt: { prev: number; current: number; total: number };
  percentage: { prev: number; current: number; total: number };
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

  const prevResult = line.activityId ? sumQtyInRange(entries, line.activityId, (d) => d < from) : { sum: 0, touched: false };
  const currentResult = line.activityId ? sumQtyInRange(entries, line.activityId, (d) => d >= from && d <= to) : { sum: 0, touched: false };
  const prevQty = prevResult.sum;
  const currentQty = currentResult.sum;
  const totalQty = prevQty + currentQty;
  const touched = { prev: prevResult.touched, current: currentResult.touched, total: prevResult.touched || currentResult.touched };

  const amtPrev = prevQty * rate;
  const amtCurrent = currentQty * rate;
  const amtTotal = totalQty * rate;

  const pct = (amt: number) => (amtTotalBoq > 0 ? Math.round((amt / amtTotalBoq) * 10000) / 100 : 0);

  return {
    lineItemId: line.id,
    parentLineItemId: line.parentLineItemId ?? null,
    code: line.itemCode ?? "",
    description: line.description,
    categoryId: category?.id ?? null,
    categoryName: category?.name ?? "Uncategorized",
    unit: line.unit,
    rate,
    qtyTotal: qtyTotalBoq,
    amtTotal: amtTotalBoq,
    qty: { prev: prevQty, current: currentQty, total: totalQty },
    amt: { prev: amtPrev, current: amtCurrent, total: amtTotal },
    percentage: { prev: pct(amtPrev), current: pct(amtCurrent), total: pct(amtTotal) },
    touched,
  };
}

export type CategoryRollup = {
  categoryId: string | null;
  categoryName: string;
  amtTotal: number;
  amt: { prev: number; current: number; total: number };
  percentage: { prev: number; current: number; total: number };
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
  return Array.from(groups.values()).map((g) => ({
    key: g.key,
    name: g.name,
    amtTotal: g.amtTotal,
    amt: { prev: g.prev, current: g.current, total: g.total },
    percentage: {
      prev: g.amtTotal > 0 ? Math.round((g.prev / g.amtTotal) * 10000) / 100 : 0,
      current: g.amtTotal > 0 ? Math.round((g.current / g.amtTotal) * 10000) / 100 : 0,
      total: g.amtTotal > 0 ? Math.round((g.total / g.amtTotal) * 10000) / 100 : 0,
    },
  }));
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

    const qty = { prev: cumQty((c) => c.qty.prev), current: cumQty((c) => c.qty.current), total: cumQty((c) => c.qty.total) };
    const amt = { prev: cumAmt((c) => c.qty.prev), current: cumAmt((c) => c.qty.current), total: cumAmt((c) => c.qty.total) };
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

    return { ...row, qty, amt, percentage: { prev: pct(amt.prev), current: pct(amt.current), total: pct(amt.total) }, touched };
  });
}

export type WorkProgressReport = {
  from: string;
  to: string;
  rows: LineItemProgress[]; // scope-wise: one row per BoQ line item (the base report itself)
  byCategory: ReturnType<typeof rollupBy>;
};

/** Builds the scope-wise (base) report plus its category-wise rollup for the [from, to] date range. */
export function buildWorkProgressReport(params: {
  lineItems: BoqLineItem[];
  entries: ProgressEntry[];
  activities: Activity[];
  categories: Category[];
  from: string;
  to: string;
}): WorkProgressReport {
  const activitiesById = new Map(params.activities.map((a) => [a.id, a]));
  const categoriesById = new Map(params.categories.map((c) => [c.id, c]));
  const lineItemsById = new Map(params.lineItems.map((l) => [l.id, l]));
  const ownRows = params.lineItems.map((line) =>
    computeLineItemProgress(line, params.entries, activitiesById, categoriesById, params.from, params.to)
  );
  const rows = applyWeightedParentRollup(ownRows, lineItemsById);
  const byCategory = rollupBy(
    rows,
    (r) => r.categoryId ?? "uncategorized",
    (r) => r.categoryName
  );
  return { from: params.from, to: params.to, rows, byCategory };
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
