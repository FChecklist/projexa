// R67 D-61 (audit R-198 / R-226) -- "so the sweep cannot regress".
//
// The three method calls below are how every one of the four competing money
// formats in this product got written, one screen at a time:
//
//   n.toLocaleString(undefined, ...)   the RUNTIME's locale -- a real hydration
//                                      mismatch on this app's "hi" locale,
//                                      whose digit grouping is 12,00,000
//   n.toFixed(2)                       two decimals, NO thousands separators
//   d.toLocaleDateString()             the runtime's locale AND time zone, so a
//                                      date-only value can render as a
//                                      different calendar day per visitor
//
// The replacements are src/lib/format-money.ts (formatMoney / formatNumber) and
// src/lib/format-date.ts (formatDate / formatDateTime / formatTime), both of
// which pin the locale explicitly and are unit-tested. Those two modules are
// where these calls are ALLOWED to appear; everywhere under src/components and
// src/app they are an error.
//
// This file is the single source of both halves of the rule: eslint.config.mjs
// turns it into the lint error, and src/lib/money-format-rule.test.ts keeps the
// exemption list below honest. Editing one without the other is not possible.

/** The member names no component may call directly. */
export const BANNED_METHODS = ["toLocaleString", "toFixed", "toLocaleDateString", "toLocaleTimeString"];

/** Where the rule applies. */
export const RULE_FILES = ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"];

export const RULE_MESSAGE =
  "R67 D-61: format money and numbers with formatMoney()/formatNumber() from @/lib/format-money, and dates with formatDate()/formatDateTime() from @/lib/format-date. A direct toLocaleString/toFixed/toLocaleDateString call picks the runtime's own locale and produces a different string on the server than in the browser.";

/**
 * The screens this sweep has NOT reached yet.
 *
 * THIS LIST ONLY EVER SHRINKS. It is not a preference and it is not a set of
 * approved exceptions: every entry is a screen still rendering one of the four
 * old formats, listed here so the rule can be switched on today for everything
 * that HAS been swept instead of waiting for a 49-file change nobody can
 * review. A file is deleted from this list by the change that fixes it, and
 * money-format-rule.test.ts fails if a listed file no longer offends -- so the
 * exemption cannot outlive the defect, and a new file can never be added to the
 * list to silence the rule (the test also fails on a path that does not exist).
 *
 * Swept and therefore NOT listed: DashboardHomeView, DashboardProjectClient,
 * WorkProgressReportClient, MaterialsClient, ReportsClient, MeetingsClient,
 * MeetingObjectClient and ScopeClient (lane G's G-05, which shipped
 * src/lib/format-money.ts and src/lib/format-number.ts and is where the shared
 * helpers now live); ReportOutput, app/share/report/[token]/page.tsx,
 * BudgetAnalyticalClient, ProjectsListClient and the forked KpiCard (this lane,
 * D-61/D-62/D-69).
 *
 * The list has already shrunk once, at the lane G merge: MeetingsClient,
 * MeetingObjectClient and ScopeClient were listed when this rule was written
 * and were swept by G-05 before it landed, so their lines are gone. That is the
 * mechanism working -- the test below fails on a listed file that no longer
 * offends, which is what forced the deletion.
 *
 * ...and it shrank a second time, at the lane D1 integration merge, for exactly
 * the same reason and by exactly the same mechanism: MoMObjectClient,
 * ScopeObjectClient and the forked screens/ObjectScreen were all swept on main
 * while this branch still carried them as offenders, so the merged tree has
 * three clean files that this list was still exempting. The test caught all
 * three. Their lines are gone.
 */
export const NOT_YET_SWEPT = [
  "src/components/AccountingClient.tsx",
  "src/components/BudgetObjectClient.tsx",
  "src/components/CategoryDistributionCharts.tsx",
  "src/components/ChangeOrderObjectClient.tsx",
  "src/components/ChangeOrdersClient.tsx",
  // src/components/CostVarianceAnalyticalClient.tsx -- DELETED by R67 D-62.
  // Its replacement, BudgetAnalyticalClient.tsx, is swept: every figure on it
  // goes through formatMoney/formatNumber, so it is not listed here. The list
  // shrinking is the mechanism working, not a suppression.
  "src/components/CreditNoteObjectClient.tsx",
  "src/components/CustomerOverviewClient.tsx",
  "src/components/CustomersClient.tsx",
  "src/components/DashboardHierarchyClient.tsx",
  "src/components/EmployeesClient.tsx",
  "src/components/ExpensesClient.tsx",
  "src/components/FfeClient.tsx",
  "src/components/FfeObjectClient.tsx",
  "src/components/FraudCaseObjectClient.tsx",
  "src/components/GrcClient.tsx",
  "src/components/InventoryClient.tsx",
  "src/components/InvoiceObjectClient.tsx",
  "src/components/InvoicesClient.tsx",
  "src/components/ItemObjectClient.tsx",
  "src/components/JournalEntryCreateClient.tsx",
  "src/components/JournalEntryObjectClient.tsx",
  "src/components/OpportunitiesClient.tsx",
  "src/components/OpportunityObjectClient.tsx",
  "src/components/PayrollClient.tsx",
  "src/components/PayrollRunObjectClient.tsx",
  "src/components/PayslipObjectClient.tsx",
  "src/components/ProcurementClient.tsx",
  "src/components/PurchaseOrderObjectClient.tsx",
  "src/components/PurchaseOrdersClient.tsx",
  "src/components/QuotationsClient.tsx",
  "src/components/RfqObjectClient.tsx",
  "src/components/SalesDashboardClient.tsx",
  "src/components/SalesOrderObjectClient.tsx",
  "src/components/SalesOrdersClient.tsx",
  "src/components/SalesQuotationObjectClient.tsx",
  "src/components/ScheduleGanttClient.tsx",
  "src/components/ScheduleTimesheetClient.tsx",
  "src/components/reports/pivot-utils.ts",
  // The two vendored shadcn/ui primitives. Both format for a chart axis or a
  // calendar caption rather than for a money column, and both are upstream
  // code this repo re-syncs; they are listed for the same reason as the rest
  // (the rule is off for them, not approved for them).
  "src/components/ui/calendar.tsx",
  "src/components/ui/chart.tsx",
];
