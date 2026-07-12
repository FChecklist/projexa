"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Play } from "lucide-react";

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

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cellValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Adaptive renderer: 17 reports each return a different shape, so this
 * renders arrays-of-objects as tables and scalar object fields as a
 * key/value summary grid, rather than hand-building 17 bespoke views. */
function ReportOutput({ data }: { data: unknown }) {
  if (Array.isArray(data)) {
    if (data.length === 0) return <p className="py-6 text-center text-sm text-px-muted">No rows returned.</p>;
    const columns = isPlainObject(data[0]) ? Object.keys(data[0]) : ["value"];
    return (
      <Table>
        <TableHeader><TableRow>{columns.map((c) => <TableHead key={c}>{c}</TableHead>)}</TableRow></TableHeader>
        <TableBody>
          {data.map((row, i) => (
            <TableRow key={i}>
              {columns.map((c) => <TableCell key={c}>{cellValue(isPlainObject(row) ? row[c] : row)}</TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  if (isPlainObject(data)) {
    const scalarEntries = Object.entries(data).filter(([, v]) => !Array.isArray(v) && !isPlainObject(v));
    const nestedEntries = Object.entries(data).filter(([, v]) => Array.isArray(v) || isPlainObject(v));
    return (
      <div className="space-y-4">
        {scalarEntries.length > 0 && (
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            {scalarEntries.map(([k, v]) => (
              <div key={k}>
                <div className="text-xs text-px-muted">{k}</div>
                <div className="font-medium text-px-ink">{cellValue(v)}</div>
              </div>
            ))}
          </div>
        )}
        {nestedEntries.map(([k, v]) => (
          <div key={k} className="space-y-2">
            <div className="text-sm font-semibold text-px-ink">{k}</div>
            <ReportOutput data={v} />
          </div>
        ))}
      </div>
    );
  }

  return <p className="text-sm text-px-ink">{cellValue(data)}</p>;
}

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
