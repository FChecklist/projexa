"use client";

// Real-screen conversion (2026-08-30): replaces PayrollClient.tsx's old
// "New Statutory Rule" Dialog popup with a real create screen. No Object
// Page -- no getStatutoryRule()/updateStatutoryRule() exists, matching
// Expenses' own "create-only" precedent.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function StatutoryRuleCreateClient() {
  const router = useRouter();
  const [ruleType, setRuleType] = useState<"pf" | "esi" | "professional_tax">("pf");
  const [state, setState] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [employeeRate, setEmployeeRate] = useState("");
  const [employerRate, setEmployerRate] = useState("");
  const [wageCeiling, setWageCeiling] = useState("");
  const [slabRows, setSlabRows] = useState<{ uptoAmount: string; taxAmount: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  function addSlabRow() { setSlabRows((r) => [...r, { uptoAmount: "", taxAmount: "" }]); }
  function removeSlabRow(i: number) { setSlabRows((r) => r.filter((_, idx) => idx !== i)); }

  async function create() {
    if (!effectiveFrom) { toast.error("Effective date is required"); return; }
    setSubmitting(true);
    try {
      await fetchJson("/api/payroll/statutory-rules", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruleType, state: state || undefined, effectiveFrom,
          employeeRate: employeeRate ? Number(employeeRate) : undefined,
          employerRate: employerRate ? Number(employerRate) : undefined,
          wageCeiling: wageCeiling ? Number(wageCeiling) : undefined,
          slabs: ruleType === "professional_tax" && slabRows.length
            ? slabRows.filter((r) => r.uptoAmount && r.taxAmount).map((r) => ({ uptoAmount: Number(r.uptoAmount), taxAmount: Number(r.taxAmount) }))
            : undefined,
        }),
      });
      toast.success("Statutory rule created");
      router.push("/payroll?tab=statutory");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create statutory rule"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Payroll / New Statutory Rule"
      title="New Statutory Rule"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/payroll?tab=statutory")}
      onBack={() => router.push("/payroll?tab=statutory")}
      saveDisabled={submitting || !effectiveFrom}
      saveDisabledReason={submitting ? "Creating…" : !effectiveFrom ? "Effective date is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Rule Type</Label>
            <Select value={ruleType} onValueChange={(v) => setRuleType(v as typeof ruleType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="pf">Provident Fund</SelectItem>
                <SelectItem value="esi">ESI</SelectItem>
                <SelectItem value="professional_tax">Professional Tax</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Effective From</Label><Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></div>
        </div>
        {ruleType === "professional_tax" ? (
          <>
            <div className="space-y-1.5"><Label>State</Label><Input value={state} onChange={(e) => setState(e.target.value)} placeholder="e.g. Maharashtra" /></div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Slabs (up to amount → tax amount)</Label>
                <Button size="sm" variant="outline" onClick={addSlabRow}><Plus className="size-3" /> Add</Button>
              </div>
              {slabRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input placeholder="Upto amount" type="number" value={row.uptoAmount} onChange={(e) => setSlabRows((r) => r.map((x, idx) => idx === i ? { ...x, uptoAmount: e.target.value } : x))} />
                  <Input placeholder="Tax amount" type="number" value={row.taxAmount} onChange={(e) => setSlabRows((r) => r.map((x, idx) => idx === i ? { ...x, taxAmount: e.target.value } : x))} />
                  <Button size="icon" variant="ghost" onClick={() => removeSlabRow(i)}><Trash2 className="size-4" /></Button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5"><Label>Employee Rate %</Label><Input type="number" value={employeeRate} onChange={(e) => setEmployeeRate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Employer Rate %</Label><Input type="number" value={employerRate} onChange={(e) => setEmployerRate(e.target.value)} /></div>
            <div className="col-span-2 space-y-1.5"><Label>Wage Ceiling</Label><Input type="number" value={wageCeiling} onChange={(e) => setWageCeiling(e.target.value)} /></div>
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
