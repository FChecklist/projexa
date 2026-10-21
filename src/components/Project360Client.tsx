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
// The screen is read-only EXCEPT one deliberate action (Sumeet R-100): "Confirm baseline". Profit and loss are computed from the first confirmed
// baseline of the project's BOQ, and nothing could create one, so every project read "Not yet baselined" for ever (UAT 2026-10-12). Confirming
// needs a person and an evidence reference (a PO, a signed proposal, an email: D88), and is only offered while no baseline exists.
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2, Printer } from "lucide-react";
import { useOrgMoney } from "@/lib/use-org-money";
import { formatNumber } from "@/lib/format-number";
import { ApiError, fetchJson, errorMessage } from "@/lib/fetch-json";
// GUIDED ERRORS (G1): a refused baseline, a missing evidence reference, a missing BOQ and a failed read are each told in the inline panel.
import { ActionFailurePanel, codedFailure, type ActionFailureState } from "@/components/ActionFailure";
import { baselineEvidenceFault, faultError } from "@/lib/error-guide/g1-faults";
import { project360ToCsv } from "@/lib/project-360-export";
import { formatDate, formatDateTime } from "@/lib/format-date";

type MoneyFigure = number | "NOT_SET";

type ProfitAtBothLevels = {
  profitOnGross: MoneyFigure;
  profitOnGrossPercent: MoneyFigure;
  profitOnNetReceivable: MoneyFigure;
  profitOnNetReceivablePercent: MoneyFigure;
};

