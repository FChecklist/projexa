// R67 E-11 (R-130). WHAT EACH REPORT ACTUALLY TAKES, and what the parameter
// card is therefore allowed to offer.
//
// The defect this closes is not a missing control -- it is a card that offers
// controls a report ignores, and a primary that stays clickable in a state the
// backend answers 400 to. Both are the same mistake: the screen guessing
// instead of knowing. So the knowledge lives here, once, as data:
//
//   * `description`     -- one line under the report select, in the reader's
//                          words, so choosing a report is not a guess at a slug;
//   * `needsDateRange`  -- whether the From/To period is REALLY applied. Most of
//                          these reports take a projectId and nothing else
//                          (verified against compliance-tracker's own
//                          construction-reports-service.ts signatures), and
//                          printing "01 Sep to 03 Sep 2026" above a report that
//                          covers the whole project is a false statement, not a
//                          harmless default;
//   * `needsWeekStart`  -- the one prerequisite the backend hard-rejects on;
//   * `supportsCategory` / `supportsVendor` -- whether a Category or Vendor
//                          choice can change anything. Offering a filter that
//                          cannot bite is the same lie in a smaller box.
//
// Nothing here decides WHERE a report runs -- that is report-destinations.ts,
// and it stays the one answer to that question.

/** The words the primary uses when there is nothing blocking it. */
export const RUN_LABEL = "Run Report";

/** Appended to the primary when the rail has no project. R-130's exact wording. */
export const PROJECT_PREREQUISITE = "select a project";

/** Appended to the primary when the weekly report has no week start. */
export const WEEK_START_PREREQUISITE = "Week Start";

/** At the field, not in a tooltip: a validation the reader can act on where they typed. */
export const WEEK_START_NOT_MONDAY = "Week Start must be a Monday";

/** What the title block prints instead of a period, for a report the period does not touch. */
export const WHOLE_PROJECT_PERIOD = "whole project to date";

/** "All" is a real choice with a name, so an unset filter never reads as "nothing matched". */
export const ALL_OPTION_LABEL = "All";

/**
 * The sentinel a shadcn Select uses for "All". Radix forbids an empty-string
 * item value, so the absence of a filter needs a token of its own rather than
 * "".
 */
export const ALL_OPTION_VALUE = "__all__";

export type ReportParameterSpec = {
  description: string;
  needsDateRange: boolean;
  needsWeekStart: boolean;
  supportsCategory: boolean;
  supportsVendor: boolean;
  /**
   * R67 E-15: the primary's words for a report that opens a screen of its own.
   * "Open Report" is true but says nothing about where; naming the screen means
   * the reader knows before pressing that they are about to leave this one.
   */
  openLabel?: string;
};

const FALLBACK: ReportParameterSpec = {
  description: "",
  needsDateRange: false,
  needsWeekStart: false,
  supportsCategory: false,
  supportsVendor: false,
};

/**
 * Keyed by the report VALUE (the API path segment), the same key
 * DEFAULT_REPORT_COLUMNS and report-destinations.ts use, so the three cannot
 * drift apart.
 *
 * Every flag below was read off the real handler, not assumed:
 * construction-reports-service.ts's function signatures decide needsDateRange
 * and needsWeekStart, and the shape each one returns decides whether a Category
 * or Vendor choice has anything to bite on.
 */
