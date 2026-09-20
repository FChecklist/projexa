// PROJEXA-E2E-001 work order section 4 (2026-09-21). "A number on a dashboard
// must be provably derived, and clicking it should reach what produced it."
//
// A prior sweep (PR #306) found real drill-down on only 2 of ~22 reports
// (BudgetActualClient/BudgetAnalyticalClient -> /scope/{boqId}).
// ReportOutput.tsx -- the generic renderer behind the other ~12 reports shown
// inline on the Reports screen -- had zero Link/href anywhere. ReportOutput
// itself cannot know which key is an id and where it points (it also renders
// the AI Copilot's 7 arbitrary tool results, which have no declared shape at
// all); this module is the one place that says so, keyed by the REAL report
// name and the REAL payload shape each construction-reports-service.ts
// handler returns (`?format=legacy`, read directly -- see report-destinations
// .ts's own comment on why every non-hosted report on this screen asks for
// that shape).
//
// Pure and DB-free, same convention as report-format.ts/report-table.ts: it
// only reads what the payload already carries. A report whose payload has no
// id for a given row returns no link for it -- never a fabricated one. Where
// a report's payload genuinely carries no linkable id at all (manpower-cost's
// byTrade rows, budget-vs-actual/expense's byHead rows -- both aggregated
// away from the individual constructionExpenseEntries/attendance rows that
// produced them, with no per-row id surviving the GROUP BY), this file
// deliberately returns no resolver for it: that is a real backend gap (an
// aggregation that could carry a representative id and does not), not
// something a frontend-only fix can close honestly. See this work order's
// own final report for the full list.

import type { RowLinkResolver, FieldLinkResolver } from "@/components/ReportOutput";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function scopeHref(boqId: string): string {
  return `/scope/${encodeURIComponent(boqId)}`;
}

export type ReportLinks = {
  rowLinks: Record<string, RowLinkResolver>;
  fieldLinks: Record<string, FieldLinkResolver>;
};

const NONE: ReportLinks = { rowLinks: {}, fieldLinks: {} };

/**
 * Built once per rendered result, from the REPORT NAME (the picker's `report`
 * value, e.g. "attendance") and that report's own payload -- some reports
 * carry the id a row needs at the TOP level (scope's `boq.id`,
 * category-progress's `boqId`) rather than on the row itself, which is why
 * this takes the whole payload rather than being a static per-report table.
 */
export function buildReportLinks(report: string, data: unknown): ReportLinks {
  const top = isPlainObject(data) ? data : {};

  switch (report) {
    // Attendance Report -- Sumeet's one-row-per-worker sheet (`workers`, R67
    // E-22). Each worker is a real Labour Roster entry with its own screen.
    case "attendance":
      return {
        rowLinks: {
          name: (row) => {
            const id = str(row.rosterId);
            return id ? `/labour/${encodeURIComponent(id)}` : null;
          },
        },
        fieldLinks: {},
      };

    // Site Picture Report -- documents(category='site_photo'), one row per
    // photo, each a real Document with its own view/download screen.
    case "site-picture":
      return {
        rowLinks: {
          name: (row) => {
            const id = str(row.id);
            return id ? `/documents/${encodeURIComponent(id)}` : null;
          },
        },
        fieldLinks: {},
      };

    // Scope Report -- `boq` (the latest BOQ, a scalar sub-object) and
    // `revisions` (every BOQ version for this project, an array). Both name
    // the SAME kind of record (a BOQ) and link to its Object Page.
    case "scope": {
      const boq = isPlainObject(top.boq) ? top.boq : null;
      const boqId = boq ? str(boq.id) : null;
      return {
        rowLinks: {
          version: (row) => {
            const id = str(row.id);
            return id ? scopeHref(id) : null;
          },
        },
        fieldLinks: {
          // Inside the nested `boq` object's own scalar grid: its "version"
          // field (e.g. "v3") links to that same boq's Object Page.
          version: () => (boqId ? scopeHref(boqId) : null),
        },
      };
    }

    // Vendor Cost Report -- `labourVendorCosts`, one row per vendor (LEFT
    // joined, so vendorId/vendorName can legitimately be null for a roster
    // row whose supplier has since been removed -- no link for those rows,
    // not a fabricated one).
    case "vendor-cost":
      return {
        rowLinks: {
          vendorName: (row) => {
            const id = str(row.vendorId);
            return id ? `/vendors/${encodeURIComponent(id)}` : null;
          },
        },
        fieldLinks: {},
      };

    // Revenue Report -- `invoices`, real erp_sales_invoices rows, each with
    // its own Object Page and its own `invoiceNumber`. Note: PROJEXA's
    // Invoices LIST screen has no project-scoped filter (a separate, real
    // frontend gap noted in this work order's final report) -- linking the
    // INDIVIDUAL invoice by id sidesteps that; it does not fix it.
    case "revenue":
      return {
        rowLinks: {
          invoiceNumber: (row) => {
            const id = str(row.id);
            return id ? `/invoices/${encodeURIComponent(id)}` : null;
          },
        },
        fieldLinks: {},
      };

    // KPI Report -- `definitions` (each a real construction_kpi_definitions
    // row, "metricName" is its display column) and `entries` (each points
    // back at its own definition via kpiDefinitionId -- there is no separate
    // KPI ENTRY screen, so an entry links to the definition it belongs to).
    case "kpi":
      return {
        rowLinks: {
          metricName: (row) => {
            const id = str(row.id);
            return id ? `/kpis/${encodeURIComponent(id)}` : null;
          },
          period: (row) => {
            const id = str(row.kpiDefinitionId);
            return id ? `/kpis/${encodeURIComponent(id)}` : null;
          },
        },
        fieldLinks: {},
      };

    // Category Progress Report -- `categories`, each row's percent/amount is
    // attributed from the SAME latest BOQ's root line items (`boqId` at the
    // top of this payload, R67 E-02). Linking to the whole BOQ rather than a
    // category-filtered view: PROJEXA's Scope screen has no category filter
    // of its own to link INTO (checked -- ScopeObjectClient.tsx has none),
    // so the most precise REAL destination is the BOQ that produced the
    // figure, not a fabricated filtered URL.
    case "category-progress": {
      const boqId = str(top.boqId);
      return {
        rowLinks: { name: () => (boqId ? scopeHref(boqId) : null) },
        fieldLinks: {},
      };
    }

    // Project Completion Report -- `byCategory`, same shape and same
    // BOQ-attribution as category-progress above. `boqId` was previously
    // computed by categoryProgressReport() internally and silently dropped
    // before reaching this report's own response; surfaced additively in
    // compliance-tracker (construction-reports-service.ts) as part of this
    // work order so this same link can exist here too.
    case "project-completion": {
      const boqId = str(top.boqId);
      return {
        rowLinks: { name: () => (boqId ? scopeHref(boqId) : null) },
        fieldLinks: {},
      };
    }

    default:
      return NONE;
  }
}

