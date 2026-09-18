"use client";

// Sumeet requirement #7 ("for a project the change of BOQ, change of scope,
// billing, milestones, timelines analysis") and #8 ("profit and loss
// analysis for the project"). Every figure here is READ from an
// already-built, already-tested service -- this screen computes nothing new
// (same X-27 "single producer" discipline boq-analysis-service.ts itself
// documents):
//   - P&L / BOQ change: VERIDIAN's boq-analysis-service.ts (getProjectAnalysis),
//     "did we make the margin we quoted, and where did it go" -- proxied via
//     /api/reports/boq-analysis, which PROJEXA never had a route to reach.
//   - Change of scope: constructionChangeOrders, via /api/change-orders
//     (already real and working -- see this session's own Phase 1 finding).
//   - Milestones: pms_milestones, via /api/milestones (this session, Phase 2).
//   - Billing milestones: constructionProgressClaims's billing-due queue, via
//     /api/billing-claims (this session).
//   - Timelines: pms_issues/critical-path, via /api/schedule/gantt (already
//     real and working).
// Nothing on this screen is ever editable -- same GET-only, read-only
// contract as /api/v1/projexa/reports/boq-analysis's own upstream route.
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type MoneyFigure = number | "NOT_SET";

type ProfitAtBothLevels = {
  profitOnGross: MoneyFigure;
  profitOnGrossPercent: MoneyFigure;
  profitOnNetReceivable: MoneyFigure;
  profitOnNetReceivablePercent: MoneyFigure;
};

type ProjectAnalysisRow = {
  hasBaseline: boolean;
  contractAtFirstConfirmation: MoneyFigure;
  contractValueNow: MoneyFigure;
  contractVariance: MoneyFigure;
  approvedVariationCount: number;
  baselineEstimatedCost: MoneyFigure;
  committed: MoneyFigure;
  spent: MoneyFigure;
  commitmentDriftSign: "under_baseline" | "over_baseline" | "on_baseline" | "unknown";
  costPerformanceSign: "under_baseline" | "over_baseline" | "on_baseline" | "unknown";
  expectedProfitGross: MoneyFigure;
  actualProfit: ProfitAtBothLevels;
  profitVsExpectedDelta: MoneyFigure;
};

type ChangeOrder = { id: string; status: string; costImpact: string };
type Milestone = { id: string; status: string; completionPercentage: number };
type GanttTask = { id: string; isCritical: boolean };
type BillingClaim = { id: string; status: string; isOverdue: boolean };

const SIGN_LABEL: Record<ProjectAnalysisRow["commitmentDriftSign"], string> = {
  under_baseline: "Under baseline",
  over_baseline: "Over baseline",
  on_baseline: "On baseline",
  unknown: "Not yet known",
};

const SIGN_VARIANT: Record<ProjectAnalysisRow["commitmentDriftSign"], "default" | "secondary" | "destructive" | "outline"> = {
  under_baseline: "default",
  over_baseline: "destructive",
  on_baseline: "secondary",
  unknown: "outline",
};

