"use client";

// Real-screen conversion (2026-08-30): replaces PayrollClient.tsx's old
// "New Payroll Run" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function PayrollRunCreateClient() {
  const router = useRouter();
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [submitting, setSubmitting] = useState(false);

  async function createRun() {
    setSubmitting(true);
    try {
      const run = await fetchJson<{ id: string }>("/api/payroll/runs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: Number(month), year: Number(year) }),
      });
      toast.success("Payroll run created");
      router.push(`/payroll/runs/${run.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create payroll run"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Payroll / New Run"
      title="New Payroll Run"
      mode="create"
      hasDraft={false}
      onSave={createRun}
      onCancel={() => router.push("/payroll")}
      onBack={() => router.push("/payroll")}
      saveDisabled={submitting}
      saveDisabledReason={submitting ? "Creating…" : undefined}
      messages={[]}
    >
      <div className="grid grid-cols-2 gap-2 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Month</Label>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>Year</Label><Input type="number" value={year} onChange={(e) => setYear(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
