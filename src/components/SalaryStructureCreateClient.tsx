"use client";

// Real-screen conversion (2026-08-30): replaces PayrollClient.tsx's old
// "New Salary Structure" Dialog popup with a real create screen. No Object
// Page -- no getSalaryStructure()/updateSalaryStructure() exists, matching
// Expenses' own "create-only" precedent.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Employee = { id: string; name: string };
type SalaryComponent = { id: string; name: string };

export default function SalaryStructureCreateClient() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [components, setComponents] = useState<SalaryComponent[]>([]);
  const [employeeId, setEmployeeId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [ctcAnnual, setCtcAnnual] = useState("");
  const [state, setState] = useState("");
  const [rows, setRows] = useState<{ componentId: string; amount: string; percentage: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ employees?: Employee[] }>("/api/employees").then((d) => setEmployees(d.employees ?? [])).catch(() => {});
    fetchJson<{ components?: SalaryComponent[] }>("/api/payroll/salary-components").then((d) => setComponents(d.components ?? [])).catch(() => {});
  }, []);

  function addRow() { setRows((r) => [...r, { componentId: "", amount: "", percentage: "" }]); }
  function removeRow(i: number) { setRows((r) => r.filter((_, idx) => idx !== i)); }

  const missing = [
    ...(employeeId ? [] : ["Employee"]),
    ...(effectiveFrom ? [] : ["Effective date"]),
    ...(ctcAnnual ? [] : ["Annual CTC"]),
    ...(rows.length ? [] : ["At least one component"]),
  ];

  async function create() {
    if (missing.length) { toast.error(missing.join(", ")); return; }
    setSubmitting(true);
    try {
      await fetchJson("/api/payroll/salary-structures", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId, effectiveFrom, ctcAnnual: Number(ctcAnnual), state: state || undefined,
          components: rows.filter((r) => r.componentId).map((r) => ({
            componentId: r.componentId, amount: r.amount ? Number(r.amount) : undefined, percentage: r.percentage ? Number(r.percentage) : undefined,
          })),
        }),
      });
      toast.success("Salary structure created");
      router.push("/payroll?tab=structures");
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create salary structure"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Payroll / New Salary Structure"
      title="New Salary Structure"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/payroll?tab=structures")}
      onBack={() => router.push("/payroll?tab=structures")}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Creating…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Employee</Label>
          <Select value={employeeId} onValueChange={setEmployeeId}>
            <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
            <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Effective From</Label><Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Annual CTC</Label><Input type="number" value={ctcAnnual} onChange={(e) => setCtcAnnual(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label>State (optional, for Professional Tax)</Label><Input value={state} onChange={(e) => setState(e.target.value)} /></div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Components</Label>
            <Button size="sm" variant="outline" onClick={addRow}><Plus className="size-3" /> Add</Button>
          </div>
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select value={row.componentId} onValueChange={(v) => setRows((r) => r.map((x, idx) => idx === i ? { ...x, componentId: v } : x))}>
                <SelectTrigger className="flex-1"><SelectValue placeholder="Component" /></SelectTrigger>
                <SelectContent>{components.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input className="w-24" placeholder="Amount" type="number" value={row.amount} onChange={(e) => setRows((r) => r.map((x, idx) => idx === i ? { ...x, amount: e.target.value } : x))} />
              <Input className="w-20" placeholder="%" type="number" value={row.percentage} onChange={(e) => setRows((r) => r.map((x, idx) => idx === i ? { ...x, percentage: e.target.value } : x))} />
              <Button size="icon" variant="ghost" onClick={() => removeRow(i)}><Trash2 className="size-4" /></Button>
            </div>
          ))}
        </div>
      </div>
    </ObjectScreen>
  );
}