export const REPORT_PARAMETERS: Record<string, ReportParameterSpec> = {
  "project-status": {
    description: "Project Status: the project's own dashboard figures — contract value, budget, revenue, expenses, earned value, and both progress percentages.",
    needsDateRange: false,
    needsWeekStart: false,
    supportsCategory: false,
    supportsVendor: false,
  },
  "project-completion": {
    description: "Project Completion: overall completion percent, plus the same percent broken down per BOQ category.",
    needsDateRange: false,
    needsWeekStart: false,
    supportsCategory: true,
    supportsVendor: false,
  },
  "work-progress": {
    // The item's own example sentence, verbatim.
    description: "Work Progress: quantities and amounts done per BOQ line, previous / this period / to date.",
    needsDateRange: true,
    needsWeekStart: false,
    supportsCategory: true,
    supportsVendor: false,
    // R67 E-15 (R-135): "Open Report" is true but says nothing about WHERE.
    // Naming the screen means the reader knows, before pressing, that they are
    // about to leave this one -- and it is the same name the Full Catalog card
    // and the picker entry use, which is the whole point of D-02.
    openLabel: "Open Work Progress Report",
  },
  "category-progress": {
    description: "Category Progress: percent complete per BOQ category, with the completed and total amount behind each one.",
    needsDateRange: false,
    needsWeekStart: false,
    supportsCategory: true,
    supportsVendor: false,
  },
  "weekly-project": {
    description: "Weekly Project: one week of progress entries, labour cost, attendance, site diary entries and expenses.",
    needsDateRange: false,
    needsWeekStart: true,
    supportsCategory: false,
    supportsVendor: false,
  },
  attendance: {
    description: "Attendance: present, absent and half-day counts with labour cost, grouped by trade.",
    needsDateRange: false,
    needsWeekStart: false,
    supportsCategory: false,
    supportsVendor: false,
  },
  "manpower-cost": {
    description: "Manpower Cost: attendance-based labour cost and worker-days, summed by trade.",
    needsDateRange: false,
    needsWeekStart: false,
    supportsCategory: false,
    supportsVendor: false,
  },
  "site-picture": {
    description: "Site Picture Log: the project's site photographs, grouped by the day they were taken.",
    needsDateRange: false,
    needsWeekStart: false,
    supportsCategory: false,
    supportsVendor: false,
  },
  scope: {
    description: "Scope (BOQ): the latest revision's total value and line count, with the revision history behind it.",
    needsDateRange: false,
    needsWeekStart: false,
    supportsCategory: false,
    supportsVendor: false,
  },
  "budget-summary": {
    description: "Budget Summary: every BOQ line's budget against its vendor amount, with the variance and per-category subtotals.",
    needsDateRange: false,
    needsWeekStart: false,
    supportsCategory: true,
    supportsVendor: true,
  },
  "budget-vs-actual": {
    description: "Budget vs Actual: the project's budget against actual expenses, with the variance broken down by expense head.",
    needsDateRange: false,
    needsWeekStart: false,
    supportsCategory: false,
    supportsVendor: false,
  },
  "material-consumption": {
    description: "Material Consumption: quantity received and cost per material and vendor, against the master unit cost.",
    needsDateRange: true,
    needsWeekStart: false,
    supportsCategory: false,
    supportsVendor: false,
  },
  "vendor-cost": {
    description: "Vendor Cost: labour cost for this project, by vendor.",
    needsDateRange: false,
    needsWeekStart: false,
    supportsCategory: false,
    supportsVendor: true,
  },
  "designer-timesheet": {
    description: "Designer Timesheet: hours by designer, with budget against actual by category, designer and project.",
    needsDateRange: false,
    needsWeekStart: false,
    supportsCategory: true,
    supportsVendor: false,
  },
  kpi: {
    description: "KPI: the project's approved KPI entries against their definitions.",
    needsDateRange: false,
    needsWeekStart: false,
    supportsCategory: false,
    supportsVendor: false,
  },
  revenue: {
    description: "Revenue: the project's non-cancelled sales invoices, and their total.",
    needsDateRange: false,
    needsWeekStart: false,
    supportsCategory: false,
    supportsVendor: false,
  },
  expense: {
    description: "Expense: the project's expense entries, summarised by expense head.",
    needsDateRange: false,
    needsWeekStart: false,
    supportsCategory: false,
    supportsVendor: false,
  },
};

export function reportParameters(reportName: string): ReportParameterSpec {
  return REPORT_PARAMETERS[reportName] ?? FALLBACK;
}

/**
 * The line under the From/To fields for a report the period does not touch --
 * because hiding the fields would say nothing, and leaving them unexplained
 * would imply they do something.
 */
export function periodNote(reportLabel: string, spec: ReportParameterSpec): string | null {
  if (spec.needsDateRange) return null;
  return `${reportLabel} covers the whole project — the From and To dates are not applied to it.`;
}

/** Monday, in the reader's calendar sense: an ISO day whose weekday is 1. */
export function isMonday(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 1;
}

/** The message that belongs AT the Week Start field, or null when it is fine. */
export function weekStartFieldError(reportName: string, weekStart: string): string | null {
  if (!reportParameters(reportName).needsWeekStart) return null;
  if (!weekStart) return null; // "not chosen yet" is the button's business, not a field error
  return isMonday(weekStart) ? null : WEEK_START_NOT_MONDAY;
}

/**
 * Everything the backend would refuse this run for, in the reader's words and
 * in the order they appear on the card. Empty means the primary is honestly
 * pressable.
 */
