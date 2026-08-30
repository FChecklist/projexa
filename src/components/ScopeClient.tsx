"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, GitCompare, GitBranchPlus } from "lucide-react";
import { useCurrencies } from "@/lib/currency";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { formatDate } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";

// R44 seq3 (M28 registry-model proof, same pattern as PermitsListClient's
// RegistryColumn): intentionally the same fields as ScreenColumn so a
// registry row (compliance.screen_definitions, function_id "boq.compare")
// can be passed straight in with no reshaping.
export type RegistryColumn = ScreenColumn;

// R46 P8 seq121 (M28 registry-model, CUSTOM archetype -- function_id
// "boq.custom"): the main BOQ table below stays a fully hand-rolled <Table>
// (not the kit's generic ListScreen -- revisions/variation/hierarchy don't
// fit a plain LIST renderer), but its column LABELS are now registry-driven
// the same way every other converted screen's are. Only label text reads
// from the registry row; the "Actions" column has no backing field and
// always stays hardcoded.
const DEFAULT_LIST_COLUMNS: ScreenColumn[] = [
  { field: "title", label: "Title", type: "text", importance: "High" },
  { field: "version", label: "Version", type: "text", importance: "High" },
  { field: "status", label: "Status", type: "text", importance: "High" },
  { field: "variation", label: "Variation vs. prior", type: "text", importance: "High" },
  { field: "createdAt", label: "Created", type: "date", importance: "High" },
];

function columnLabel(columns: ScreenColumn[], field: string, fallback: string): string {
  return columns.find((c) => c.field === field)?.label || fallback;
}

type Boq = {
  id: string;
  version: number;
  title: string;
  status: string;
  parentBoqId: string | null;
  createdAt: string;
};

type BoqLineItemRow = {
  id: string; itemCode: string | null; description: string; unit: string;
  quantity: string; rate: string; amount: string; activityId: string | null;
  parentLineItemId?: string | null; breakdownPercentage?: string | null;
  // R39/R-C09: Point 154's budget overlay -- computedBudget is derived
  // server-side (amount * budgetPercentage / 100, construction-boq-
  // service.ts#computedBudget), never sent back independently editable.
  budgetPercentage?: string | null;
  computedBudget?: number | null;
  vendorId?: string | null;
  vendorAmount?: string | null;
};

type ChangedLineItem = {
  key: string; previous: BoqLineItemRow; current: BoqLineItemRow;
  // Sumeet audit fix (2026-08-30, requirement #18: "Percentage-only change
  // detected as a variation"). The real backend (construction-boq-
  // service.ts's compareBoq) has always sent this field on every changed
  // row -- this type just never declared it, so toCompareResult() below
  // could never read it even though it was already on the wire.
  quantityChange: number; rateChange: number; breakdownPercentageChange: number; netVariation: number;
};

type BoqComparison = {
  added: BoqLineItemRow[]; removed: BoqLineItemRow[]; changed: ChangedLineItem[];
  warnings: string[]; totalVariation: number;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary", submitted: "default", approved: "outline", superseded: "destructive",
};

function formatVariation(amount: number): string {
  const sign = amount > 0 ? "+" : "";
  return `${sign}${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

// Real-screen conversion (2026-08-30): this list's own line-item-level
// helpers (create/revise line drafting, budget/vendor overlay, derived
// sub-task qty/rate) moved to src/lib/boq-helpers.ts, shared by the new
// ScopeObjectClient/ScopeCreateClient/ScopeReviseClient/ScopeCompareClient
// screens -- the "View"/"New BOQ"/"New Revision"/"Compare" Dialogs that used
// to live in this file are gone, replaced by real routes. This List Report
// only needs the list-row shape and the per-row variation figure.

export default function ScopeClient({ projectId, listColumns }: { projectId: string; listColumns?: RegistryColumn[] | null }) {
  const router = useRouter();
  const boqListColumns = listColumns && listColumns.length > 0 ? listColumns : DEFAULT_LIST_COLUMNS;
  const [boqs, setBoqs] = useState<Boq[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Variation vs. immediate parent, per revision -- the "running total
  // variation value" the Owner asked for, fetched from VERIDIAN's compareBoq
  // rather than stored (this codebase computes diffs at read time, never
  // denormalizes them).
  const [variationByBoqId, setVariationByBoqId] = useState<Record<string, number>>({});


  const currencies = useCurrencies();
  const currencyCode = currencies.find((c) => c.isBaseCurrency)?.code ?? "";

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJson(`/api/scope?projectId=${encodeURIComponent(projectId)}`);
      const loaded: Boq[] = data.boqs ?? [];
      setBoqs(loaded);

      const revisions = loaded.filter((b) => b.parentBoqId);
      const entries = await Promise.all(
        revisions.map(async (b) => {
          const cmpRes = await fetch(`/api/scope/${b.id}/compare`);
          if (!cmpRes.ok) return null;
          const cmp: BoqComparison = await cmpRes.json();
          return [b.id, cmp.totalVariation] as const;
        })
      );
      setVariationByBoqId(Object.fromEntries(entries.filter((e): e is readonly [string, number] => e !== null)));
    } catch (err) {
      const msg = errorMessage(err, "Couldn't load scope of work");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {/* Real screen navigation (2026-08-30) -- replaces the old "New BOQ"
            Dialog popup with a real create route. */}
        <Button onClick={() => router.push(`/scope/new?projectId=${projectId}`)}><Plus className="size-4" /> New BOQ</Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            <DataLoadError messages={[loadError]} onRetry={load} />
          ) : boqs.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No BOQs yet for this project.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{columnLabel(boqListColumns, "title", "Title")}</TableHead>
                  <TableHead>{columnLabel(boqListColumns, "version", "Version")}</TableHead>
                  <TableHead>{columnLabel(boqListColumns, "status", "Status")}</TableHead>
                  <TableHead>{columnLabel(boqListColumns, "variation", "Variation vs. prior")}</TableHead>
                  <TableHead>{columnLabel(boqListColumns, "createdAt", "Created")}</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boqs.map((b) => {
                  const variation = variationByBoqId[b.id];
                  return (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.title}</TableCell>
                      <TableCell className="text-px-muted">v{b.version}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[b.status] ?? "outline"}>{b.status}</Badge></TableCell>
                      <TableCell>
                        {!b.parentBoqId ? (
                          <span className="text-px-muted">Baseline (Rev0)</span>
                        ) : variation === undefined ? (
                          <span className="text-px-muted">—</span>
                        ) : (
                          <span className={variation > 0 ? "text-px-success" : variation < 0 ? "text-px-error" : "text-px-muted"}>{currencyCode ? `${currencyCode} ` : ""}{formatVariation(variation)}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-px-muted">{formatDate(b.createdAt)}</TableCell>
                      <TableCell className="text-right space-x-1">
                        {/* Real screen navigation (2026-08-30) -- replaces the old
                            "View" Dialog popup with a real Object Page route,
                            same as PermitObjectClient's proven pattern. */}
                        <Button variant="ghost" size="sm" onClick={() => router.push(`/scope/${b.id}`)}>View</Button>
                        <Button variant="ghost" size="sm" onClick={() => router.push(`/scope/${b.id}/compare`)}><GitCompare className="size-3.5" /> Compare</Button>
                        <Button variant="ghost" size="sm" onClick={() => router.push(`/scope/${b.id}/revise`)}><GitBranchPlus className="size-3.5" /> New Revision</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
