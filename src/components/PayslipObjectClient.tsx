"use client";

// Real-screen conversion (2026-08-30): replaces the old nested
// "payslip detail" Dialog (opened from inside the Register Dialog -- a
// Dialog-on-Dialog) with a real Object Page. getPayslipDetail() already
// existed (built for the PDF route) but had no plain GET route -- added
// one this conversion. Real TDS override + Finalize stay identity-bridge-
// blocked exactly as before (see PayrollRunObjectClient.tsx's own comment
// for why that's a deliberate, pre-existing posture, not a regression).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type PayslipLine = { id: string; label: string; lineType: "earning" | "deduction"; amount: string };
type PayslipDetail = {
  payslip: { id: string; payrollRunId: string; status: string; netPay: string; lines: PayslipLine[] };
  employeeName: string;
};

export default function PayslipObjectClient({ runId, payslipId }: { runId: string; payslipId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<PayslipDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tdsAmount, setTdsAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchJson<PayslipDetail>(`/api/payroll/payslips/${payslipId}`);
      setDetail(data);
      setTdsAmount(data.payslip.lines.find((l) => l.label.startsWith("TDS"))?.amount ?? "");
      setLoadError(null);
    } catch (err) {
      setDetail(null);
      setLoadError(errorMessage(err, "Couldn't load this payslip"));
    }
  }
  useEffect(() => { load(); }, [payslipId]);

  async function saveTds() {
    setBusy("tds");
    try {
      const res = await fetch(`/api/payroll/payslips/${payslipId}/tds`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tdsAmount: Number(tdsAmount) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to update TDS");
      toast.success("TDS updated");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update TDS");
    } finally {
      setBusy(null);
    }
  }

  async function finalize() {
    setBusy("finalize");
    try {
      const res = await fetch(`/api/payroll/payslips/${payslipId}/finalize`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to finalize payslip");
      toast.success("Payslip finalized");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't finalize payslip");
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!detail) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const { payslip, employeeName } = detail;
  const isDraft = payslip.status === "draft";

  return (
    <ObjectScreen
      breadcrumb="Payroll / Payslip"
      title={`Payslip — ${employeeName}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: isDraft ? "neutral" : "done", label: payslip.status }}
      onBack={() => router.push(`/payroll/runs/${runId}`)}
      messages={[]}
    >
      <div className="flex justify-end px-4 pt-3">
        <Button size="sm" variant="outline" asChild>
          <a href={`/api/payroll/payslips/${payslipId}/pdf`} target="_blank" rel="noopener noreferrer"><FileText className="size-4" /> Download PDF</a>
        </Button>
      </div>
      <div className="px-4 py-3">
        <Table>
          <TableBody>
            {payslip.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.label}</TableCell>
                <TableCell className={l.lineType === "deduction" ? "text-right text-px-error" : "text-right"}>
                  {l.lineType === "deduction" ? "-" : ""}{Number(l.amount).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="font-semibold">Net Pay</TableCell>
              <TableCell className="text-right font-semibold">{Number(payslip.netPay).toLocaleString()}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        {isDraft && (
          <div className="mt-4 flex items-end gap-2 border-t border-ct-border pt-3">
            <div className="flex-1 space-y-1.5"><Label>TDS Amount (manual override)</Label><Input type="number" value={tdsAmount} onChange={(e) => setTdsAmount(e.target.value)} /></div>
            <Button variant="outline" disabled={busy === "tds"} onClick={saveTds}>{busy === "tds" ? "Saving…" : "Save TDS"}</Button>
            <Button disabled={busy === "finalize"} onClick={finalize}>{busy === "finalize" ? "Finalizing…" : "Finalize Payslip"}</Button>
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