export function missingPrerequisites(
  reportName: string,
  state: { projectId: string | null; weekStart: string }
): string[] {
  const spec = reportParameters(reportName);
  const missing: string[] = [];
  if (!state.projectId) missing.push(PROJECT_PREREQUISITE);
  if (spec.needsWeekStart && !state.weekStart) missing.push(WEEK_START_PREREQUISITE);
  return missing;
}

/**
 * "Run Report", "Run Report (select a project)", "Open Work Progress Report".
 * The primary always says what pressing it would do -- and when it cannot be
 * pressed, what is missing, on the button itself rather than in a tooltip
 * nobody hovers.
 */
export function runButtonLabel(reportName: string, missing: string[], hosted: boolean): string {
  const base = hosted ? (reportParameters(reportName).openLabel ?? "Open Report") : RUN_LABEL;
  return missing.length === 0 ? base : `${base} (${missing.join(", ")})`;
}

// ---------------------------------------------------------------------------
// The filters the backend does not apply yet
// ---------------------------------------------------------------------------
// R-130 asks for Category and Vendor on the card and says to "apply them
// client-side for reports whose handler does not filter yet". That is only
// honest if the screen can tell the difference between "filtered to nothing"
// and "this report has no such field", so these functions report BOTH: the
// filtered result, and whether the filter found anything to bite on.

const CATEGORY_KEYS = ["category", "categoryName"];
const VENDOR_ID_KEYS = ["vendorId", "supplierId"];
const VENDOR_NAME_KEYS = ["vendorName", "vendor", "supplierName"];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function firstKey(row: Record<string, unknown>, keys: string[]): string | null {
  return keys.find((k) => k in row) ?? null;
}

function sameText(a: unknown, b: string): boolean {
  return typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();
}

export type ClientFilterState = {
  /** A category NAME, or null for "All". */
  category: string | null;
  /** A vendor id, or null for "All". */
  vendorId: string | null;
  /** The chosen vendor's display name, so a report that carries only a name can still be filtered. */
  vendorName: string | null;
};

export type ClientFilterOutcome = {
  result: unknown;
  /** True when at least one array in the result carried a category field. */
  categoryApplied: boolean;
  /** True when at least one array in the result carried a vendor field. */
  vendorApplied: boolean;
};

/**
 * Filters every array-of-objects inside a report result by the chosen category
 * and vendor, leaving anything that carries neither field exactly as it was.
 * Scalars and the report's own summary fields are never touched -- a total that
 * describes the whole project must not silently start describing one category.
 */
export function applyClientFilters(result: unknown, state: ClientFilterState): ClientFilterOutcome {
  let categoryApplied = false;
  let vendorApplied = false;
  if (!state.category && !state.vendorId) {
    return { result, categoryApplied: false, vendorApplied: false };
  }

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      const rows = node.filter(isPlainObject);
      if (rows.length === 0) return node;
      let out = node as unknown[];

      if (state.category) {
        const key = firstKey(rows[0], CATEGORY_KEYS);
        if (key) {
          categoryApplied = true;
          out = out.filter((r) => !isPlainObject(r) || sameText(r[key], state.category!));
        }
      }

      if (state.vendorId) {
        const idKey = firstKey(rows[0], VENDOR_ID_KEYS);
        const nameKey = firstKey(rows[0], VENDOR_NAME_KEYS);
        if (idKey || nameKey) {
          vendorApplied = true;
          out = out.filter((r) => {
            if (!isPlainObject(r)) return true;
            if (idKey && r[idKey] === state.vendorId) return true;
            if (nameKey && state.vendorName && sameText(r[nameKey], state.vendorName)) return true;
            return false;
          });
        }
      }

      return out.map(walk);
    }
    if (isPlainObject(node)) {
      return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    }
    return node;
  };

  return { result: walk(result), categoryApplied, vendorApplied };
}

/** Said in words when a chosen filter had no field to act on, so an unchanged table is never a mystery. */
export function unappliedFilterNote(state: ClientFilterState, outcome: ClientFilterOutcome): string | null {
  const unapplied: string[] = [];
  if (state.category && !outcome.categoryApplied) unapplied.push(`category "${state.category}"`);
  if (state.vendorId && !outcome.vendorApplied) unapplied.push(`vendor "${state.vendorName ?? state.vendorId}"`);
  if (unapplied.length === 0) return null;
  return `This report carries no ${unapplied.join(" and no ")} — every row is shown.`;
}
