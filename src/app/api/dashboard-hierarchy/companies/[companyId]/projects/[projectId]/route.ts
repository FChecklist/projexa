import { NextRequest, NextResponse } from "next/server";
import { requireCompanyScope } from "@/lib/company-scope";
import { callVeridian, VeridianApiError } from "@/lib/veridian-client";

type ProjectDashboard = {
  projectId: string;
  projectName: string;
  budget: number;
  revenue: number;
  expenses: number;
  progressPercent: number;
  delayedTaskCount: number;
  photoCount: number;
  taskCount: number;
  // Point 121: COALESCE(user-entered, linked-PO-sum), null when neither exists.
  projectValue: number | null;
};

type SalesInvoicesPage = {
  salesInvoices: { id: string; projectId: string | null; postingDate: string; grandTotal: string; status: string }[];
  totalPages: number;
};

type ExpenseEntry = { projectId: string; amount: string; expenseDate: string };
type ProgressEntry = { activityId: string; entryDate: string; percentComplete: number };

// VERIDIAN's paged sales-invoices endpoint doesn't accept a projectId
// filter (only status/customerId/date range -- see erp-invoicing-service.ts),
// but every invoice row carries its own real projectId, so date-ranged,
// project-scoped revenue is computed here by fetching the org's invoices
// in the date range (VERIDIAN-side, real fromDate/toDate filtering) and
// summing the ones for this project. Capped at 4 pages (800 invoices) of
// the org's date-filtered invoices -- generous for a single construction
// org's realistic invoice volume in a bounded date range, but a real,
// disclosed limit rather than an unbounded loop -- callers get `truncated`
// on the return value when the cap was actually hit.
const MAX_INVOICE_PAGES = 4;

async function revenueForProjectInRange(companyId: string, projectId: string, fromDate?: string, toDate?: string): Promise<{ total: number; truncated: boolean }> {
  let total = 0;
  let truncated = false;
  for (let page = 1; page <= MAX_INVOICE_PAGES; page++) {
    const qs = new URLSearchParams({ limit: "200", page: String(page) });
    if (fromDate) qs.set("fromDate", fromDate);
    if (toDate) qs.set("toDate", toDate);
    const data = await callVeridian<SalesInvoicesPage>(`/sales-invoices?${qs.toString()}`, { organizationId: companyId });
    for (const inv of data.salesInvoices) {
      if (inv.projectId === projectId && inv.status !== "cancelled") total += Number(inv.grandTotal);
    }
    if (page >= data.totalPages) break;
    if (page === MAX_INVOICE_PAGES) truncated = true;
  }
  return { total, truncated };
}

async function expensesForProjectInRange(companyId: string, projectId: string, fromDate?: string, toDate?: string): Promise<number> {
  const data = await callVeridian<{ expenses: ExpenseEntry[] }>(`/expenses?projectId=${encodeURIComponent(projectId)}`, { organizationId: companyId });
  return data.expenses
    .filter((e) => (!fromDate || e.expenseDate >= fromDate) && (!toDate || e.expenseDate <= toDate))
    .reduce((sum, e) => sum + Number(e.amount), 0);
}

// "Progress as of toDate": latest logged percentComplete per activity with
// entryDate <= toDate, averaged across activities -- the same "latest
// logged entry per activity, then averaged" definition getProjectDashboard
// already uses for its point-in-time figure, just evaluated at an earlier
// date instead of always "now". Falls back to null (caller uses the
// undated baseline) when there are no entries at or before toDate yet.
async function progressAsOf(companyId: string, projectId: string, toDate?: string): Promise<number | null> {
  if (!toDate) return null;
  const data = await callVeridian<{ entries: ProgressEntry[] }>(`/work-progress?projectId=${encodeURIComponent(projectId)}`, { organizationId: companyId });
  const inRange = data.entries.filter((e) => e.entryDate <= toDate);
  if (inRange.length === 0) return null;
  const latestByActivity = new Map<string, ProgressEntry>();
  for (const entry of inRange) {
    const current = latestByActivity.get(entry.activityId);
    if (!current || entry.entryDate > current.entryDate) latestByActivity.set(entry.activityId, entry);
  }
  const values = [...latestByActivity.values()].map((e) => e.percentComplete);
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

// Details view: Revenue / Budget / Expense / Progress for one project, with
// an optional [from, to] date-range filter applied to Revenue, Expense, and
// Progress. Budget is NOT date-filtered -- it's an annual cost-center
// allocation (erp_budget_line_items.annualAmount), not a dated transaction
// stream, so a date range has no real meaning to slice it by; this is
// disclosed via `budgetIsPeriodTotal` rather than silently ignoring the
// filter.
export async function GET(request: NextRequest, { params }: { params: Promise<{ companyId: string; projectId: string }> }) {
  const { companyId, projectId } = await params;
  const scope = await requireCompanyScope(companyId);
  if (scope.response) return scope.response;

  const fromDate = request.nextUrl.searchParams.get("from") ?? undefined;
  const toDate = request.nextUrl.searchParams.get("to") ?? undefined;

  try {
    const [baseline, revenue, expenses, dateScopedProgress] = await Promise.all([
      callVeridian<ProjectDashboard>(`/dashboard/${encodeURIComponent(projectId)}`, { organizationId: scope.companyId }),
      fromDate || toDate ? revenueForProjectInRange(scope.companyId, projectId, fromDate, toDate) : null,
      fromDate || toDate ? expensesForProjectInRange(scope.companyId, projectId, fromDate, toDate) : null,
      progressAsOf(scope.companyId, projectId, toDate),
    ]);

    return NextResponse.json({
      projectId: baseline.projectId,
      projectName: baseline.projectName,
      budget: baseline.budget,
      budgetIsPeriodTotal: true,
      projectValue: baseline.projectValue,
      revenue: revenue?.total ?? baseline.revenue,
      revenueTruncated: revenue?.truncated ?? false,
      expenses: expenses ?? baseline.expenses,
      progressPercent: dateScopedProgress ?? baseline.progressPercent,
      delayedTaskCount: baseline.delayedTaskCount,
      taskCount: baseline.taskCount,
      photoCount: baseline.photoCount,
      dateRangeApplied: Boolean(fromDate || toDate),
      fromDate: fromDate ?? null,
      toDate: toDate ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof VeridianApiError ? err.message : "Failed to load project details" }, { status: err instanceof VeridianApiError ? err.status : 502 });
  }
}
