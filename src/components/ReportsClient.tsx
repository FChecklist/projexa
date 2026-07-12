"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Play } from "lucide-react";
import { ReportOutput } from "@/components/ReportOutput";

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

export default function ReportsClient({ projectId }: { projectId: string }) {
  const [reportName, setReportName] = useState("project-status");
  const [weekStart, setWeekStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [ranOnce, setRanOnce] = useState(false);

  async function runReport() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ projectId });
      if (reportName === "weekly-project") params.set("weekStart", weekStart);
      const res = await fetch(`/api/reports/${encodeURIComponent(reportName)}?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error);
      setResult(data);
      setRanOnce(true);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't generate report");
      setResult(null);
    } finally {
      setLoading(false);
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
            <p className="py-10 text-center text-sm text-px-muted">Couldn&apos;t generate this report.</p>
          ) : (
            <ReportOutput data={result} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
