"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { ReportCatalogSection } from "@/components/ReportCatalogSection";
import { ReportDocument } from "@/components/reports/ReportDocument";
import { ReportTableView } from "@/components/reports/ReportTableView";
import { isReportTable, reportTableToCsv } from "@/lib/report-table";
import { ProjexaReportScreen } from "@/components/screens/ProjexaReportScreen";
import { useOrgMoney } from "@/lib/use-org-money";
import { CurrencyNotSetNotice } from "@/components/CurrencyNotSetNotice";
import { formatDateTime, formatHourMinute } from "@/lib/format-date";
import { WORK_PROGRESS_REPORT_ROUTE } from "@/lib/report-registry";
import { DEFAULT_RUN_TIMEOUT_MS, timeoutSentence, useTimedRun } from "@/lib/use-timed-run";
import {
  NOT_SET,
  buildAttendanceDocument,
  buildProjectStatusDocument,
  buildScopeDocument,
  buildSitePictureDocument,
  buildWeeklyProjectDocument,
  documentToCsv,
  scopeFilterOptions,
  type BudgetVariancePayload,
  type ReportDocumentModel,
  type ScopePayload,
} from "@/lib/report-documents";

// R46 P8 seq126 (M28 registry-model proof, REPORT archetype -- function_id
// "reports.report"): intentionally the same fields as ScreenColumn so a
// registry row can be passed straight in with no reshaping.
export type RegistryColumn = ScreenColumn;

// R67 E-22 (R-199 / R-207 / R-224) -- REPORTS RENDER AS DOCUMENTS.
//
// THREE THINGS WERE WRONG, and this file fixes all three.
//
// 1. The result was a key-value card. ReportOutput's generic object renderer
//    printed the payload's own JSON keys against raw values, so Project
//    Status read "projectId g555imnoq4wihavpwc7t64um / contractValue 475000 /
//    percentByValue 25 / progressPercent 60" -- a database key a customer
//    cannot use, unformatted money, and two differently-derived percentages
//    disagreeing with nothing saying they measure different things. Sumeet's
//    named reports each have their own fixed column set; those column sets
//    now live in src/lib/report-documents.ts as pure builders and render
//    through one ReportDocument inside the kit's report chrome.
//
// 2. The loading branch never showed. The panel rendered
//    `!ranOnce ? "Pick a report and click Run Report." : loading ? spinner`
//    -- so on the FIRST run, which is the only run most sessions do, the
//    spinner branch was unreachable and the idle prompt sat there for the
//    whole request. The state is now one machine, running always wins, and it
//    says which report is running.
//
//    R67 E-30 (R-263) finished that job: the machine moved into the shared
//    useTimedRun hook, so the panel also has a live elapsed counter, a real
//    Cancel, a 20 s deadline with somewhere to go next, and a run stamp
//    ("Ran in 2.7 s at 14:02") above the output.
//
// 3. Nothing ran until the user pressed a button, even though every
//    parameter already had a default. The report now runs on arrival and on
//    every parameter change, and the button becomes Cancel while it runs.
//
// D-02: "Work Progress" is not run here. There is ONE Work Progress Report
// and it lives at /work-progress?tab=report; picking it here offers the link.
const DEFAULT_REPORT_COLUMNS: ScreenColumn[] = [
  { field: "project-status", label: "Project Status", type: "text", importance: "High" },
  { field: "project-completion", label: "Project Completion", type: "text", importance: "High" },
  { field: "work-progress", label: "Work Progress", type: "text", importance: "High" },
  { field: "category-progress", label: "Category Progress", type: "text", importance: "High" },
  { field: "weekly-project", label: "Weekly Project", type: "text", importance: "High" },
  { field: "attendance", label: "Attendance", type: "text", importance: "High" },
  { field: "manpower-cost", label: "Manpower Cost", type: "text", importance: "High" },
  { field: "site-picture", label: "Site Picture Log", type: "text", importance: "High" },
  { field: "scope", label: "Scope (BOQ)", type: "text", importance: "High" },
  { field: "budget-summary", label: "Budget Summary", type: "text", importance: "High" },
  { field: "budget-vs-actual", label: "Budget vs Actual", type: "text", importance: "High" },
  { field: "material-consumption", label: "Material Consumption", type: "text", importance: "High" },
  { field: "vendor-cost", label: "Vendor Cost", type: "text", importance: "High" },
  { field: "designer-timesheet", label: "Designer Timesheet", type: "text", importance: "High" },
  { field: "kpi", label: "KPI", type: "text", importance: "High" },
  { field: "revenue", label: "Revenue", type: "text", importance: "High" },
  { field: "expense", label: "Expense", type: "text", importance: "High" },
];

