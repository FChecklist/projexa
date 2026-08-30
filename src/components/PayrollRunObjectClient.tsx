"use client";

// Real-screen conversion (2026-08-30): replaces the old "View Register"
// Dialog popup with a real Object Page. No generic Edit/Delete -- a payroll
// run has no update/delete function, only Process (draft -> processed).
//
// Real, pre-existing, deliberate constraint (not introduced by this
// conversion): processPayrollRun() requires a real VERIDIAN session user
// for its audit trail (same posture as every payroll write action --
// createPayrollRun/updatePayslipTds/finalizePayslip/every master-data
// create) and 400s with "This action requires a real user session, not an
// API key" for PROJEXA's Bearer-key caller. The Process button below calls
// the real route and shows that real message via toast if blocked -- same
// behavior the old Dialog-based UI already had, not a new regression. See
// PROJEXA_REAL_SCREEN_CONVERSION_TRACKER.md module #21 (mirrors Employees'
// module #8 finding).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlayCircle, FileDown } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDateTime } from "@/lib/format-date";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type PayrollRun = { id: string; month: number; year: number; status: string; processedAt: string | null };
type Payslip = { id: string; employeeId: string; employeeName: string; grossEarnings: string; totalDeductions: string; netPay: string; status: string };

// Real enum (erp_payroll_run_status): draft | processed | paid | cancelled
// -- confirmed against the live schema, not assumed from the old UI (which
// only ever distinguished "processed" from everything else).
const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", processed: "waiting", paid: "done", cancelled: "late" };

export default function PayrollRunObjectClient({ runId }: { runId: string }) {
  const router = useRouter();
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  async function load() {
    try {
      const [runData, payslipData] = await Promise.all([
        fetchJson<PayrollRun>(`/api/payroll/runs/${runId}`),
        fetchJson<{ payslips?: Payslip[] }>(`/api/payroll/runs/${runId}/payslips`).catch(() => ({ payslips: [] })),
      ]);
      setRun(runData);
      setPayslips(payslipData.payslips ?? []);
      setLoadError(null);
    } catch (err) {
      setRun(null);
      setLoadError(errorMessage(err, "Couldn't load this payroll run"));
    }
  }
  useEffect(() => { load(); }, [runId]);

  async function process() {
    setProcessing(true);
    try {
      const res = await fetch(`/api/payroll/runs/${runId}/process`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to process payroll run");
      toast.success(`Processed -- ${data.payslipCount ?? 0} payslip(s) generated`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't process payroll run");
    } finally {
      setProcessing(false);
    }
  }

  function exportCsv() {
    if (payslips.length === 0) return;
    const header = "Employee,Gross Earnings,Total Deductions,Net Pay,Status";
    const rows = payslips.map((p) => `${p.employeeName},${p.grossEarnings},${p.totalDeductions},${p.netPay},${p.status}`);
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-register-${run?.year}-${String(run?.month).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!run) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Payroll / Run"
      title={`${MONTHS[run.month - 1]} ${run.year}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[run.status] ?? "neutral", label: run.status }}
      facets={[{ label: "Processed", value: run.processedAt ? formatDateTime(run.processedAt) : "—" }]}
      onBack={() => router.push("/payroll")}
      messages={[]}
    >
      <div className="flex items-center gap-2 border-b border-ct-border px-4 py-3">
        {run.status === "draft" && (
          <Button size="sm" disabled={processing} onClick={process}><PlayCircle className="size-4" /> {processing ? "Processing…" : "Process"}</Button>
        )}
        <Button size="sm" variant="outline" disabled={payslips.length === 0} onClick={exportCsv}><FileDown className="size-4" /> Export CSV</Button>
      </div>
      {payslips.length === 0 ? (
        <p className="py-10 text-center text-sm text-ct-muted">No payslips yet — process this run first.</p>
      ) : (
        <Table>
          <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Gross</TableHead><TableHead>Deductions</TableHead><TableHead>Net Pay</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {payslips.map((p) => (
              <TableRow key={p.id} className="cursor-pointer hover:bg-ct-cloud/40" onClick={() => router.push(`/payroll/runs/${runId}/payslips/${p.id}`)}>
                <TableCell className="font-medium">{p.employeeName}</TableCell>
                <TableCell>{Number(p.grossEarnings).toLocaleString()}</TableCell>
                <TableCell>{Number(p.totalDeductions).toLocaleString()}</TableCell>
                <TableCell className="font-medium">{Number(p.netPay).toLocaleString()}</TableCell>
                <TableCell><Badge variant={p.status === "finalized" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </ObjectScreen>
  );
}
