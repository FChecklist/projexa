"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Target } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import LoadError from "@/components/LoadError";

type KpiDefinition = { id: string; metricName: string; targetValue: string | null; unit: string | null; period: string };
type KpiEntry = { id: string; period: string; actualValue: string; approvalStatus: string; createdAt: string };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", submitted: "secondary", approved: "default",
};

export default function KpisClient({ projectId }: { projectId: string }) {
  const [definitions, setDefinitions] = useState<KpiDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [selected, setSelected] = useState<KpiDefinition | null>(null);
  const [entries, setEntries] = useState<KpiEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);

  const [defOpen, setDefOpen] = useState(false);
  const [metricName, setMetricName] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [unit, setUnit] = useState("");
  const [period, setPeriod] = useState("monthly");
  const [defSubmitting, setDefSubmitting] = useState(false);

  const [entryPeriod, setEntryPeriod] = useState("");
  const [actualValue, setActualValue] = useState("");
  const [entrySubmitting, setEntrySubmitting] = useState(false);

  // R52 Gate 2 / A4S14_kpis_01. The recorded diagnosis is about the PAGE-level
  // error ("Could not load projects: VERIDIAN request timed out ...") having no
  // retry affordance -- that half is fixed in kpis/page.tsx, which now renders
  // ProjectLoadError (backend's own words + a working Retry) instead of an inert
  // red Card. This half is the module's own call, which had the usual res.ok
  // swallow: a 504 became "No KPIs defined for this project yet."
  async function loadDefinitions() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJson<{ definitions?: KpiDefinition[] }>(`/api/kpis?projectId=${encodeURIComponent(projectId)}`);
      setDefinitions(data.definitions ?? []);
    } catch (err) {
      setDefinitions([]);
      const msg = errorMessage(err, "Couldn't load KPIs");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadDefinitions(); }, [projectId]);

  async function loadEntries(def: KpiDefinition) {
    setSelected(def);
    setEntriesLoading(true);
    setEntriesError(null);
    try {
      const data = await fetchJson<{ entries?: KpiEntry[] }>(`/api/kpi-entries?kpiDefinitionId=${encodeURIComponent(def.id)}`);
      setEntries(data.entries ?? []);
    } catch (err) {
      // An unreadable KPI history must not read as "this metric was never
      // recorded" -- that is a number a reviewer would act on.
      setEntries([]);
      const msg = errorMessage(err, "Couldn't load KPI entries");
      setEntriesError(msg);
      toast.error(msg);
    } finally {
      setEntriesLoading(false);
    }
  }

  async function createDefinition() {
    if (!metricName.trim()) return;
    setDefSubmitting(true);
    try {
      const res = await fetch("/api/kpis", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, metricName, targetValue: targetValue ? Number(targetValue) : undefined,
          unit: unit || undefined, period,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("KPI created");
      setMetricName(""); setTargetValue(""); setUnit(""); setDefOpen(false);
      loadDefinitions();
    } catch {
      toast.error("Couldn't create KPI");
    } finally {
      setDefSubmitting(false);
    }
  }

  async function submitEntry() {
    if (!selected || !entryPeriod.trim() || actualValue === "") return;
    setEntrySubmitting(true);
    try {
      const res = await fetch("/api/kpi-entries", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kpiDefinitionId: selected.id, period: entryPeriod, actualValue: Number(actualValue) }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error);
      }
      toast.success("Actual value submitted");
      setEntryPeriod(""); setActualValue("");
      loadEntries(selected);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't submit entry");
    } finally {
      setEntrySubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={defOpen} onOpenChange={setDefOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New KPI</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New KPI Definition</DialogTitle></DialogHeader>
            <div className="space-y-3">
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
            <DialogFooter><Button onClick={createDefinition} disabled={defSubmitting}>{defSubmitting ? "Creating…" : "Create KPI"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            /* Error BEFORE empty. The empty state states a fact about the
               user's data and may only be shown when the read succeeded. */
            <div className="p-4"><LoadError message={loadError} onRetry={loadDefinitions} /></div>
          ) : definitions.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No KPIs defined for this project yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Metric</TableHead><TableHead>Target</TableHead><TableHead>Period</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {definitions.map((d) => (
                  <TableRow key={d.id} className={selected?.id === d.id ? "bg-px-surface-muted" : ""}>
                    <TableCell className="flex items-center gap-2 font-medium"><Target className="size-4 text-px-muted" />{d.metricName}</TableCell>
                    <TableCell className="text-px-muted">{d.targetValue ? `${d.targetValue}${d.unit ? ` ${d.unit}` : ""}` : "—"}</TableCell>
                    <TableCell><Badge variant="outline">{d.period}</Badge></TableCell>
                    <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => loadEntries(d)}>View Entries</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selected && (
        <Card className="shadow-card">
          <CardHeader><CardTitle className="text-base">Actual Values — {selected.metricName}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-2">
              <div className="space-y-1.5"><Label>Period</Label><Input value={entryPeriod} onChange={(e) => setEntryPeriod(e.target.value)} placeholder="e.g. 2026-07" className="w-40" /></div>
              <div className="space-y-1.5"><Label>Actual Value</Label><Input type="number" value={actualValue} onChange={(e) => setActualValue(e.target.value)} className="w-32" /></div>
              <Button onClick={submitEntry} disabled={entrySubmitting}>{entrySubmitting ? "Submitting…" : "Submit"}</Button>
            </div>
            {entriesLoading ? (
              <div className="grid h-20 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
            ) : entriesError ? (
              <LoadError message={entriesError} onRetry={() => loadEntries(selected)} />
            ) : entries.length === 0 ? (
              <p className="py-6 text-center text-sm text-px-muted">No actual values submitted yet.</p>
            ) : (
              <Table>
                <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Actual</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{e.period}</TableCell>
                      <TableCell>{e.actualValue}</TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[e.approvalStatus] ?? "outline"}>{e.approvalStatus}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
