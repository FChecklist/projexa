"use client";

// R42 seq24 (M28 ANALYTICAL archetype) -- the real destination
// DASHBOARD.PROJECT's "Budget vs Actual" KPI links to. Data comes from the
// ALREADY-REGISTERED "budget-variance" report (REPORT_REGISTRY,
// boqBudgetVarianceReport, R39/R-C09) -- no projexa consumer of it existed
// before this seq. Chart above (variance by line, sorted so the worst
// overrun shows first), <ListScreen> table below (a NEW registry table for
// this flat variance view -- distinct from ScopeClient's own CUSTOM
// weighted-tree screen, which stays CUSTOM for editing/hierarchy; this is
// a different, flat "which line is worst" question ListScreen answers
// cleanly).
import { useEffect, useState } from "react";
import { AnalyticalScreen, BarChart, KpiTag, ListScreen, MoneyCell, type BarChartDatum, type ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";

type VarianceLine = {
  lineItemId: string;
  code: string | null;
  description: string;
  amount: number;
  budget: number;
  vendorId: string | null;
  vendorName: string | null;
  vendorAmount: number | null;
  variance: number | null;
};
type VarianceReport = { lines: VarianceLine[]; totalBudget: number; totalVendorAmount: number; totalVariance: number };

const COLUMNS: ScreenColumn[] = [
  { label: "Code", field: "code", type: "text", importance: "High" },
  { label: "Description", field: "description", type: "text", importance: "High" },
  { label: "Vendor", field: "vendorName", type: "text", importance: "High" },
  { label: "Budget", field: "budget", type: "number", importance: "High" },
  { label: "Vendor amount", field: "vendorAmount", type: "number", importance: "High" },
  { label: "Variance", field: "variance", type: "number", importance: "High" },
];

export default function CostVarianceAnalyticalClient({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<VarianceReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/reports/budget-variance?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((data) => setReport(data))
      .finally(() => setLoading(false));
  }, [projectId]);

  const lines = report?.lines ?? [];
  const overBudget = lines.filter((l) => (l.variance ?? 0) > 0).length;
  const bars: BarChartDatum[] = lines
    .filter((l) => l.variance !== null)
    .map((l) => ({ label: l.code ?? l.description, value: l.variance!, tone: l.variance! > 0 ? "late" : "done" }));

  return (
    <AnalyticalScreen
      breadcrumb="Scope of Work / Cost variance"
      filterAction={{ label: "Filter", disabledReason: "Not yet available" }}
      exportAction={{ label: "Export", disabledReason: "Not yet available" }}
      newAction={undefined}
      kpiTags={
        <>
          <KpiTag label="Total budget" value={report ? report.totalBudget.toLocaleString() : "—"} />
          <KpiTag label="Total vendor amount" value={report ? report.totalVendorAmount.toLocaleString() : "—"} />
          <KpiTag label="Lines over budget" value={String(overBudget)} />
        </>
      }
      chart={bars.length > 0 ? <BarChart data={bars} /> : <p className="text-[12.5px] text-ct-muted">No vendor-linked BOQ lines yet.</p>}
      table={
        loading ? (
          <p className="px-4 py-6 text-[13px] text-ct-muted">Loading…</p>
        ) : (
          <ListScreen
            functionId="scope.cost-variance"
            columns={COLUMNS}
            rows={lines as unknown as Record<string, unknown>[]}
            getRowId={(row) => row.lineItemId as string}
            emptyStateLabel="No BOQ line items yet."
            renderCell={{
              budget: (row) => <MoneyCell value={(row as unknown as VarianceLine).budget} />,
              vendorAmount: (row) => {
                const v = (row as unknown as VarianceLine).vendorAmount;
                return v === null ? <span className="text-ct-muted">–</span> : <MoneyCell value={v} />;
              },
              variance: (row) => {
                const v = (row as unknown as VarianceLine).variance;
                if (v === null) return <span className="text-ct-muted">–</span>;
                return <MoneyCell value={v} tone={v > 0 ? "late" : "done"} />;
              },
            }}
          />
        )
      }
    />
  );
}