/**
 * ProjectStatusCard's own field-level links (item 4 of this work order,
 * "fix ProjectStatusCard.tsx specifically"). Not run through ReportOutput at
 * all -- this report gets its own hand-built card (R67 E-13) -- so it is a
 * separate, smaller map rather than a `buildReportLinks("project-status", ...)`
 * case: ProjectStatusCard's fields are individually named and typed
 * (report-format.ts's PROJECT_STATUS_FIELDS), not generic columns.
 *
 * Every entry here is checked against what actually PRODUCES that figure
 * (construction-dashboard-service.ts#getProjectDashboard, read directly) --
 * a field only links when the destination is real:
 *   - contractValue/budget/earnedValue/percentByValue are literally computed
 *     from the project's latest BOQ's root line items -> that BOQ's Object
 *     Page. `boqId` is not on getProjectDashboard's own payload; it rides
 *     in from the budget-variance "breakup" fetch ReportsClient already
 *     makes alongside project-status (see that component's own comment) --
 *     absent (no link) whenever the project genuinely has no BOQ.
 *   - progressPercent is the activity-log average -> the Work Progress
 *     screen's own Report tab, where those logs are entered and listed.
 *   - expenses -> /expenses?projectId=, which PROJEXA's Expenses list
 *     screen genuinely filters by (checked: src/app/(app)/expenses/page.tsx
 *     reads `projectId` from its own searchParams).
 *   - taskCount/delayedTaskCount -> /schedule?projectId=, same real filter
 *     (src/app/(app)/schedule/page.tsx).
 *   - photoCount -> the Reports screen's OWN site-picture report (which
 *     this same work order gives real per-photo links, above), reached by
 *     its real, addressable run URL (R67 E-09: the URL is the run's state).
 *   - projectValue is deliberately NOT derived from the BOQ (see
 *     getProjectDashboard's own comment: COALESCE(user-entered
 *     projects.projectValue, SUM of linked purchase orders) -- and neither
 *     /purchase-orders nor any project-detail screen offers a project-scoped
 *     filter or a single field to land on), and revenue has no per-project
 *     destination either (PROJEXA's Invoices list has no project filter,
 *     checked: src/app/(app)/invoices/page.tsx takes no projectId at all).
 *     Both are left unlinked rather than pointed at an unfiltered list that
 *     would not actually show what produced the figure -- real, separate
 *     frontend gaps, noted in this work order's own final report, not
 *     silently worked around here.
 */
export function buildProjectStatusLinks(data: Record<string, unknown>): Record<string, string | null> {
  const boqId = str(data.boqId);
  const projectId = str(data.projectId);
  return {
    contractValue: boqId ? scopeHref(boqId) : null,
    budget: boqId ? scopeHref(boqId) : null,
    earnedValue: boqId ? scopeHref(boqId) : null,
    percentByValue: boqId ? scopeHref(boqId) : null,
    progressPercent: projectId ? `/work-progress?tab=report&projectId=${encodeURIComponent(projectId)}` : null,
    expenses: projectId ? `/expenses?projectId=${encodeURIComponent(projectId)}` : null,
    taskCount: projectId ? `/schedule?projectId=${encodeURIComponent(projectId)}` : null,
    delayedTaskCount: projectId ? `/schedule?projectId=${encodeURIComponent(projectId)}` : null,
    // No `&run=1` needed -- R67 E-10 auto-runs on arrival whenever a real
    // project is present and the report is neither hosted nor blocked
    // (readReportRunParams + the `autoRan` effect in ReportsClient.tsx).
    photoCount: projectId ? `/reports?report=site-picture&projectId=${encodeURIComponent(projectId)}` : null,
  };
}
