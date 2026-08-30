"use client";

// Real-screen conversion (2026-08-30): replaces KpisClient.tsx's old "New
// KPI" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function KpiCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [metricName, setMetricName] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [unit, setUnit] = useState("");
  const [period, setPeriod] = useState("monthly");
  const [submitting, setSubmitting] = useState(false);

  async function createDefinition() {
    if (!metricName.trim()) return;
    setSubmitting(true);
    try {
      const definition = await fetchJson<{ id: string }>("/api/kpis", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, metricName, targetValue: targetValue ? Number(targetValue) : undefined,
          unit: unit || undefined, period,
        }),
      });
      toast.success("KPI created");
      router.push(`/kpis/${definition.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create KPI"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="KPIs / New KPI"
      title="New KPI Definition"
      mode="create"
      hasDraft={false}
      onSave={createDefinition}
      onCancel={() => router.push(`/kpis?projectId=${projectId}`)}
      onBack={() => router.push(`/kpis?projectId=${projectId}`)}
      saveDisabled={submitting || !metricName.trim()}
      saveDisabledReason={submitting ? "Creating…" : !metricName.trim() ? "Metric name is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Metric Name</Label><Input value={metricName} onChange={(e) => setMetricName(e.target.value)} placeholder="e.g. Schedule Variance" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Target Value (optional)</Label><Input type="number" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Unit (optional)</Label><Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="%, days, ₹" /></div>
        </div>
        <div className="space-y-1.5">
          <Label>Period</Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
              <SelectItem value="milestone">Milestone</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </ObjectScreen>
  );
}
