// R67 E-26 (R-212). The arithmetic and the wording behind the Cost variance
// screen, kept out of the component so both can be tested without a DOM.
//
// WHAT WAS WRONG. Three things, all visible on one screen.
//
// 1. THE TOTALS DOUBLE-COUNTED. compliance-tracker's boqBudgetVarianceReport
//    summed every line, roots and their derived sub-tasks alike, so this
//    module's own KPI tags showed a QS a budget 35% above the Work Progress
//    Report's for the same BOQ. That is fixed at source (computeBoqBudgetVariance
//    in construction-reports-service.ts); this file's job is the other half --
//    SHOWING the child rows without letting them look like separate money.
//
// 2. THE KPI TAGS PRINTED BARE NUMBERS. `report.totalBudget.toLocaleString()`,
//    with no currency token, on a screen whose whole subject is money.
//
// 3. THE CHART WAS BLANK ON THE COMMON CASE. It plotted variance, and variance
//    is null until somebody enters a vendor amount, so a BOQ that has been
//    budgeted but not yet quoted -- the normal state of a new project --
//    showed "No vendor-linked BOQ lines yet." and nothing else. There is a
//    real chart to draw for that project: budget per line.

export type CostVarianceLine = {
  lineItemId: string;
  code: string | null;
  description: string;
  category?: string | null;
  amount: number;
  budgetPercentage?: number;
  budget: number;
  vendorId: string | null;
  vendorName: string | null;
  vendorAmount: number | null;
  variance: number | null;
  /** R67 E-26 additions from the backend. Optional so an older payload still renders. */
  parentLineItemId?: string | null;
  budgetIsDerived?: boolean;
  percentOfParent?: number | null;
};

export type CostVarianceRow = CostVarianceLine & {
  /** 0 for a root line, 1 for one of its sub-tasks. */
  depth: 0 | 1;
  /** True when this line's budget is derived from a parent rather than entered. */
  isDerived: boolean;
  /** The root this row belongs to -- itself, for a root. Drives the bar-click filter. */
  rootId: string;
  /** "25% of parent", or null on a root / when the parent is not in this payload. */
  parentShareLabel: string | null;
};

/** The caption under the fallback chart. The item's own words. */
export const NO_VARIANCE_CAPTION = "No vendor amounts entered yet - bars show budget per line";

/** Replaces the old "Not yet available", which said nothing about what is coming or when. */
export const FILTER_DISABLED_REASON = "Filter by vendor coming with the vendor picker";

/** Printed under the table so the reader knows why an indented row is not in the total. */
export const DERIVED_BUDGET_NOTE =
  "Totals sum root BOQ lines only. A sub-task's budget is derived from its parent line, so it is shown for detail and never added into a total.";

function isDerivedLine(line: CostVarianceLine): boolean {
  if (typeof line.budgetIsDerived === "boolean") return line.budgetIsDerived;
  return line.parentLineItemId !== null && line.parentLineItemId !== undefined;
}

/**
 * Roots in payload order, each immediately followed by its own sub-tasks.
 *
 * A child whose parent is NOT in the payload (a filtered or partial response)
 * is kept as a top-level row rather than dropped -- a missing money row is a
 * worse failure than an unindented one -- but it still reads as derived, so it
 * is still never mistaken for a line that adds to the total.
 */
export function buildCostVarianceRows(lines: CostVarianceLine[]): CostVarianceRow[] {
  const byId = new Map(lines.map((l) => [l.lineItemId, l]));
  const childrenByParent = new Map<string, CostVarianceLine[]>();
  const roots: CostVarianceLine[] = [];

  for (const line of lines) {
    const parentId = line.parentLineItemId ?? null;
    if (parentId !== null && byId.has(parentId)) {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(line);
      childrenByParent.set(parentId, list);
    } else {
      roots.push(line);
    }
  }

  const shareLabel = (line: CostVarianceLine, parent: CostVarianceLine | undefined): string | null => {
    if (typeof line.percentOfParent === "number") return `${line.percentOfParent}% of parent`;
    if (!parent || parent.budget === 0) return null;
    return `${Math.round((line.budget / parent.budget) * 10000) / 100}% of parent`;
  };

  const rows: CostVarianceRow[] = [];
  for (const root of roots) {
    rows.push({
      ...root,
      depth: 0,
      isDerived: isDerivedLine(root),
      rootId: root.lineItemId,
      // A stray child promoted to top level still says where its budget came from.
      parentShareLabel: isDerivedLine(root) ? shareLabel(root, undefined) : null,
    });
    for (const child of childrenByParent.get(root.lineItemId) ?? []) {
      rows.push({
        ...child,
        depth: 1,
        isDerived: true,
        rootId: root.lineItemId,
        parentShareLabel: shareLabel(child, root),
      });
    }
  }
  return rows;
}

