"use client";

// Real-screen conversion (2026-08-30): replaces PayrollClient.tsx's old
// "New Slab" Dialog popup with a real create screen. No Object Page -- no
// getIncomeTaxSlab()/updateIncomeTaxSlab() exists, matching Expenses' own
// "create-only" precedent.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function IncomeTaxSlabCreateClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [standardDeduction, setStandardDeduction] = useState("");
  const [rateRows, setRateRows] = useState<{ fromAmount: string; toAmount: string; percentDeduction: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  function addRow() { setRateRows((r) => [...r, { fromAmount: "", toAmount: "", percentDeduction: "" }]); }
  function removeRow(i: number) { setRateRows((r) => r.filter((_, idx) => idx !== i)); }

  const missing = [...(name.trim() ? [] : ["Name"]), ...(effectiveFrom ? [] : ["Effective date"]), ...(rateRows.length ? [] : ["At least one rate band"])];

  async function create() {
    if (missing.length) { toast.error(missing.join(", ")); return; }
    setSubmitting(true);
    try {
      await fetchJson("/api/payroll/income-tax-slabs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, effectiveFrom, standardDeduction: standardDeduction ? Number(standardDeduction) : undefined,
          rates: rateRows.filter((r) => r.fromAmount && r.percentDeduction).map((r) => ({
            fromAmount: Number(r.fromAmount), toAmount: r.toAmount ? Number(r.toAmount) : undefined, percentDeduction: Number(r.percentDeduction),
          })),
        }),
      });
      toast.success("Income tax slab created");
      router.push("/payroll?tab=tax");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create income tax slab"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Payroll / New Income Tax Slab"
      title="New Income Tax Slab"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/payroll?tab=tax")}
      onBack={() => router.push("/payroll?tab=tax")}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Creating…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New Regime FY26-27" /></div>
          <div className="space-y-1.5"><Label>Effective From</Label><Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label>Standard Deduction</Label><Input type="number" value={standardDeduction} onChange={(e) => setStandardDeduction(e.target.value)} /></div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Rate Bands</Label>
            <Button size="sm" variant="outline" onClick={addRow}><Plus className="size-3" /> Add</Button>
          </div>
          {rateRows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input placeholder="From" type="number" value={row.fromAmount} onChange={(e) => setRateRows((r) => r.map((x, idx) => idx === i ? { ...x, fromAmount: e.target.value } : x))} />
              <Input placeholder="To (blank = no cap)" type="number" value={row.toAmount} onChange={(e) => setRateRows((r) => r.map((x, idx) => idx === i ? { ...x, toAmount: e.target.value } : x))} />
              <Input placeholder="Rate %" type="number" value={row.percentDeduction} onChange={(e) => setRateRows((r) => r.map((x, idx) => idx === i ? { ...x, percentDeduction: e.target.value } : x))} />
              <Button size="icon" variant="ghost" onClick={() => removeRow(i)}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </div>
      </div>
    </ObjectScreen>
  );
}
