"use client";

// R46 P8 seq133: registry-driven LIST archetype, same pattern R43 seq2
// established for permits.list and R46 P8 seq127/seq128/seq134 established
// for drawings.list/documents.list/variations.list (see those Client
// components' header comments for the full history). COLUMNS is the fallback
// used when budgets/page.tsx's server-side resolve of the budget.list
// screen_definitions row returns null (404/error), same "keep the hardcoded
// version behind a flag until verified" contract as the other three
// conversions. Real-screen conversion (2026-08-30): the "New Budget" Dialog is
// gone, replaced by a real /budgets/new route + a real /budgets/[id] Object
// Page (BudgetObjectClient.tsx) that never existed before.
//
// R67 F-08 (R-112). Three faults, all visible on a screen that painted at
// 616 ms and was still idle at 3061 ms:
//
//  1. A BARE SPINNER. The list showed a centred Loader2 and then jumped to a
//     table. It now shows the REAL headers over grey rows from the first
//     frame, so nothing moves when the data lands and the reader can see what
//     they are waiting for.
//  2. THE LIST COULD NOT BE READ. It showed a name and a status. The two
//     things anyone scanning budgets wants -- WHICH YEAR and HOW MUCH -- were
//     missing, because the API returned bare erp_budgets rows. VERIDIAN's
//     listBudgets now folds fiscalYearName and annualAmount on from batched
//     reads inside the transaction it already holds (never a call per row),
//     and the columns are Name | Fiscal Year | Annual Amount | Status.
//  3. TWO CLIENT FETCHES WHERE ONE BELONGS. The companies list -- options for
//     this screen's own filter -- was fetched after hydration. It is resolved
//     server-side now (cached per org) and handed down, so this component
//     makes exactly ONE request: the budgets.
//
// '+ New Budget' is a real prefetching <Link> rather than a router.push
// button, so Next fetches the create route's chunk on hover and in viewport.
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
import { TableLoadingRows } from "@/components/TableLoadingRows";
import { buttonVariants } from "@/components/ui/button";
import { Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { currencyLabel, useCurrencies } from "@/lib/currency";
// Priority 17 remaining gap (2026-07-15): erp_budgets.companyId has existed
// since Wave 70 (createBudget already accepted it) -- this wires the UI
// selector, reusing AccountingClient.tsx's exact component.
import { type Company, type CompanyScope, CompanySelector } from "@/components/company-scope";

type Budget = {
  id: string;
  name: string;
  fiscalYearId: string;
  fiscalYearName: string | null;
  annualAmount: number;
  companyId: string | null;
  costCenterId: string | null;
  status: string;
  actionIfExceeded: string | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "secondary", approved: "default",
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / DrawingsClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

const COLUMNS: ScreenColumn[] = [
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Fiscal Year", field: "fiscalYearName", type: "text", importance: "High" },
  { label: "Annual Amount", field: "annualAmount", type: "number", importance: "High" },
  { label: "Status", field: "status", type: "text", importance: "High" },
];

// Exported so budgets/page.tsx's <Suspense> fallback shows the SAME headers
// the real table will show.
export const BUDGETS_FALLBACK_COLUMN_LABELS = COLUMNS.map((c) => c.label);

// Per-field cell renderer -- this screen isn't built on the kit's ListScreen,
// so unlike PermitsListClient there's no generic column-type-driven renderer
// to hand columns to. A registry row can still reorder/relabel these columns
// live (the hard-stop test); the actual cell value for each known field is
// still this project's own formatting logic, looked up by field name so
// reordering doesn't change what renders.
function renderBudgetCell(field: string, b: Budget, moneyLabel: string) {
  switch (field) {
    case "name":
      return <span className="font-medium">{b.name}</span>;
    case "fiscalYearName":
      // Never the raw fiscalYearId: an opaque id where a year name belongs
      // reads as data. An unresolvable year is an em-dash.
      return <span className="text-px-muted">{b.fiscalYearName ?? "—"}</span>;
    case "annualAmount":
      return <span>{moneyLabel}{b.annualAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
    case "status":
      return <Badge variant={STATUS_VARIANT[b.status] ?? "outline"}>{b.status}</Badge>;
    case "actionIfExceeded":
      return <span className="text-px-muted">{b.actionIfExceeded ?? "—"}</span>;
    default:
      return String((b as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

export default function BudgetsClient({
  registryColumns,
  companies = [],
}: {
  registryColumns?: RegistryColumn[] | null;
  companies?: Company[];
}) {
  const router = useRouter();
  // null means "not resolved yet"; [] is a real, confirmed empty list.
  const [budgets, setBudgets] = useState<Budget[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;
  const currencies = useCurrencies();
  // Budgets carry no per-row currencyId -- always the org base currency, the
  // same undefined-id lookup currencyLabel() documents.
  const moneyLabel = currencyLabel(undefined, currencies);

  const [scope, setScope] = useState<CompanyScope>({ companyId: null, consolidate: false });
  // The FIRST load shows its skeleton immediately: this component mounts
  // directly after the page's own <Suspense> fallback (which already had the
  // headers on screen), so a 150 ms anti-flash delay here would produce
  // 150 ms of nothing between the two. A later reload -- changing the company
  // filter -- does use the delay, because that one can genuinely be instant.
  //
  // State, not a ref: this value is READ DURING RENDER, and a ref read in
  // render is exactly the "your component will not update as expected" case
  // React's own lint rule names.
  const [skeletonDelayMs, setSkeletonDelayMs] = useState(0);

  async function load(companyId: string | null = null) {
    setBudgets(null);
    setLoadError(null);
    try {
      const qs = companyId ? `?companyId=${companyId}` : "";
      // Status before body: the old `await res.json()` + `?? []` rendered a
      // failing upstream as "No budgets found."
      const data = await fetchJson<{ projectBudgets?: Budget[] }>(`/api/project-budgets${qs}`);
      setBudgets(data.projectBudgets ?? []);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load budgets"));
      setBudgets([]);
    } finally {
      setSkeletonDelayMs(150);
    }
  }

  useEffect(() => { void load(scope.companyId); }, [scope.companyId]);

  // D-04's visible budget: a wait crossing 3 s says so rather than leaving the
  // reader to guess whether anything is happening.
  useEffect(() => {
    if (budgets !== null || loadError) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), 3_000);
    return () => clearTimeout(timer);
  }, [budgets, loadError]);

  return (
    <div className="space-y-4">
      <CompanySelector companies={companies} scope={scope} onChange={setScope} showConsolidateToggle={false} />
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-px-muted">
          Fiscal year, cost center, and the line item&apos;s account are all looked up live from VERIDIAN&apos;s ERP
          module — no more guessing an opaque ID.
        </p>
        {/* A real Link, not a router.push button: Next prefetches the create
            route's chunk on hover and in viewport, so the click is instant. */}
        <Link href="/budgets/new" prefetch className={`${buttonVariants()} shrink-0`}>
          <Plus className="size-4" /> New Budget
        </Link>
      </div>
      {budgets === null && !loadError ? (
        <TableLoadingRows
          headers={columns.map((c) => c.label)}
          rows={3}
          caption={slow ? "Still loading…" : "Loading budgets…"}
          delayMs={skeletonDelayMs}
        />
      ) : (
        <Card className="shadow-card">
          <CardContent className="p-0">
            {loadError ? (
              <div className="p-4"><DataLoadError messages={[loadError]} onRetry={() => load(scope.companyId)} /></div>
            ) : (budgets ?? []).length === 0 ? (
              <p className="py-10 text-center text-sm text-px-muted">No budgets found.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((col) => <TableHead key={col.field}>{col.label}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(budgets ?? []).map((b) => (
                    // Real screen navigation (2026-08-30) -- rows open the
                    // real Object Page instead of nothing (no detail view
                    // existed for a single budget before this).
                    <TableRow
                      key={b.id}
                      className="cursor-pointer hover:bg-px-cloud/40"
                      onMouseEnter={() => router.prefetch(`/budgets/${b.id}`)}
                      onClick={() => router.push(`/budgets/${b.id}`)}
                    >
                      {columns.map((col) => (
                        <TableCell key={col.field}>{renderBudgetCell(col.field, b, moneyLabel)}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
