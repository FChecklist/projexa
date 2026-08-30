"use client";

// Real-screen conversion (2026-08-30): KPI definitions never had a real,
// URL-addressable detail view -- clicking "View Entries" in the old client
// only set local state. Real Object Page on the kit's ObjectScreen. No
// generic Edit/Delete -- no updateKpiDefinition()/deleteKpiDefinition()
// exists in construction-kpi-service.ts, so neither is offered.
//
// Real capability closed by this conversion: KPI entries could be
// submitted but never approved from PROJEXA -- approveKpiEntry() has
// existed since Wave 117 with a real, working route, but only for a
// VERIDIAN session user, never PROJEXA's Bearer-key caller. See the new
// v1/construction/kpi-entries/[id]/approve/route.ts's own comment for why
// its self-approval check is a real business rule (not a bug) that stays
// fully intact -- an entry submitted AND approved through the same shared
// PROJEXA org API key genuinely is the same actor, so a 403 there is
// correct and shown verbatim via toast, not hidden.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type KpiDefinition = { id: string; projectId: string | null; metricName: string; targetValue: string | null; unit: string | null; period: string };
type KpiEntry = { id: string; period: string; actualValue: string; approvalStatus: string; filledById: string; createdAt: string };

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", submitted: "waiting", approved: "done" };

export default function KpiObjectClient({ definitionId }: { definitionId: string }) {
  const router = useRouter();
  const [definition, setDefinition] = useState<KpiDefinition | null>(null);
  const [entries, setEntries] = useState<KpiEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entryPeriod, setEntryPeriod] = useState("");
  const [actualValue, setActualValue] = useState("");
  const [entrySubmitting, setEntrySubmitting] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  async function load() {
    try {
      const [def, entryData] = await Promise.all([
        fetchJson<KpiDefinition>(`/api/kpis/${definitionId}`),
        fetchJson<{ entries?: KpiEntry[] }>(`/api/kpi-entries?kpiDefinitionId=${encodeURIComponent(definitionId)}`),
      ]);
      setDefinition(def);
      setEntries(entryData.entries ?? []);
      setLoadError(null);
    } catch (err) {
      setDefinition(null);
      setLoadError(errorMessage(err, "Couldn't load this KPI"));
    }
  }
  useEffect(() => { load(); }, [definitionId]);

  async function submitEntry() {
    if (!entryPeriod.trim() || actualValue === "") { toast.error("Period and actual value are required"); return; }
    setEntrySubmitting(true);
    try {
      const res = await fetch("/api/kpi-entries", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kpiDefinitionId: definitionId, period: entryPeriod, actualValue: Number(actualValue) }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to submit entry");
      toast.success("Actual value submitted");
      setEntryPeriod(""); setActualValue("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit entry");
    } finally {
      setEntrySubmitting(false);
    }
  }

  async function approveEntry(entryId: string) {
    setApprovingId(entryId);
    try {
      const res = await fetch(`/api/kpi-entries/${entryId}/approve`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to approve entry");
      toast.success("Entry approved");
      await load();
    } catch (err) {
      // Real backend validation (e.g. "The submitter cannot approve their
      // own KPI entry") surfaces verbatim -- never swallowed.
      toast.error(err instanceof Error ? err.message : "Couldn't approve entry");
    } finally {
      setApprovingId(null);
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
  if (!definition) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const backHref = definition.projectId ? `/kpis?projectId=${definition.projectId}` : "/kpis";

  return (
    <ObjectScreen
      breadcrumb="KPIs / Definition"
      title={definition.metricName}
      mode="display"
      hasDraft={false}
      facets={[
        { label: "Target", value: definition.targetValue ? `${definition.targetValue}${definition.unit ? ` ${definition.unit}` : ""}` : "—" },
        { label: "Period", value: definition.period },
      ]}
      onBack={() => router.push(backHref)}
      messages={[]}
    >
      <div className="flex flex-wrap items-end gap-2 border-b border-ct-border px-4 py-3">
        <div className="space-y-1.5"><Label>Period</Label><Input value={entryPeriod} onChange={(e) => setEntryPeriod(e.target.value)} placeholder="e.g. 2026-07" className="w-40" /></div>
        <div className="space-y-1.5"><Label>Actual Value</Label><Input type="number" value={actualValue} onChange={(e) => setActualValue(e.target.value)} className="w-32" /></div>
        <Button size="sm" disabled={entrySubmitting} onClick={submitEntry}>{entrySubmitting ? "Submitting…" : "Submit Actual Value"}</Button>
      </div>

      {entries.length === 0 ? (
        <p className="py-10 text-center text-sm text-ct-muted">No actual values submitted yet.</p>
      ) : (
        <Table>
          <TableHeader><TableRow><TableHead>Period</TableHead><TableHead>Actual</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {entries.map((e) => {
              const tone = STATUS_TONE[e.approvalStatus] ?? "neutral";
              return (
                <TableRow key={e.id}>
                  <TableCell>{e.period}</TableCell>
                  <TableCell>{e.actualValue}</TableCell>
                  <TableCell><Badge variant={tone === "done" ? "default" : tone === "waiting" ? "secondary" : "outline"}>{e.approvalStatus}</Badge></TableCell>
                  <TableCell className="text-right">
                    {e.approvalStatus === "submitted" && (
                      <Button size="sm" variant="outline" disabled={approvingId === e.id} onClick={() => approveEntry(e.id)}>
                        {approvingId === e.id ? "Approving…" : "Approve"}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </ObjectScreen>
  );
}
