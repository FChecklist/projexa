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

function sumQtyInRange(entries: ProgressEntry[], activityId: string, predicate: (date: string) => boolean): number {
  return entries
    .filter((e) => e.activityId === activityId && predicate(e.entryDate))
    .reduce((s, e) => s + num(e.quantityDone), 0);
}

export type LineItemProgress = {
  lineItemId: string;
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

  const prevQty = line.activityId ? sumQtyInRange(entries, line.activityId, (d) => d < from) : 0;
  const currentQty = line.activityId ? sumQtyInRange(entries, line.activityId, (d) => d >= from && d <= to) : 0;
  const totalQty = prevQty + currentQty;

  const amtPrev = prevQty * rate;
  const amtCurrent = currentQty * rate;
  const amtTotal = totalQty * rate;

  const pct = (amt: number) => (amtTotalBoq > 0 ? Math.round((amt / amtTotalBoq) * 10000) / 100 : 0);

  return {
    lineItemId: line.id,
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
  const rows = params.lineItems.map((line) =>
    computeLineItemProgress(line, params.entries, activitiesById, categoriesById, params.from, params.to)
  );
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