function columnLabel(columns: ScreenColumn[], field: string, fallback: string): string {
  return columns.find((c) => c.field === field)?.label || fallback;
}

function buildReports(registryColumns: RegistryColumn[] | null | undefined): { value: string; label: string }[] {
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : DEFAULT_REPORT_COLUMNS;
  return DEFAULT_REPORT_COLUMNS.map((c) => ({ value: c.field, label: columnLabel(columns, c.field, c.label) }));
}

/** The reports that have a real column set of their own. Everything else keeps the generic renderer, inside the same document chrome. */
const NAMED_REPORTS = new Set(["project-status", "weekly-project", "attendance", "site-picture", "scope"]);

/** A named report that needs the budget-variance lines as well as its own payload. */
const NEEDS_VARIANCE = new Set(["project-status", "scope"]);

// R67 E-30 (R-263). The run state machine is no longer this component's own.
// It is src/lib/use-timed-run.ts, which owns the AbortController, the
// one-second elapsed ticker, the 20 s deadline and the six states -- including
// the three ("failed", "timeout", "cancelled") that this panel used to collapse
// into one, and which need three different things said to the reader.
type RunResult = {
  primary: unknown;
  variance: BudgetVariancePayload | null;
};

function ProjectReportsPanel({
  projectId,
  projectName,
  generatedBy,
  reports,
  initialReport,
}: {
  projectId: string;
  projectName: string;
  generatedBy: string;
  reports: { value: string; label: string }[];
  initialReport: string;
}) {
  const [reportName, setReportName] = useState(initialReport);
  const [weekStart, setWeekStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [scopeCategory, setScopeCategory] = useState<string>("__all__");
  const [scopeVendor, setScopeVendor] = useState<string>("__all__");
  const orgMoney = useOrgMoney();

  // The hook keeps the stale-response guard this component used to own: every
  // run takes a generation and a late answer from a superseded, cancelled or
  // timed-out run never commits.
  const run = useTimedRun<RunResult>({ timeoutMs: DEFAULT_RUN_TIMEOUT_MS });
  // `run` is a new object each render; `run.run` and `run.reset` are stable
  // useCallbacks, so they can be dependencies directly.
  const startRun = run.run;
  const resetRun = run.reset;
  const result = run.result;

  const reportLabel = reports.find((r) => r.value === reportName)?.label ?? reportName;

  const runReport = useCallback(async () => {
    await startRun(async (signal) => {
      const params = new URLSearchParams({ projectId });
      if (reportName === "weekly-project") params.set("weekStart", weekStart);
      // R67 E-32 (R-265). WHICH SHAPE THIS REPORT IS ASKED FOR, and why there
      // are two.
      //
      // VERIDIAN now answers every report as { columns, rows, totals?,
      // currency } and keeps its own payload behind ?format=legacy for a
      // release. The five reports E-22 gave a real column set of their own
      // (report-documents.ts) read those payloads by field -- Sumeet's Project
      // Status carries a progress block and a subcontractor breakup, his
      // Attendance sheet a subtotal per trade, his Site Picture sheet a
      // date-grouped grid -- none of which is a flat table, and all of which is
      // richer than one. So those five keep asking for legacy; every other
      // report takes the table, which is what retires the JSON key-value dump
      // this panel used to fall back to.
      if (NAMED_REPORTS.has(reportName)) params.set("format", "legacy");

      const requests: Promise<Response>[] = [
        fetch(`/api/reports/${encodeURIComponent(reportName)}?${params.toString()}`, { signal }),
      ];
      if (NEEDS_VARIANCE.has(reportName)) {
        // The vendor/category detail Sumeet's Project Status and Scope sheets
        // need lives on budget-variance -- the only report that carries a
        // vendor and a category per BOQ line. Fetched alongside, never
        // fabricated from the other payload. Legacy for the same reason: these
        // builders read `lines`, not a table.
        requests.push(
          fetch(`/api/reports/budget-variance?format=legacy&projectId=${encodeURIComponent(projectId)}`, { signal })
        );
      }

      const [primaryRes, varianceRes] = await Promise.all(requests);
      const primary = await primaryRes.json();
      if (!primaryRes.ok) throw new Error(primary?.error || `The report service answered ${primaryRes.status}`);
      const variance = varianceRes && varianceRes.ok ? ((await varianceRes.json()) as BudgetVariancePayload) : null;
      return { primary, variance };
    });
  }, [projectId, reportName, weekStart, startRun]);

  // Run on arrival and on every parameter change: every parameter already has
  // a default, so making the reader press a button first bought nothing.
  useEffect(() => {
    if (reportName === "work-progress") {
      // D-02: this one is a link, not a run. reset() also aborts anything the
      // previous report left in flight.
      resetRun();
      return;
    }
    void runReport();
  }, [runReport, reportName, resetRun]);

  // R67 E-32: the server table, when this report answered as one.
  const tableResult = result && isReportTable(result.primary) ? result.primary : null;

  const varianceForFilters = result?.variance ?? null;
  const { categories, vendors } = scopeFilterOptions(varianceForFilters);

  let model: ReportDocumentModel | null = null;
  if (result && NAMED_REPORTS.has(reportName)) {
    if (reportName === "project-status") model = buildProjectStatusDocument(result.primary ?? {}, result.variance);
    else if (reportName === "weekly-project") model = buildWeeklyProjectDocument(result.primary ?? {});
    else if (reportName === "attendance") model = buildAttendanceDocument(result.primary ?? {});
    else if (reportName === "site-picture") model = buildSitePictureDocument(result.primary ?? {});
    else if (reportName === "scope") {
      model = buildScopeDocument((result.primary ?? {}) as ScopePayload, result.variance, {
        category: scopeCategory === "__all__" ? null : scopeCategory,
        vendor: scopeVendor === "__all__" ? null : scopeVendor,
      });
    }
  }

  function exportCsv() {
    // R67 E-32: a table report exports its own server-declared columns, so the
    // sheet a reader downloads has exactly the columns they were looking at --
    // and the same en-dash for a missing value, so a blank cell in the sheet
    // cannot be read as a zero.
    const csv = model ? documentToCsv(model, orgMoney.currency) : tableResult ? reportTableToCsv(tableResult) : null;
    if (csv === null) return;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${projectName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${reportName}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function share() {
    const url = `${window.location.origin}/reports?projectId=${encodeURIComponent(projectId)}&report=${encodeURIComponent(reportName)}`;
    try {
      await navigator.clipboard.writeText(url);
      // Said plainly: this is a link into the workspace, not a public one.
      toast.success("Link copied. It opens this report for anyone signed in to this workspace.");
    } catch {
      toast.error("Could not copy the link — your browser blocked clipboard access.");
    }
  }

  const revision =
    reportName === "scope" && result?.primary && typeof result.primary === "object" && "boq" in (result.primary as object)
      ? (() => {
          const boq = (result.primary as ScopePayload).boq;
          return boq ? `BOQ revision ${boq.version} (${boq.status})` : `BOQ revision ${NOT_SET}`;
        })()
      : undefined;

  const parameterBar = (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-px-border p-3">
      <div className="space-y-1.5">
        <Label>Report</Label>
        <Select value={reportName} onValueChange={setReportName}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>{reports.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {reportName === "weekly-project" && (
        <div className="space-y-1.5">
          <Label>Week start</Label>
          <Input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
        </div>
      )}
      {reportName === "scope" && (
        <>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={scopeCategory} onValueChange={setScopeCategory}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All categories</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Vendor</Label>
            <Select value={scopeVendor} onValueChange={setScopeVendor}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All vendors</SelectItem>
                {vendors.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </>
      )}
      {run.state === "running" ? (
        <Button variant="outline" onClick={() => run.cancel()}>Cancel</Button>
      ) : (
        <Button variant="outline" onClick={() => void runReport()}>Run again</Button>
      )}
    </div>
  );

  const body = (() => {
    if (reportName === "work-progress") {
      // D-02, stated rather than silently redirecting.
      return (
        <div className="space-y-2 py-8 text-center">
          <p className="text-sm text-px-muted">There is one Work Progress Report, and it runs on its own screen with its date range in the URL.</p>
          <Button asChild><Link href={`${WORK_PROGRESS_REPORT_ROUTE}&projectId=${encodeURIComponent(projectId)}`}>Open Work Progress Report</Link></Button>
        </div>
      );
    }
    // RUNNING always wins. The defect this replaces was an ordering bug: the
    // panel asked "have we run before?" first, so on a FIRST run -- the only
    // run most sessions do -- the idle prompt sat there for the whole request.
    if (run.state === "running") {
      return (
        <div className="flex h-40 flex-col items-center justify-center gap-3">
          <Loader2 className="size-5 animate-spin text-px-muted" aria-hidden />
          {/* R-263's own sentence, and the counter is what tells a reader
              "slow" from "broken". */}
          <p className="text-sm text-px-muted" aria-live="polite">
            Running {reportLabel} for {projectName}… {run.elapsedSeconds} s
          </p>
          <Button size="sm" variant="outline" onClick={() => run.cancel()}>Cancel</Button>
        </div>
      );
    }
    if (run.state === "timeout") {
      return (
        <div className="space-y-3 py-10 text-center">
          <p role="alert" className="text-sm text-px-error">{timeoutSentence(DEFAULT_RUN_TIMEOUT_MS)}</p>
          <div className="flex items-center justify-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void runReport()}>Run again</Button>
            {/* D-02: the one Work Progress Report, which is measured in
                seconds where this path was measured in tens of them. */}
            <Button size="sm" variant="outline" asChild>
              <Link href={`${WORK_PROGRESS_REPORT_ROUTE}&projectId=${encodeURIComponent(projectId)}`}>
                Open Work Progress › Report
              </Link>
            </Button>
          </div>
        </div>
      );
    }
    if (run.state === "failed") {
      return (
        <div className="space-y-3 py-10 text-center">
          <p role="alert" className="text-sm text-px-error">Could not run {reportLabel}: {run.error}</p>
          <Button size="sm" variant="outline" onClick={() => void runReport()}>Run again</Button>
        </div>
      );
    }
    if (run.state === "cancelled" && !result) {
      return <p className="py-10 text-center text-sm text-px-muted">Cancelled. Nothing was run.</p>;
    }
    if (!result) return <p className="py-10 text-center text-sm text-px-muted">Choosing a report runs it.</p>;
    return (
      <div className="space-y-3">
        {/* R67 E-30: the run stamp, above the output, in the org's own pinned
            formatter. "2.7 s" answers "was that slow?" and "14:02" answers
            "am I looking at a fresh number or one from before lunch?" -- the
            second question is the one a stale panel cannot answer at all. */}
        {run.ranAt !== null && run.durationMs !== null && (
          <p className="text-[12px] text-px-muted">
            Ran in {(run.durationMs / 1000).toFixed(1)} s at {formatHourMinute(run.ranAt)}
          </p>
        )}
        {model ? (
          <ReportDocument model={model} orgMoney={orgMoney} />
        ) : isReportTable(result.primary) ? (
          // R67 E-32: the twelve reports without a named column set are now
          // real tables too -- server-declared columns, units and totals,
          // rendered inside the same document chrome so the header block,
          // parameter bar and export actions are identical on every report.
          <ReportTableView table={result.primary} orgMoney={orgMoney} />
        ) : (
          // Only reachable against a VERIDIAN deployment older than E-32. Said
          // in words rather than silently falling back to a JSON dump, because
          // a dump is exactly what this item removed and a quiet regression to
          // it would be invisible.
          <p role="alert" className="py-6 text-center text-sm text-px-error">
            This report came back in an older format that this screen can no longer render. Refresh, or ask an
            administrator to update VERIDIAN.
          </p>
        )}
      </div>
    );
  })();

  return (
    <div className="space-y-4">
      <ProjexaReportScreen
        breadcrumb={`Reports / ${reportLabel}`}
        headerBlock={{
          project: <Link href={`/dashboard/project?projectId=${encodeURIComponent(projectId)}`} className="hover:underline">{projectName}</Link>,
          revision,
          period: reportName === "weekly-project" ? `Week of ${weekStart}` : undefined,
          // Provenance for the document itself -- the full date and the
          // author, which is what an exported or shared sheet needs on it.
          // How LONG the run took is run feedback, not provenance, and it is
          // said once above the output (R67 E-30) rather than twice here.
          generatedAt: run.ranAt !== null ? formatDateTime(run.ranAt) : "—",
          generatedBy,
        }}
        parameterBar={parameterBar}
        shareAction={{ label: "Share", onClick: () => void share(), disabledReason: result ? undefined : "Share (run the report first)" }}
        exportCsvAction={{
          label: "Export CSV",
          onClick: exportCsv,
          // R67 E-32: every report now has a fixed column set -- a named
          // document's own, or the server's declared columns -- so the reason
          // that used to sit here ("this report has no fixed column set yet")
          // is no longer true of anything and is gone.
          disabledReason: model || tableResult ? undefined : "Export CSV (run the report first)",
        }}
        exportPdfAction={{
          label: "Export PDF",
          // Honest, not a stub: a PDF is rendered SERVER-side (projexa must
          // gain no PDF library, D-09/C06-13), and the only server renderer
          // that exists today is the Work Progress one. Until the generic
          // relay lands, this control says which report can be exported
          // rather than producing a broken file.
          disabledReason: "Export PDF (server-rendered; only Work Progress has a renderer today)",
        }}
      >
        {body}
      </ProjexaReportScreen>
      <CurrencyNotSetNotice currencySet={orgMoney.currencySet} loaded={orgMoney.loaded} />
    </div>
  );
}

export default function ReportsClient({
  projectId,
  projectName,
  generatedBy,
  registryColumns,
  requestedReport,
}: {
  projectId: string | null;
  projectName?: string | null;
  generatedBy?: string | null;
  registryColumns?: RegistryColumn[] | null;
  /**
   * The Full Catalog's "Open" action deep-links here with ?report=<name>.
   * Read on the SERVER and passed in, deliberately -- useSearchParams() in a
   * client component forces a Suspense bailout at build time, and this page's
   * route already reads its own searchParams.
   */
  requestedReport?: string | null;
}) {
  const reports = buildReports(registryColumns);
  const initialReport =
    requestedReport && reports.some((r) => r.value === requestedReport) ? requestedReport : "project-status";

  return (
    <Tabs defaultValue={projectId ? "project" : "catalog"} className="space-y-4">
      <TabsList>
        <TabsTrigger value="project">Project Reports</TabsTrigger>
        <TabsTrigger value="catalog">Full Catalog</TabsTrigger>
      </TabsList>
      <TabsContent value="project">
        {projectId ? (
          <ProjectReportsPanel
            projectId={projectId}
            projectName={projectName || "This project"}
            generatedBy={generatedBy || "your account"}
            reports={reports}
            initialReport={initialReport}
          />
        ) : (
          <Card className="shadow-card">
            <CardContent className="p-8 text-center text-sm text-px-muted">
              No active projects yet -- the 17 project-scoped construction reports need one. The Full Catalog tab works org-wide, no project required.
            </CardContent>
          </Card>
        )}
      </TabsContent>
      <TabsContent value="catalog">
        <ReportCatalogSection />
      </TabsContent>
    </Tabs>
  );
}
