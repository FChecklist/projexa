"use client";

// R67 WS-H (items H-03/H-04). The Cost analysis tab: Budget | Actual |
// Variance | Variance % with group-by chips Category | Designer | Project.
//
// IT RENDERS THE EXISTING REPORT AND COMPUTES NOTHING OF ITS OWN. VERIDIAN's
// designerTimesheetReport already prices APPROVED hours against
// pms_billable_rates inside one transaction and returns byCategory,
// byDesigner and byProject. Recomputing any of that here would be a second
// answer to a question that already has one -- the "two screens disagree
// about one number" defect this programme is closing. The only arithmetic
// this file does is the variance percentage, which is a pure, tested helper
// shared with the rest of the module.
//
// The Designer and Project cuts are ORG-WIDE and the Category cut is
// project-scoped -- that is the report's own documented scoping (a designer's
// or a project's total is not naturally scoped to one project), and the
// scope is stated on screen rather than left for the reader to assume.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ScreenFrame } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import DataLoadError from "@/components/DataLoadError";
import DesignStudioTabs from "@/components/DesignStudioTabs";
import { fetchJson } from "@/lib/fetch-json";
import { costRowsFor, formatVariancePercent, variance, type CostGrouping, type DesignerTimesheetReportShape } from "@/lib/design-studio-timesheet";
import { useOrgMoney } from "@/lib/use-org-money";

const GROUPINGS = [
  { key: "category", label: "Category", scope: "this project" },
  { key: "designer", label: "Designer", scope: "org-wide" },
  { key: "project", label: "Project", scope: "org-wide" },
] as const;



export default function DesignStudioCostAnalysisClient({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const { money, showNotice, notice } = useOrgMoney();
  const [report, setReport] = useState<DesignerTimesheetReportShape | null>(null);
  const [grouping, setGrouping] = useState<CostGrouping>("category");
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadErrors([]);
    try {
      const data = await fetchJson<DesignerTimesheetReportShape>(`/api/reports/designer-timesheet?projectId=${encodeURIComponent(projectId)}`);
      setReport(data);
    } catch (err) {
      setLoadErrors([err instanceof Error ? err.message : "Could not load the cost analysis"]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const rows = costRowsFor(report, grouping);
  const active = GROUPINGS.find((g) => g.key === grouping)!;
  const totals = rows.reduce((acc, r) => ({ budget: acc.budget + r.budget, actual: acc.actual + r.actual }), { budget: 0, actual: 0 });
  const totalVariance = variance(totals.budget, totals.actual);

  return (
    <ScreenFrame
      breadcrumb={`Design Studio / ${projectName} / Cost analysis`}
      exportAction={{
        label: "Export",
        // PROJEXA must not gain a PDF or XLSX library -- the Reports module
        // is where the server-generated exports already live.
        onClick: () => router.push(`/reports?report=designer-timesheet&projectId=${encodeURIComponent(projectId)}`),
      }}
      messages={[]}
    >
      <DesignStudioTabs projectId={projectId} />

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-px-muted">Group by</span>
          {GROUPINGS.map((g) => (
            <Button key={g.key} size="sm" variant={g.key === grouping ? "default" : "outline"} onClick={() => setGrouping(g.key)}>
              {g.label}
            </Button>
          ))}
          <span className="text-[12.5px] text-px-muted">Scope: {active.scope}</span>
        </div>

        <DataLoadError messages={loadErrors} onRetry={() => void load()} />

        <p className="text-[12.5px] text-px-muted">
          Actual is APPROVED hours priced at each designer&apos;s billable rate. Draft, submitted and returned hours are deliberately not counted as cost.
        </p>
        {showNotice && <p className="text-[12.5px] text-px-muted">{notice}</p>}

        {loading ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-px-muted">No approved hours to cost yet for {active.label.toLowerCase()}.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{active.label}</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right">Variance %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const v = variance(row.budget, row.actual);
                return (
                  <TableRow key={row.label}>
                    <TableCell>{row.label}</TableCell>
                    <TableCell className="text-right">{money(row.budget)}</TableCell>
                    <TableCell className="text-right">{money(row.actual)}</TableCell>
                    <TableCell className="text-right">{money(v.variance)}</TableCell>
                    <TableCell className="text-right">{formatVariancePercent(v.variancePercent)}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow>
                <TableCell className="font-medium">Total</TableCell>
                <TableCell className="text-right font-medium">{money(totals.budget)}</TableCell>
                <TableCell className="text-right font-medium">{money(totals.actual)}</TableCell>
                <TableCell className="text-right font-medium">{money(totalVariance.variance)}</TableCell>
                <TableCell className="text-right font-medium">{formatVariancePercent(totalVariance.variancePercent)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </div>
    </ScreenFrame>
  );
}
