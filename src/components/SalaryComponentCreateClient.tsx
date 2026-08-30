"use client";

// Real-screen conversion (2026-08-30): replaces PayrollClient.tsx's old
// "New Component" Dialog popup with a real create screen. No Object Page --
// no getSalaryComponent()/updateSalaryComponent() exists in
// erp-payroll-service.ts, matching Expenses' own "create-only" precedent.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function SalaryComponentCreateClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [componentType, setComponentType] = useState<"earning" | "deduction">("earning");
  const [calculationType, setCalculationType] = useState("flat");
  const [defaultAmount, setDefaultAmount] = useState("");
  const [defaultPercentage, setDefaultPercentage] = useState("");
  const [includeInPfWage, setIncludeInPfWage] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await fetchJson("/api/payroll/salary-components", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, componentType, calculationType,
          defaultAmount: defaultAmount ? Number(defaultAmount) : undefined,
          defaultPercentage: defaultPercentage ? Number(defaultPercentage) : undefined,
          includeInPfWage,
        }),
      });
      toast.success("Salary component created");
      router.push("/payroll?tab=components");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create salary component"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Payroll / New Salary Component"
      title="New Salary Component"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/payroll?tab=components")}
      onBack={() => router.push("/payroll?tab=components")}
      saveDisabled={submitting || !name.trim()}
      saveDisabledReason={submitting ? "Creating…" : !name.trim() ? "Name is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. HRA" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={componentType} onValueChange={(v) => setComponentType(v as "earning" | "deduction")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="earning">Earning</SelectItem><SelectItem value="deduction">Deduction</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Calculation</Label>
            <Select value={calculationType} onValueChange={setCalculationType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="flat">Flat</SelectItem>
                <SelectItem value="percentage_of_basic">% of Basic</SelectItem>
                <SelectItem value="percentage_of_gross">% of Gross</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Default Amount</Label><Input type="number" value={defaultAmount} onChange={(e) => setDefaultAmount(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Default %</Label><Input type="number" value={defaultPercentage} onChange={(e) => setDefaultPercentage(e.target.value)} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeInPfWage} onChange={(e) => setIncludeInPfWage(e.target.checked)} /> Include in PF wage</label>
      </div>
    </ObjectScreen>
  );
}