type ProjectAnalysisRow = {
  boqId?: string | null;
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

/** Gap between re-reads of the analysis after a baseline was confirmed and the first read still said "no baseline". */
const BASELINE_REREAD_DELAY_MS = 300;

export default function Project360Client({ projectId, projectName }: { projectId: string; projectName: string }) {
  const orgMoney = useOrgMoney();
  const fmt = (v: MoneyFigure) => (v === "NOT_SET" ? "Not yet baselined" : orgMoney.money(v, { fractionDigits: 0 }));
  const fmtPercent = (v: MoneyFigure) => (v === "NOT_SET" ? "—" : `${formatNumber(v, { fractionDigits: 1 })}%`);

  const [analysis, setAnalysis] = useState<ProjectAnalysisRow | null>(null);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [tasks, setTasks] = useState<GanttTask[]>([]);
  const [billingClaims, setBillingClaims] = useState<BillingClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ActionFailureState | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [evidence, setEvidence] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<ActionFailureState | null>(null);
  const [confirmedNote, setConfirmedNote] = useState<{ at: string; evidence: string } | null>(null);

  // Re-reads ONLY the analysis row, never from a cache. Resolves to whether it now says a baseline exists (a failed read is "not known": false).
  async function rereadAnalysis(): Promise<boolean> {
    try {
      const res = await fetchJson<{ row: ProjectAnalysisRow }>(`/api/reports/boq-analysis?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      setAnalysis(res.row);
      return res.row.hasBaseline;
    } catch {
      return false;
    }
  }

  async function confirmBaseline(boqId: string) {
    const ref = evidence.trim();
    const evidenceFault = baselineEvidenceFault(ref);
    if (evidenceFault) {
      setConfirmError({ err: faultError(evidenceFault), field: evidenceFault.field, at: Date.now() });
      return;
    }
    setConfirming(true);
    setConfirmError(null);
    const done = (at: string) => {
      setEvidence("");
      setConfirmedNote({ at, evidence: ref });
    };
    try {
      const res = await fetchJson<{ confirmedAt?: string }>(`/api/scope/${encodeURIComponent(boqId)}/revisions?action=baseline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ evidenceArtefactRef: ref }),
      });
      done(typeof res?.confirmedAt === "string" ? res.confirmedAt : new Date().toISOString());
      // The write is done; the figures follow it. A read that still says "no baseline" is read again a few times before giving up quietly.
      for (let i = 0; i < 4; i += 1) {
        if (await rereadAnalysis()) break;
        await new Promise((r) => setTimeout(r, BASELINE_REREAD_DELAY_MS));
      }
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const reason = errorMessage(err, "The baseline was not confirmed");
      if (status === 0 || status === 408 || status >= 500) {
        // The server can finish a write after it has stopped answering: look before saying it failed.
        if (await rereadAnalysis()) {
          done(new Date().toISOString());
        } else {
          setConfirmError({ err, message: `${reason}. It may still have been saved — the figures were re-checked and the baseline is not there yet. Wait a moment and press Confirm baseline again only if it still shows "Not yet baselined".`, field: "baseline-evidence", at: Date.now() });
        }
      } else {
        setConfirmError({ err, field: "baseline-evidence", at: Date.now() });
      }
    } finally {
      setConfirming(false);
    }
  }

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
        if (!cancelled) setError({ err, at: Date.now(), retry: () => setReloadKey((k) => k + 1) });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [projectId, reloadKey]);

  if (loading && !analysis) {
    return <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>;
  }
  if (error || !analysis) {
    return (
      <div className="py-6">
        <ActionFailurePanel
          failure={error ?? codedFailure("EMPTY_REPORT", "No analysis is available for this project yet.")}
          entityType="project"
          entityId={projectId}
          projectId={projectId}
          onRetry={() => setReloadKey((k) => k + 1)}
          retryable
        />
      </div>
    );
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

  // The file carries exactly what the cards below show, formatted by the same functions.
  function downloadCsv() {
    const csv = project360ToCsv(projectName, formatDate(new Date().toISOString().slice(0, 10)), {
      profit: [
        ["Expected profit (at first confirmation)", fmt(analysis!.expectedProfitGross)],
        ["Actual profit (gross)", fmt(analysis!.actualProfit.profitOnGross)],
        ["Actual profit (gross) margin", fmtPercent(analysis!.actualProfit.profitOnGrossPercent)],
        ["Actual profit (net receivable)", fmt(analysis!.actualProfit.profitOnNetReceivable)],
        ["Actual profit (net receivable) margin", fmtPercent(analysis!.actualProfit.profitOnNetReceivablePercent)],
        ["Vs. quoted margin", fmt(analysis!.profitVsExpectedDelta)],
      ],
      boq: [
        ["Contract at first confirmation", fmt(analysis!.contractAtFirstConfirmation)],
        ["Contract now", fmt(analysis!.contractValueNow)],
        ["Variation impact", fmt(analysis!.contractVariance)],
        ["Approved revisions", String(analysis!.approvedVariationCount)],
        ["Committed vs baseline", SIGN_LABEL[analysis!.commitmentDriftSign]],
        ["Spent vs baseline", SIGN_LABEL[analysis!.costPerformanceSign]],
      ],
      counts: [
        ["Scope changes", String(changeOrders.length)],
        ["Scope changes pending decision", String(pendingChangeOrders.length)],
        ["Scope change total cost impact", fmt(totalScopeChangeImpact)],
        ["Milestones", String(milestones.length)],
        ["Milestones average completion", `${avgMilestoneCompletion}%`],
        ["Milestones completed", String(milestonesByStatus.completed ?? 0)],
        ["Timeline activities", String(tasks.length)],
        ["Activities on the critical path", String(criticalTaskCount)],
        ["Billing milestones", String(billingClaims.length)],
        ["Billing milestones overdue", String(overdueBillingClaims)],
      ],
    });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `project-360-${projectId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-px-muted">
        {projectName} — did we make the margin we quoted, and where did it go, combined with scope changes, billing milestones and schedule slippage.
      </p>
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button type="button" variant="outline" size="sm" onClick={downloadCsv} data-testid="project360-download-csv">
          <Download className="size-4" /> Download CSV
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => window.print()} data-testid="project360-print">
          <Printer className="size-4" /> Print / save as PDF
        </Button>
      </div>

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
          {confirmedNote && (
            <p role="status" className="mt-3 text-sm text-px-ink" data-testid="project360-baseline-confirmed">
              Baseline confirmed by you on {formatDateTime(confirmedNote.at)} (evidence: {confirmedNote.evidence}).
            </p>
          )}
          {!analysis.hasBaseline && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-px-muted">No baseline has been confirmed for this project's BOQ yet — the figures above will read "Not yet baselined" until one is.</p>
              {analysis.boqId ? (
                <div className="flex flex-wrap items-start gap-2">
                  <Input
                    aria-label="Evidence for the baseline"
                    id="baseline-evidence"
                    data-testid="baseline-evidence"
                    aria-invalid={confirmError ? true : undefined}
                    className="max-w-md"
                    placeholder="Evidence: PO number, signed proposal, email date…"
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    disabled={confirming}
                  />
                  <Button type="button" onClick={() => void confirmBaseline(analysis.boqId as string)} disabled={confirming}>
                    {confirming ? "Confirming…" : "Confirm baseline"}
                  </Button>
                  {confirmError && (
                    <div className="w-full">
                      <ActionFailurePanel failure={confirmError} entityType="boq" entityId={analysis.boqId as string} projectId={projectId} />
                    </div>
                  )}
                </div>
              ) : (
                <ActionFailurePanel
                  failure={codedFailure("NO_BOQ", "This project has no BOQ yet, so there is nothing to confirm as the baseline.")}
                  entityType="project"
                  projectId={projectId}
                />
              )}
            </div>
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