export default function Project360Client({ projectId, projectName }: { projectId: string; projectName: string }) {
  const currencies = useCurrencies();
  const fmt = (v: MoneyFigure) => (v === "NOT_SET" ? "Not yet baselined" : `${currencyLabel(undefined, currencies)}${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
  const fmtPercent = (v: MoneyFigure) => (v === "NOT_SET" ? "—" : `${v.toFixed(1)}%`);

  const [analysis, setAnalysis] = useState<ProjectAnalysisRow | null>(null);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tasks, setTasks] = useState<GanttTask[]>([]);
  const [billingClaims, setBillingClaims] = useState<BillingClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [analysisRes, changeOrdersRes, milestonesRes, ganttRes, billingRes] = await Promise.all([
          fetchJson<{ row: ProjectAnalysisRow }>(`/api/reports/boq-analysis?projectId=${encodeURIComponent(projectId)}`),
          fetchJson<{ changeOrders?: ChangeOrder[] }>(`/api/change-orders?projectId=${encodeURIComponent(projectId)}`),
          fetchJson<{ milestones?: Milestone[] }>(`/api/milestones?projectId=${encodeURIComponent(projectId)}`),
          fetchJson<{ tasks?: GanttTask[] }>(`/api/schedule/gantt?projectId=${encodeURIComponent(projectId)}`),
          fetchJson<{ claims?: BillingClaim[] }>(`/api/billing-claims?projectId=${encodeURIComponent(projectId)}`),
        ]);
        if (cancelled) return;
        setAnalysis(analysisRes.row);
        setChangeOrders(changeOrdersRes.changeOrders ?? []);
        setMilestones(milestonesRes.milestones ?? []);
        setTasks(ganttRes.tasks ?? []);
        setBillingClaims(billingRes.claims ?? []);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, "Couldn't load the Project 360 analysis"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) {
    return <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  }
  if (error || !analysis) {
    return <p className="py-10 text-center text-sm text-px-error">{error ?? "No analysis available"}</p>;
  }

  const pendingChangeOrders = changeOrders.filter((c) => c.status !== "approved" && c.status !== "rejected");
  const totalScopeChangeImpact = changeOrders.reduce((sum, c) => sum + Number(c.costImpact || 0), 0);

  const milestonesByStatus = milestones.reduce<Record<string, number>>((acc, m) => {
    acc[m.status] = (acc[m.status] ?? 0) + 1;
    return acc;
  }, {});
  const avgMilestoneCompletion = milestones.length
    ? Math.round(milestones.reduce((sum, m) => sum + m.completionPercentage, 0) / milestones.length)
    : 0;

  const criticalTaskCount = tasks.filter((t) => t.isCritical).length;
  const overdueBillingClaims = billingClaims.filter((c) => c.isOverdue).length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-px-muted">
        {projectName} — did we make the margin we quoted, and where did it go, combined with scope changes, billing milestones and schedule slippage.
      </p>

      {/* THE ANSWER (Sumeet #8: Profit & Loss) */}
      <Card className="shadow-card">
        <CardHeader><CardTitle className="font-heading text-base">Profit &amp; Loss — the answer</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-px-muted">Expected profit (at first confirmation)</p>
              <p className="text-lg font-heading text-px-ink">{fmt(analysis.expectedProfitGross)}</p>
            </div>
            <div>
              <p className="text-xs text-px-muted">Actual profit (gross)</p>
              <p className="text-lg font-heading text-px-ink">{fmt(analysis.actualProfit.profitOnGross)}</p>
              <p className="text-xs text-px-muted">{fmtPercent(analysis.actualProfit.profitOnGrossPercent)} margin</p>
            </div>
            <div>
              <p className="text-xs text-px-muted">Actual profit (net receivable)</p>
              <p className="text-lg font-heading text-px-ink">{fmt(analysis.actualProfit.profitOnNetReceivable)}</p>
              <p className="text-xs text-px-muted">{fmtPercent(analysis.actualProfit.profitOnNetReceivablePercent)} margin</p>
            </div>
            <div>
              <p className="text-xs text-px-muted">Vs. quoted margin</p>
              <p className={`text-lg font-heading ${analysis.profitVsExpectedDelta !== "NOT_SET" && analysis.profitVsExpectedDelta < 0 ? "text-px-error" : "text-px-ink"}`}>
                {fmt(analysis.profitVsExpectedDelta)}
              </p>
            </div>
          </div>
          {!analysis.hasBaseline && (
            <p className="mt-3 text-xs text-px-muted">No baseline has been confirmed for this project's BOQ yet — the figures above will read "Not yet baselined" until one is.</p>
          )}
        </CardContent>
      </Card>

      {/* CHANGE OF BOQ (Sumeet #6) */}
      <Card className="shadow-card">
        <CardHeader><CardTitle className="font-heading text-base">Change of BOQ</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-px-muted">Contract at first confirmation</p>
            <p className="text-lg font-heading text-px-ink">{fmt(analysis.contractAtFirstConfirmation)}</p>
          </div>
          <div>
            <p className="text-xs text-px-muted">Contract now</p>
            <p className="text-lg font-heading text-px-ink">{fmt(analysis.contractValueNow)}</p>
          </div>
          <div>
            <p className="text-xs text-px-muted">Variation impact</p>
            <p className="text-lg font-heading text-px-ink">{fmt(analysis.contractVariance)}</p>
            <p className="text-xs text-px-muted">{analysis.approvedVariationCount} approved revision(s)</p>
          </div>
          <div>
            <p className="text-xs text-px-muted">Cost vs. baseline</p>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge variant={SIGN_VARIANT[analysis.commitmentDriftSign]} className="text-[10px]">Committed: {SIGN_LABEL[analysis.commitmentDriftSign]}</Badge>
              <Badge variant={SIGN_VARIANT[analysis.costPerformanceSign]} className="text-[10px]">Spent: {SIGN_LABEL[analysis.costPerformanceSign]}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CHANGE OF SCOPE (Sumeet #5) + MILESTONES (Sumeet #2) + TIMELINE + BILLING (#3) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-card">
          <CardHeader><CardTitle className="font-heading text-sm">Scope changes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-heading text-px-ink">{changeOrders.length}</p>
            <p className="text-xs text-px-muted">{pendingChangeOrders.length} pending decision</p>
            <p className="text-xs text-px-muted">{fmt(totalScopeChangeImpact)} total cost impact</p>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader><CardTitle className="font-heading text-sm">Milestones</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-heading text-px-ink">{milestones.length}</p>
            <p className="text-xs text-px-muted">{avgMilestoneCompletion}% average completion</p>
            <p className="text-xs text-px-muted">{milestonesByStatus.completed ?? 0} completed</p>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader><CardTitle className="font-heading text-sm">Timeline</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-heading text-px-ink">{tasks.length}</p>
            <p className="text-xs text-px-muted">{criticalTaskCount} activities on the critical path</p>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader><CardTitle className="font-heading text-sm">Billing milestones</CardTitle></CardHeader>
          <CardContent>
            <p className="text-2xl font-heading text-px-ink">{billingClaims.length}</p>
            <p className={`text-xs ${overdueBillingClaims > 0 ? "text-px-error" : "text-px-muted"}`}>{overdueBillingClaims} overdue</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
