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
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";
import { Loader2, Plus } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
// Priority 17 remaining gap (2026-07-15): erp_budgets.companyId has existed
// since Wave 70 (createBudget already accepted it) -- this wires the UI
// selector, reusing AccountingClient.tsx's exact component.
import { type Company, type CompanyScope, CompanySelector } from "@/components/company-scope";

type Budget = { id: string; name: string; fiscalYearId: string; companyId: string | null; costCenterId: string | null; status: string; actionIfExceeded: string | null };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "secondary", approved: "default",
};

// Shape returned by compliance-tracker's screen_definitions.columns jsonb --
// same convention as PermitsListClient.tsx's / DrawingsClient.tsx's
// RegistryColumn.
export type RegistryColumn = ScreenColumn;

const COLUMNS: ScreenColumn[] = [
  { label: "Name", field: "name", type: "text", importance: "High" },
  { label: "Status", field: "status", type: "text", importance: "High" },
  { label: "Action if Exceeded", field: "actionIfExceeded", type: "text", importance: "Medium" },
];

// Per-field cell renderer -- this screen isn't built on the kit's
// ListScreen, so unlike PermitsListClient there's no generic
// column-type-driven renderer to hand columns to. A registry row can still
// reorder/relabel these 3 columns live (the hard-stop test); the actual
// cell value for each known field is still this project's own formatting
// logic, looked up by field name so reordering doesn't change what renders.
function renderBudgetCell(field: string, b: Budget) {
  switch (field) {
    case "name":
      return <span className="font-medium">{b.name}</span>;
    case "status":
      return <Badge variant={STATUS_VARIANT[b.status] ?? "outline"}>{b.status}</Badge>;
    case "actionIfExceeded":
      return <span className="text-px-muted">{b.actionIfExceeded ?? "—"}</span>;
    default:
      return String((b as unknown as Record<string, unknown>)[field] ?? "—");
  }
}

export default function BudgetsClient({ registryColumns }: { registryColumns?: RegistryColumn[] | null }) {
  const router = useRouter();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : COLUMNS;

  // Priority 17 remaining gap: companies list + list-level filter scope,
  // same pattern as AccountingClient.tsx/LeadsClient.tsx.
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scope, setScope] = useState<CompanyScope>({ companyId: null, consolidate: false });

  async function load(companyId: string | null = null) {
    setLoading(true);
    try {
      const qs = companyId ? `?companyId=${companyId}` : "";
      // Status before body: the old `await res.json()` + `?? []` rendered a
      // failing upstream as "No budgets found."
      const data = await fetchJson<{ projectBudgets?: Budget[] }>(`/api/project-budgets${qs}`);
      setBudgets(data.projectBudgets ?? []);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err, "Couldn't load budgets"));
      setBudgets([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(scope.companyId); }, [scope.companyId]);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchJson<{ companies?: Company[] }>("/api/companies");
        setCompanies(data.companies ?? []);
      } catch (err) {
        // Non-fatal -- CompanySelector renders nothing when companies is empty.
      }
    })();
  }, []);

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
        <Button className="shrink-0" onClick={() => router.push("/finance/budgets/new")}><Plus className="size-4" /> New Budget</Button>
      </div>
      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            <div className="p-4"><DataLoadError messages={[loadError]} onRetry={() => load(scope.companyId)} /></div>
          ) : budgets.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No budgets found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => <TableHead key={col.field}>{col.label}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {budgets.map((b) => (
                  // Real screen navigation (2026-08-30) -- rows now open the
                  // real Object Page instead of nothing (no detail view
                  // existed for a single budget before this).
                  <TableRow key={b.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/finance/budgets/${b.id}`)}>
                    {columns.map((col) => (
                      <TableCell key={col.field}>{renderBudgetCell(col.field, b)}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
