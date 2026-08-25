"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Play } from "lucide-react";
import type { ScreenColumn } from "@fchecklist/veridian-ui-kit/screens";
import { ReportOutput } from "@/components/ReportOutput";
import { ReportCatalogSection } from "@/components/ReportCatalogSection";

// R46 P8 seq126 (M28 registry-model proof, REPORT archetype -- function_id
// "reports.report"): intentionally the same fields as ScreenColumn so a
// registry row (compliance.screen_definitions) can be passed straight in
// with no reshaping, same pattern as ScopeClient's RegistryColumn.
export type RegistryColumn = ScreenColumn;

// Fallback + canonical list of report VALUES (the API path segment each
// report actually runs against -- never registry-driven, changing these
// would break /api/reports/[reportName]). Mirrors the registry seed 1:1 for
// LABEL text, so there is no visible difference between "resolved from the
// DB" and this hardcoded default (M28: keep the hardcoded version behind a
// flag until verified).
const DEFAULT_REPORT_COLUMNS: ScreenColumn[] = [
  { field: "project-status", label: "Project Status", type: "text", importance: "High" },
  { field: "project-completion", label: "Project Completion", type: "text", importance: "High" },
  { field: "work-progress", label: "Work Progress", type: "text", importance: "High" },
  { field: "category-progress", label: "Category Progress", type: "text", importance: "High" },
  { field: "weekly-project", label: "Weekly Project (needs week start)", type: "text", importance: "High" },
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

// Builds the picker's {value,label} list: VALUES always come from
// DEFAULT_REPORT_COLUMNS (the fixed, never-registry-driven set of report
// API paths this page knows how to run); LABELS resolve against the
// registry row when present, else the same hardcoded text. Only what the
// user reads changes -- report selection, execution, and the Full Catalog
// tab are untouched, same "labels only" contract as boq.custom.
function buildReports(registryColumns: RegistryColumn[] | null | undefined): { value: string; label: string }[] {
  const columns = registryColumns && registryColumns.length > 0 ? registryColumns : DEFAULT_REPORT_COLUMNS;
  return DEFAULT_REPORT_COLUMNS.map((c) => ({ value: c.field, label: columnLabel(columns, c.field, c.label) }));
}

// CONS-02 (R46 P4 consistency sweep): project-status's own response
// legitimately returns two differently-derived, intentionally-distinct
// percent-complete fields on one payload (percentByValue: value-weighted
// against the current BOQ; progressPercent: flat average of each
// activity's latest logged percentComplete, no BOQ scoping -- both real,
// both documented in construction-dashboard-service.ts#getProjectDashboard()).
// ReportOutput's generic renderer otherwise shows bare JSON key names, so
// this page previously showed "percentByValue" and "progressPercent" next
// to each other with nothing telling a real user they measure different
// things. Keyed by report value so only project-status is affected; every
// other report keeps ReportOutput's default bare-key-name display untouched.
const REPORT_FIELD_LABELS: Record<string, Record<string, string>> = {
  "project-status": {
    percentByValue: "% Complete by BOQ Value",
    progressPercent: "% Complete by Activity Log",
  },
};

// Priority 17 follow-on (CONTROLLER.yaml PRIORITY-17
// projexa_reports_dispatch_2026_07_16, Owner: "look at the PROJEXA reports
// gaps and fill it. For customer facing app, reports and analysis is
// important."): this page previously offered ONLY the fixed 17-report list
// below (ProjectReportsPanel) -- a real, working, project-scoped view over
// construction-reports-service.ts, kept as-is, not regressed. EXTENDED
// (not replaced) with a second tab, "Full Catalog", covering the ~230-entry
// report_definitions catalog (report-engine-service.ts's
// getFullReportCatalog()/executeReportDefinition()) that no PROJEXA page
// consumed before this. The two are genuinely different, both kept: this
// fixed list needs an active project and only covers 17 construction
// reports; the catalog tab is org-wide, searchable, and covers every
// report/analysis type across the whole platform (ERP, compliance,
// AI-ops, custom, plus these same 17 construction reports again via their
// own report_definitions rows where they exist there too).
function ProjectReportsPanel({ projectId, reports }: { projectId: string; reports: { value: string; label: string }[] }) {
  const [reportName, setReportName] = useState("project-status");
  const [weekStart, setWeekStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [ranOnce, setRanOnce] = useState(false);

  // Priority 19 (Dubai 50-user E2E test + fix pass, "GAP -- Reports" entry):
  // guards against an out-of-order/stale fetch response overwriting a more
  // recent one's state -- e.g. the user switches the report type and clicks
  // "Run Report" again before the first request resolves; without this, a
  // slower first response landing after a faster second one would silently
  // clobber the correct, more recent result (or vice versa, a slow response
  // for a report the user has since navigated away from could still commit
  // state after the fact). Bumped at the start of every runReport() call;
  // any resolving fetch whose captured generation no longer matches the
  // latest is dropped instead of touching state.
  const requestGeneration = useRef(0);

  async function runReport() {
    const myGeneration = ++requestGeneration.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ projectId });
      if (reportName === "weekly-project") params.set("weekStart", weekStart);
      const res = await fetch(`/api/reports/${encodeURIComponent(reportName)}?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      if (myGeneration !== requestGeneration.current) return; // a newer request has since superseded this one
      setResult(data);
      setRanOnce(true);
    } catch (err) {
      if (myGeneration !== requestGeneration.current) return;
      toast.error(err instanceof Error && err.message ? err.message : "Could not generate report");
      setResult(null);
    } finally {
      if (myGeneration === requestGeneration.current) setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="shadow-card">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label>Report</Label>
            <Select value={reportName} onValueChange={setReportName}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>{reports.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {reportName === "weekly-project" && (
            <div className="space-y-1.5"><Label>Week Start</Label><Input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} /></div>
          )}
          <Button onClick={runReport} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Run Report
          </Button>
        </CardContent>
      </Card>

      <Card className="shadow-card">
        <CardContent className="p-4">
          {!ranOnce ? (
            <p className="py-10 text-center text-sm text-px-muted">Pick a report and click Run Report.</p>
          ) : loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : result === null ? (
            <p className="py-10 text-center text-sm text-px-muted">Could not generate this report.</p>
          ) : (
            <ReportOutput data={result} fieldLabels={REPORT_FIELD_LABELS[reportName]} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Priority 17 follow-on: projectId is now nullable -- the org-wide catalog
// tab does not need one. Only this "Project Reports" tab needs an active
// project; it now shows its own honest empty state instead of the whole
// page refusing to render (see reports/page.tsx).
//
// R46 P8 seq126: registryColumns is resolved server-side in reports/page.tsx
// (compliance.screen_definitions, function_id "reports.report", archetype
// REPORT) and only relabels the report picker -- null/missing is not fatal,
// buildReports() falls back to DEFAULT_REPORT_COLUMNS.
export default function ReportsClient({ projectId, registryColumns }: { projectId: string | null; registryColumns?: RegistryColumn[] | null }) {
  const reports = buildReports(registryColumns);
  return (
    <Tabs defaultValue={projectId ? "project" : "catalog"} className="space-y-4">
      <TabsList>
        <TabsTrigger value="project">Project Reports</TabsTrigger>
        <TabsTrigger value="catalog">Full Catalog</TabsTrigger>
      </TabsList>
      <TabsContent value="project">
        {projectId ? (
          <ProjectReportsPanel projectId={projectId} reports={reports} />
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
