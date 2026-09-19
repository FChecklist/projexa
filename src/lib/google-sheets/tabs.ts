// Shared tab/column layout for the org spreadsheet, used by
// spreadsheet-builder.ts (creates them), push.ts (writes read-only data into
// them) and pull.ts (reads actionable rows back out of them). Keeping the
// column order in one place means the three files can never silently drift
// out of sync with each other about which column index means what.

export const SHEET_TITLES = {
  PROJECTS: "Projects",
  NEW_PROJECTS: "New Projects",
  PROJECT_UPDATES: "Project Updates",
  BULK_ENTRY: "Bulk Data Entry",
  BULK_EDIT: "Bulk Data Edit",
  REPORTS: "Reports",
  ANALYSIS: "Analysis",
  ROLES: "Roles",
} as const;

// Hidden lookup tab: id/name pairs, used as the source range for every
// "Project" dropdown elsewhere in the workbook (data-validation from a
// range, not a static list, so it stays current after every "Refresh").
export const PROJECTS_COLUMNS = ["Project ID", "Project Name"] as const;

export const NEW_PROJECTS_COLUMNS = [
  "Status", // "" | READY | DONE | ERROR
  "Submitted By (your email)",
  "Product",
  "Name",
  "Description",
  "Start Date",
  "Target Date",
  "Result",
] as const;

export const PROJECT_UPDATES_COLUMNS = [
  "Status",
  "Submitted By (your email)",
  "Project",
  "Activity ID",
  "BOQ Line Item ID (optional)",
  "Entry Date",
  "Quantity Done",
  "Percent Complete",
  "Remarks",
  "Entry Basis", // DELTA | SNAPSHOT
  "Result",
] as const;

// Grouped into one BOQ per (Project, BOQ Title) combination on submit --
// see pull.ts's groupBoqRows(). Mirrors the other repo's BoqLineItemInput
// shape (src/app/api/v1/construction/boq/route.ts) via PROJEXA's own
// existing POST /api/scope proxy.
export const BULK_ENTRY_COLUMNS = [
  "Status",
  "Submitted By (your email)",
  "Project",
  "BOQ Title",
  "Item Code",
  "Parent Item Code",
  "Description",
  "Unit",
  "Quantity",
  "Rate",
  "Category",
  "Result",
] as const;

// Populated by push.ts from the org's existing BOQ line items (one row per
// line item across every project's active BOQ, with a hidden ID column).
// Only BOQ line items are editable here -- progress entries have no update
// endpoint anywhere in the product today, so "bulk edit" for progress isn't
// possible without a new backend feature (see the plan's documented
// limitation). Edits go through PATCH /api/scope/line-items/[id].
export const BULK_EDIT_COLUMNS = [
  "Status",
  "Submitted By (your email)",
  "Line Item ID",
  "Project",
  "BOQ Title",
  "Item Code",
  "Description",
  "Unit",
  "Quantity",
  "Rate",
  "Category",
  "Result",
] as const;

// The 17 report names GET /api/reports/[reportName] recognizes (mirrors
// DEFAULT_REPORT_COLUMNS in src/components/ReportsClient.tsx).
export const REPORT_NAMES = [
  "project-status",
  "project-completion",
  "work-progress",
  "category-progress",
  "weekly-project",
  "attendance",
  "manpower-cost",
  "site-picture",
  "scope",
  "budget-summary",
  "budget-vs-actual",
  "material-consumption",
  "vendor-cost",
  "designer-timesheet",
  "kpi",
  "revenue",
  "expense",
] as const;

// Curated subset rendered as a fixed dashboard on the Analysis tab, rather
// than the free-pick single-report-at-a-time model the Reports tab uses.
export const ANALYSIS_REPORT_NAMES = ["budget-vs-actual", "kpi", "revenue", "expense"] as const;

export const ROLES_COLUMNS = [
  "Status",
  "Submitted By (your admin email)",
  "Member Email",
  "Current Role",
  "New Role",
  "Result",
] as const;

export const ORG_ROLES = ["owner", "admin", "pm", "site_engineer", "member", "client_viewer"] as const;

export const STATUS_READY = "READY";
export const STATUS_DONE = "DONE";
export const STATUS_ERROR = "ERROR";
