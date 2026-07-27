"use client";

// PROJEXA Reports & Analysis catalog UI (CONTROLLER.yaml PRIORITY-17
// projexa_reports_dispatch_2026_07_16). PROJEXA's equivalent of
// compliance-tracker's ReportDefinitionRunner.tsx (#375) -- the real
// "run it and see the result" panel for one report_definitions-backed
// catalog entry. Calls the PRE-EXISTING POST /api/reports/definitions/[id]/run
// proxy (-> VERIDIAN's executeReportDefinition() dispatcher). No execution
// logic lives here, this is a pure consumer.
//
// Honesty note (same as #375's own): executeReportDefinition returns the
// SAME {columns,rows,narrative?,note?} shape for every execution_type
// (deterministic_aggregation/deterministic_formula/ai_recipe/
// external_service) AND for a non-"built" definition (a clean
// {columns:["Note"],rows:[{Note:"not yet built"}]} rather than an error) --
// so this component renders whatever real shape comes back, including the
// "not built yet" case, without special-casing execution type or status.
// The one thing it can't know ahead of time is which deterministic_formula
// definitions require a projectId (report_definitions has no formal
// per-row required-params schema) -- rather than guessing, a 400 error
// naming the missing param is shown verbatim with an optional "Project ID"
// retry field. Same reasoning extends to ReportFilters (date range + free-
// form params below): no declared schema exists to derive dropdowns from,
// so these are generic, re-triggering controls rather than fabricated ones.
//
// Reports pivot/chart UI (2026-07-27): result rendering now goes through
// ReportResultView, which adds Table/Pivot/Chart view-mode tabs over the
// SAME {columns,rows} the inline table used to render alone -- pivoting and
// charting happen entirely client-side against this already-fetched result
// (pivot-utils.ts), never a second server call.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanySelector, type Company, type CompanyScope } from "@/components/company-scope";
import { PlayCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ReportResultView, type TabularReportResult } from "@/components/reports/ReportResultView";
import { ReportFilters } from "@/components/reports/ReportFilters";

export function ReportCatalogRunner({
  definitionId,
  supportsCompanyScope,
  companies,
}: {
  definitionId: string;
  supportsCompanyScope: boolean;
  companies: Company[];
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TabularReportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scope, setScope] = useState<CompanyScope>({ companyId: null, consolidate: false });
  const [filterParams, setFilterParams] = useState<Record<string, string>>({});

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const params: Record<string, unknown> = { ...filterParams };
      if (projectId.trim()) params.projectId = projectId.trim();
      if (supportsCompanyScope && scope.companyId) params.companyId = scope.companyId;
      const res = await fetch(`/api/reports/definitions/${encodeURIComponent(definitionId)}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to run this report/analysis.");
        toast.error(data.error ?? "Failed to run this report/analysis.");
        return;
      }
      setResult(data as TabularReportResult);
    } catch {
      setError("Network error while running this report/analysis.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 rounded-md border border-dashed border-px-border p-2.5 bg-muted/20">
      <ReportFilters onChange={setFilterParams} />
      <div className="flex flex-wrap items-end gap-2">
        {supportsCompanyScope && (
          <CompanySelector companies={companies} scope={scope} onChange={setScope} showConsolidateToggle={false} />
        )}
        {showAdvanced ? (
          <div className="space-y-1">
            <Label className="text-xs">Project ID (only needed for some project-scoped reports)</Label>
            <Input
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="optional"
              className="h-8 w-52 text-xs"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowAdvanced(true)}
            className="text-[11px] text-px-muted underline underline-offset-2 hover:text-px-ink pb-1.5"
          >
            + Add Project ID (if this report needs one)
          </button>
        )}
        <Button size="sm" onClick={run} disabled={running} className="gap-1.5">
          {running ? <Loader2 className="size-3.5 animate-spin" /> : <PlayCircle className="size-3.5" />}
          {running ? "Running..." : result ? "Run Again" : "Run"}
        </Button>
      </div>

      {running && (
        <div className="space-y-1.5 pt-1">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      )}

      {!running && error && (
        <p className="text-xs text-px-error bg-red-50 border border-red-200 rounded p-2">{error}</p>
      )}

      {!running && result && (
        <div className="pt-1">
          <ReportResultView result={result} />
        </div>
      )}
    </div>
  );
}
