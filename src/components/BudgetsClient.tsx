"use client";

// R46 P8 seq133: registry-driven LIST archetype, same pattern R43 seq2
// established for permits.list and R46 P8 seq127/seq128/seq134 established
// for drawings.list/documents.list/variations.list (see those Client
// components' header comments for the full history). COLUMNS is the fallback
// used when budgets/page.tsx's server-side resolve of the budget.list
// screen_definitions row returns null (404/error), same "keep the hardcoded
// version behind a flag until verified" contract as the other three
// conversions. Real-screen conversion (2026-08-30): the "New Budget" Dialog is
// gone, replaced by a real create route + a real Object Page
// (BudgetObjectClient.tsx) that never existed before.
//
// R67 MERGE (D-11, lane D1 x lane D3, 2026-09-03). D3's rewrite of this screen
// SURVIVES WHOLE -- it is the genuine superset (ScreenFrame's fixed header trio,
// ListScreen, a real Export, and D-44's two-next-steps empty state), against
// D1's older Card/Table version. What D1 contributed is the ROUTING, and it is
// not cosmetic: D-62 split the two budgets this product has, moving the ERP's
// fiscal-year budget to /finance/budgets/* and pointing the "Budgets" nav entry
// at the PROJECT budget instead. So every push here now names /finance/budgets/*
// directly rather than the /budgets/* aliases, which are redirects.
//
// One REAL DEFECT was fixed in the fold: D3's empty state linked the "BOQ
// budget" button to /scope?tab=cost-variance, and D-62 renamed that tab to
// "budget". The scope page maps only "budget" and "variance" onto the Budget
// tab, so "cost-variance" fell through to the BOQ tab -- the button silently
// landed on the wrong screen. git flagged none of this: the two lanes touched
// different files.
//
// R67 D-43 (audit R-110). Three defects, all of them the screen talking to
// itself rather than to the user:
//
//   * The sub-copy sold a CHANGELOG entry -- "Fiscal year, cost center, and the
//     line item's account are all looked up live from VERIDIAN's ERP module --
//     no more guessing an opaque ID". That sentence is addressed to whoever
//     shipped the previous version. A user needs to know what this list IS and
//     where the OTHER kind of budget lives.
//   * The empty state was the words "No budgets found." and nothing else -- a
//     dead end on the one screen where a new org always starts.
//   * Filter and Export did not exist here at all, so this module's header did
//     not match any other module's. They exist now, in the fixed order, and
//     say why they cannot be used yet.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
import SkeletonTable from "@/components/SkeletonTable";
import { ListScreen, ScreenFrame, type ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";

import { useOrgMoney } from "@/lib/use-org-money";
import { readStoredProjectId } from "@/lib/project-preference";
import { csvFilename, downloadCsv, toCsv } from "@/lib/csv-export";
// Priority 17 remaining gap (2026-07-15): erp_budgets.companyId has existed
// since Wave 70 (createBudget already accepted it) -- this wires the UI
// selector, reusing AccountingClient.tsx's exact component.
import { type Company, type CompanyScope, CompanySelector } from "@/components/company-scope";

type Budget = {
  id: string; name: string; fiscalYearId: string; companyId: string | null; costCenterId: string | null;
  status: string; actionIfExceeded: string | null;
  /**
   * R67 D-43. VERIDIAN's budgets LIST DTO does not carry an amount today (see
   * toProjectBudgetShape in the v1/projexa/project-budgets route: it projects
   * the erp_budgets header only, and the amounts live in erp_budget_line_items,
   * read only by getBudget). The column is here and formatted so it populates
   * the moment that DTO carries a total; until then the cell is an en-dash with
   * a title saying so, rather than a zero that would read as a real figure.
   */
  annualAmount?: string | number | null;
};
type FiscalYear = { id: string; yearName: string };
type Project = { id: string; name: string };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "secondary", approved: "default",
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / DrawingsClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

const COLUMNS: ScreenColumn[] = [
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Fiscal Year", field: "fiscalYearId", type: "text", importance: "High" },
  { label: "Annual Amount", field: "annualAmount", type: "number", importance: "High" },
  { label: "Status", field: "status", type: "text", importance: "High" },
  { label: "Action if Exceeded", field: "actionIfExceeded", type: "text", importance: "Medium" },
];

// The two quantity/identity columns D-43 adds, appended when a registry row
// predates them -- same reasoning as MaterialsClient's QUANTITY_COLUMNS.
const ADDED_COLUMNS = COLUMNS.filter((c) => c.field === "fiscalYearId" || c.field === "annualAmount");

// The user sentence. The line it replaces read "Fiscal year, cost center, and
// the line item's account are all looked up live from VERIDIAN's ERP module --
// no more guessing an opaque ID", which is a note to the previous implementer,
// not information for the person reading the screen. It is kept here, as a
// comment, so the history is not lost.
export const SUB_COPY =
  "Annual budgets by account and fiscal year. For the budget against each BOQ line, open Scope of Work › Cost Variance.";

/** The empty state's own copy. `orgName` is the org the user is actually in. */
export const EMPTY_COPY = (orgName: string | null) => `No budgets yet for ${orgName ?? "this organisation"}`;

export const NO_PROJECT_REASON = "Pick a project first";
export const BOQ_BUDGET_LABEL = "Open BOQ budget →";

export default function BudgetsClient({ registryColumns }: { registryColumns?: RegistryColumn[] | null }) {
  const router = useRouter();
  const orgMoney = useOrgMoney();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [railProjectId, setRailProjectId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const columns = useMemo(() => {
    const resolved = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;
    const present = new Set(resolved.map((col) => col.field));
    return [...resolved, ...ADDED_COLUMNS.filter((col) => !present.has(col.field))];
  }, [registryColumns]);

  // Priority 17 remaining gap: companies list + list-level filter scope,
  // same pattern as AccountingClient.tsx/LeadsClient.tsx.
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scope, setScope] = useState<CompanyScope>({ companyId: null, consolidate: false });

  const load = useCallback(async (companyId: string | null = null) => {
    setLoading(true);
    try {
      const qs = companyId ? `?companyId=${companyId}` : "";
      // Status before body: the old `await res.json()` + `?? []` rendered a
      // failing upstream as "No budgets found."
      const data = await fetchJson<{ projectBudgets?: Budget[] }>(`/api/project-budgets${qs}`);
      setBudgets(data.projectBudgets ?? []);
      setLoadError(null);
    } catch (err) {
      // R67 D-65 merge: the rows are NOT cleared. Blanking the table on a
      // failed refresh throws away figures the user already had, and an empty
      // table beside an error is easy to read as "the budgets are gone".
      setLoadError(errorMessage(err, "Couldn't load budgets"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(scope.companyId); }, [scope.companyId, load]);

  useEffect(() => {
    // Every one of these is a display-only lookup: a failure degrades one cell
    // or one label, never the list.
    fetchJson<{ companies?: Company[] }>("/api/companies").then((d) => setCompanies(d.companies ?? [])).catch(() => {});
    fetchJson<{ fiscalYears?: FiscalYear[] }>("/api/fiscal-years").then((d) => setFiscalYears(d.fiscalYears ?? [])).catch(() => {});
    fetchJson<{ projects?: Project[] }>("/api/projects").then((d) => setProjects(d.projects ?? [])).catch(() => {});
    fetchJson<{ organization?: { name?: string } }>("/api/organization")
      .then((d) => setOrgName(d.organization?.name ?? null))
      .catch(() => {});
  }, []);

  // R67 D-38's rail selection: the BOQ budget lives on ONE project, so this
  // screen has to know whether one is selected before it can offer that link.
  useEffect(() => {
    // R67 D-38/A-05 merge: the rail's choice is read from the ONE module that
    // owns it (localStorage + a cookie the server reads). There is no
    // subscription: the shell's own chooseProject() calls router.refresh()
    // after it writes, so this screen re-renders with the new answer rather
    // than listening for it -- one writer, one reader.
    setRailProjectId(readStoredProjectId());
  }, []);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === railProjectId) ?? null,
    [projects, railProjectId]
  );

  const fiscalYearName = useCallback(
    (id: string) => fiscalYears.find((fy) => fy.id === id)?.yearName ?? "—",
    [fiscalYears]
  );

  function exportBudgets() {
    const rows = budgets.map((b, i) => [
      i + 1, b.name, fiscalYearName(b.fiscalYearId), b.annualAmount ?? "", b.status, b.actionIfExceeded ?? "",
    ]);
    const csv = toCsv(["S.No", "Name", "Fiscal Year", "Annual Amount", "Status", "Action if Exceeded"], rows);
    downloadCsv(csvFilename("budgets", orgName ?? "org", new Date().toISOString().slice(0, 10)), csv);
  }

  const noRowsYet = !loading && !loadError && budgets.length === 0;

  return (
    <ScreenFrame
      breadcrumb="Annual Budgets"
      // The fixed trio, in the fixed order, from ONE component -- the same
      // header every other module now renders.
      filterAction={{
        label: "Filter",
        disabledReason: loading ? "Loading…" : budgets.length === 0 ? "No budgets to filter" : undefined,
        onClick: () => setScope({ companyId: null, consolidate: false }),
      }}
      exportAction={{
        label: "Export",
        disabledReason: loading ? "Loading…" : budgets.length === 0 ? "No budgets to export" : undefined,
        onClick: exportBudgets,
      }}
      newAction={{ label: "+ New", onClick: () => router.push("/finance/budgets/new") }}
      messages={[]}
    >
      <div className="space-y-4 px-4 py-3">
        <p className="text-sm text-px-muted">{SUB_COPY}</p>

        <CompanySelector companies={companies} scope={scope} onChange={setScope} showConsolidateToggle={false} />

        {loading ? (
          <SkeletonTable headers={columns.map((c) => c.label)} rows={3} caption="Loading budgets…" />
        ) : loadError ? (
          <DataLoadError messages={[loadError]} onRetry={() => load(scope.companyId)} />
        ) : noRowsYet ? (
          // Two real next steps, because there are two kinds of budget in this
          // product and a new org has neither.
          <Card className="shadow-card">
            <CardContent className="space-y-3 p-6 text-center">
              <p className="text-sm text-ct-navy">{EMPTY_COPY(orgName)}</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" data-testid="budgets-new" onClick={() => router.push("/finance/budgets/new")}>
                  + New Budget
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  data-testid="budgets-boq"
                  disabled={!selectedProject}
                  title={selectedProject ? undefined : NO_PROJECT_REASON}
                  onClick={() =>
                    selectedProject &&
                    router.push(`/scope?tab=budget&projectId=${encodeURIComponent(selectedProject.id)}`)
                  }
                >
                  {selectedProject ? BOQ_BUDGET_LABEL : `${BOQ_BUDGET_LABEL} (${NO_PROJECT_REASON})`}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <ListScreen
            functionId="budget.list"
            columns={columns}
            rows={budgets as unknown as Record<string, unknown>[]}
            getRowId={(row) => row.id as string}
            // Real screen navigation (2026-08-30) -- rows open the real Object
            // Page instead of nothing.
            onRowClick={(row) => router.push(`/finance/budgets/${row.id}`)}
            emptyStateLabel={EMPTY_COPY(orgName)}
            renderCell={{
              name: (row) => <span className="font-medium">{String(row.name)}</span>,
              status: (row) => (
                <Badge variant={STATUS_VARIANT[String(row.status)] ?? "outline"}>{String(row.status)}</Badge>
              ),
              actionIfExceeded: (row) => (
                <span className="text-px-muted">{(row.actionIfExceeded as string | null) ?? "—"}</span>
              ),
              fiscalYearId: (row) => fiscalYearName(String(row.fiscalYearId)),
              annualAmount: (row) => {
                const amount = (row as unknown as Budget).annualAmount;
                if (amount === undefined || amount === null || amount === "") {
                  return (
                    <span className="text-px-muted" title="The budgets list does not return a total yet — open the budget to see its line items">
                      —
                    </span>
                  );
                }
                return <span className="text-right tabular-nums">{orgMoney.money(amount)}</span>;
              },
            }}
          />
        )}
      </div>
    </ScreenFrame>
  );
}
