"use client";

// R46 P8 seq133: registry-driven LIST archetype, same pattern R43 seq2
// established for permits.list and R46 P8 seq127/seq128/seq134 established
// for drawings.list/documents.list/variations.list (see those Client
// components' header comments for the full history). Only the 3 real data
// columns (Name/Status/Action if Exceeded) are registry-driven: COLUMNS is
// now the fallback used when budgets/page.tsx's server-side resolve of the
// budget.list screen_definitions row returns null (404/error), same "keep
// the hardcoded version behind a flag until verified" contract as the
// other three conversions. The CompanySelector, New Budget dialog, and its
// VERIDIAN lookups (fiscal years/cost centers/accounts) are unrelated to
// the list's own columns and are kept exactly as-is. Real-screen conversion
// (2026-08-30): the "New Budget" Dialog is gone, replaced by a real
// /budgets/new route + a real /budgets/[id] Object Page (BudgetObjectClient.tsx)
// that never existed before.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, ApiError } from "@/lib/fetch-json";
import PaneState from "@/components/PaneState";
import { recordCountLabel, type PaneStatus } from "@/lib/pane-state";
import { Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
// Priority 17 remaining gap (2026-07-15): erp_budgets.companyId has existed
// since Wave 70 (createBudget already accepted it) -- this wires the UI
// selector, reusing AccountingClient.tsx's exact component.
import { type Company, type CompanyScope, CompanySelector } from "@/components/company-scope";
// R67 G-05: ONE money mechanism across the product. This screen formats through
// the org's own base currency like every other list, rather than re-deriving a
// label of its own -- which is what made two screens disagree about a number.
import { useOrgMoney } from "@/lib/use-org-money";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import { MONEY_CELL_CLASS } from "@/lib/format-money";

type Budget = { id: string; name: string; fiscalYearId: string; fiscalYearName: string | null; annualAmount: number; companyId: string | null; costCenterId: string | null; status: string; actionIfExceeded: string | null };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "secondary", approved: "default",
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / DrawingsClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

// R67 INTEGRATION: the UNION of both lanes' columns. Lane F1 added Fiscal Year
// and Annual Amount -- the two figures a budget list is actually read for, and
// which its ct half added to the list DTO (erp-budget-service.ts's
// BudgetListExtras) so they cost no extra request. Lane D-43's own note that
// "the budgets LIST DTO carries no amount" describes the state F1 fixed.
// "Action if Exceeded" is main's and is kept: nothing is dropped to make room.
const COLUMNS: ScreenColumn[] = [
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Fiscal Year", field: "fiscalYearName", type: "text", importance: "High" },
  { label: "Annual Amount", field: "annualAmount", type: "number", importance: "High" },
  { label: "Status", field: "status", type: "text", importance: "High" },
  { label: "Action if Exceeded", field: "actionIfExceeded", type: "text", importance: "Medium" },
];

// Per-field cell renderer -- this screen isn't built on the kit's
// ListScreen, so unlike PermitsListClient there's no generic
// column-type-driven renderer to hand columns to. A registry row can still
// reorder/relabel these 3 columns live (the hard-stop test); the actual
// cell value for each known field is still this project's own formatting
// logic, looked up by field name so reordering doesn't change what renders.
function renderBudgetCell(field: string, b: Budget, money: (v: number | string | null | undefined) => string) {
  switch (field) {
    case "name":
      return <span className="font-medium">{b.name}</span>;
    case "fiscalYearName":
      // Never the raw fiscalYearId: an opaque id where a year name belongs
      // reads as data. An unresolvable year is an em-dash.
      return <span className="text-px-muted">{b.fiscalYearName ?? "—"}</span>;
    case "annualAmount":
      return <span className={MONEY_CELL_CLASS}>{money(b.annualAmount)}</span>;
    case "status":
      return <Badge variant={STATUS_VARIANT[b.status] ?? "outline"}>{b.status}</Badge>;
    case "actionIfExceeded":
      return <span className="text-px-muted">{b.actionIfExceeded ?? "—"}</span>;
    default:
      return String((b as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

// R67 F-04 (lane F1): the screen's own fallback labels, exported so page.tsx
// can build a loading frame carrying the REAL column headers before any data
// has arrived. Same array the client falls back to, so the frame and the table
// cannot drift apart.
export const BUDGETS_FALLBACK_COLUMN_LABELS = COLUMNS.map((c) => c.label);

export default function BudgetsClient({
  registryColumns,
  companies: initialCompanies,
}: {
  registryColumns?: RegistryColumn[] | null;
  /**
   * R67 F-04 (lane F1): the companies list, read in the server component
   * alongside everything else it already reads. When it is supplied, the
   * client-side /api/companies round trip below does not happen at all --
   * which is the point of the item. Optional so any caller that does not
   * prefetch keeps the original self-loading behaviour.
   */
  companies?: Company[];
}) {
  const router = useRouter();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [status, setStatus] = useState<PaneStatus>("loading");
  const [readError, setReadError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;
  const orgMoney = useOrgMoney();

  // Priority 17 remaining gap: companies list + list-level filter scope,
  // same pattern as AccountingClient.tsx/LeadsClient.tsx.
  const [companies, setCompanies] = useState<Company[]>(initialCompanies ?? []);
  const [scope, setScope] = useState<CompanyScope>({ companyId: null, consolidate: false });

  async function load(companyId: string | null = null) {
    setStatus("loading");
    setStartedAt(Date.now());
    setReadError(null);
    try {
      const qs = companyId ? `?companyId=${companyId}` : "";
      // Status before body: the old `await res.json()` + `?? []` rendered a
      // failing upstream as "No budgets found."
      const data = await fetchJson<{ projectBudgets?: Budget[] }>(`/api/project-budgets${qs}`);
      setBudgets(data.projectBudgets ?? []);
      setLoadedAt(new Date());
      setStatus("ready");
    } catch (err) {
      // R67 D-65: the rows are NOT cleared. Blanking the table on a failed
      // refresh throws away figures the user already had, and an empty table
      // beside an error is easy to read as "the budgets are gone".
      setReadError({
        status: err instanceof ApiError ? err.status : null,
        message: err instanceof Error && err.message ? err.message : null,
      });
      setStatus("error");
    }
  }

  useEffect(() => { load(scope.companyId); }, [scope.companyId]);

  useEffect(() => {
    // R67 F-04: already supplied by the server component -- asking again would
    // be the exact round trip this item removes.
    if (initialCompanies) return;
    (async () => {
      try {
        const data = await fetchJson<{ companies?: Company[] }>("/api/companies");
        setCompanies(data.companies ?? []);
      } catch {
        // Non-fatal -- CompanySelector renders nothing when companies is empty.
      }
    })();
  }, [initialCompanies]);

  return (
    <div className="space-y-4">
      <CompanySelector companies={companies} scope={scope} onChange={setScope} showConsolidateToggle={false} />
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-px-muted">
          Fiscal year, cost center, and the line item&apos;s account are all looked up live from VERIDIAN&apos;s ERP
          module — no more guessing an opaque ID.
        </p>
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Budget" Dialog popup with a real create route. */}
        <Button className="shrink-0" onClick={() => router.push("/budgets/new")}><Plus className="size-4" /> New Budget</Button>
      </div>
      <p className="px-1 text-[12px] text-px-muted">{recordCountLabel(status, budgets.length)}</p>

      <Card className="shadow-card">
        <CardContent className="p-4">
          <PaneState
            status={status}
            entity="budgets"
            startedAt={startedAt}
            error={readError}
            rowCount={budgets.length}
            skeletonColumns={columns.map((col) => col.label)}
            emptyMessage="No budgets found."
            emptyAction={
              <Button size="sm" onClick={() => router.push("/budgets/new")}>
                <Plus className="size-4" /> New Budget
              </Button>
            }
            lastLoadedAt={loadedAt}
            onRetry={() => load(scope.companyId)}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => (
                    <TableHead key={col.field}>
                      {col.label}
                      {/* R67 G-05: the currency is stated once, in the header,
                          rather than repeated on every row. "" when the org has
                          not set one -- never a guessed code. */}
                      {col.field === "annualAmount" ? orgMoney.unitSuffix : ""}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgets.map((b) => (
                  // Real screen navigation (2026-08-30) -- rows now open the
                  // real Object Page instead of nothing (no detail view
                  // existed for a single budget before this).
                  <TableRow key={b.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/budgets/${b.id}`)}>
                    {columns.map((col) => (
                      <TableCell key={col.field}>{renderBudgetCell(col.field, b, orgMoney.money)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PaneState>
        </CardContent>
      </Card>
      <CurrencyNotSetNotice currencySet={orgMoney.currencySet} loaded={orgMoney.loaded} />
    </div>
  );
}
