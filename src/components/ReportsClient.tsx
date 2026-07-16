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
import { ReportOutput } from "@/components/ReportOutput";
import { ReportCatalogSection } from "@/components/ReportCatalogSection";

const REPORTS: { value: string; label: string }[] = [
  { value: "project-status", label: "Project Status" },
  { value: "project-completion", label: "Project Completion" },
  { value: "work-progress", label: "Work Progress" },
  { value: "category-progress", label: "Category Progress" },
  { value: "weekly-project", label: "Weekly Project (needs week start)" },
  { value: "attendance", label: "Attendance" },
  { value: "manpower-cost", label: "Manpower Cost" },
  { value: "site-picture", label: "Site Picture Log" },
  { value: "scope", label: "Scope (BOQ)" },
  { value: "budget-summary", label: "Budget Summary" },
  { value: "budget-vs-actual", label: "Budget vs Actual" },
  { value: "material-consumption", label: "Material Consumption" },
  { value: "vendor-cost", label: "Vendor Cost" },
  { value: "designer-timesheet", label: "Designer Timesheet" },
  { value: "kpi", label: "KPI" },
  { value: "revenue", label: "Revenue" },
  { value: "expense", label: "Expense" },
];

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
function ProjectReportsPanel({ projectId }: { projectId: string }) {
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
              <SelectContent>{REPORTS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
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
            <ReportOutput data={result} />
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
export default function ReportsClient({ projectId }: { projectId: string | null }) {
  return (
    <Tabs defaultValue={projectId ? "project" : "catalog"} className="space-y-4">
      <TabsList>
        <TabsTrigger value="project">Project Reports</TabsTrigger>
        <TabsTrigger value="catalog">Full Catalog</TabsTrigger>
      </TabsList>
      <TabsContent value="project">
        {projectId ? (
          <ProjectReportsPanel projectId={projectId} />
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