/** True when at least one line has been quoted, i.e. there is a variance chart to draw. */
export function hasAnyVariance(lines: CostVarianceLine[]): boolean {
  return lines.some((l) => l.variance !== null);
}

export type CostVarianceBar = { label: string; value: number; lineItemId: string };

/**
 * The chart's bars. Variance when any line has been quoted, budget per ROOT
 * line otherwise -- never a chart of every line, because plotting a root and
 * its sub-tasks side by side would show the same money twice in a picture, the
 * exact defect the totals were just fixed for.
 */
export function varianceBars(rows: CostVarianceRow[]): CostVarianceBar[] {
  return rows
    .filter((r) => r.variance !== null)
    .map((r) => ({ label: r.code ?? r.description, value: r.variance!, lineItemId: r.lineItemId }));
}

export function budgetBars(rows: CostVarianceRow[]): CostVarianceBar[] {
  return rows
    .filter((r) => r.depth === 0)
    .map((r) => ({ label: r.code ?? r.description, value: r.budget, lineItemId: r.lineItemId }))
    .sort((a, b) => b.value - a.value);
}

/** A bar click filters the table to that root line and its own sub-tasks. */
export function filterToLine(rows: CostVarianceRow[], lineItemId: string | null): CostVarianceRow[] {
  if (lineItemId === null) return rows;
  const clicked = rows.find((r) => r.lineItemId === lineItemId);
  if (!clicked) return rows;
  return rows.filter((r) => r.rootId === clicked.rootId);
}

/** How many lines have been quoted, so a KPI tag can say so in words rather than implying zero. */
export function quotedLineCount(rows: CostVarianceRow[]): number {
  return rows.filter((r) => r.vendorAmount !== null).length;
}

export function overBudgetRootCount(rows: CostVarianceRow[]): number {
  return rows.filter((r) => r.depth === 0 && (r.variance ?? 0) > 0).length;
}

/**
 * Same escaping rule as compliance-tracker's report-export-shared.ts#csvEscape
 * and src/lib/report-documents.ts's copy: a value starting with =, +, - or @
 * is a live formula when Excel opens it, so it gains a leading apostrophe.
 */
export function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Export CSV, in the item's own column order, with the currency in the money
 * headers rather than repeated down every row. Raw numbers, deliberately --
 * this export exists so a QS can check the arithmetic in a spreadsheet, and a
 * formatted "AED 1,625.00" is a string Excel cannot sum.
 *
 * A derived sub-task keeps its indent as a leading marker in the Code cell so
 * the hierarchy survives the export, and the note goes on the last line so a
 * printed CSV still carries the rule its totals follow.
 */
export function costVarianceCsv(rows: CostVarianceRow[], currency: string | null | undefined): string {
  const moneyHeader = (label: string) => (currency ? `${label} (${currency})` : label);
  const header = ["Code", "Description", "Vendor", moneyHeader("Budget"), moneyHeader("Vendor amount"), moneyHeader("Variance")];
  const lines = [header.map(csvEscape).join(",")];

  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.depth === 1 ? `-- ${row.code ?? ""}` : (row.code ?? "")),
        csvEscape(row.description),
        csvEscape(row.vendorName ?? ""),
        csvEscape(row.budget),
        csvEscape(row.vendorAmount ?? ""),
        csvEscape(row.variance ?? ""),
      ].join(",")
    );
  }

  lines.push("");
  lines.push(csvEscape(DERIVED_BUDGET_NOTE));
  return lines.join("\n");
}
