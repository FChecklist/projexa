"use client";

// Real-screen conversion (2026-08-30): replaces the old "History" Dialog
// popup with a real Object Page -- getLead() already existed in
// crm-service.ts (Priority 15) with no route until this conversion. Real
// facets + stage history + the inline status-change control (already real,
// no Dialog) now live here too, not just on the list row.
//
// Deliberately NOT built here (same scope boundary the existing PATCH
// route's own comment already drew before this conversion): AI lead
// scoring (scoreLead), follow-up-task chaining, and Delete (deleteLead
// needs a real role-gated actor context and blocks on linked opportunities)
// -- real, separately-built CRM depth this pass doesn't surface, same class
// of decision as Procurement's RFQ scoring/negotiation/auctions (module #22).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

type Lead = {
  id: string; name: string; contactEmail: string | null; contactPhone: string | null;
  source: string | null; status: string; ownerId: string | null; nextActionDate: string | null; nextActionNote: string | null;
};
type HistoryEntry = { id: string; fromStage: string | null; toStage: string; note: string | null; changedAt: string };

const STATUS_OPTIONS = ["new", "contacted", "qualified", "converted", "lost"];
const STATUS_TONE: Record<string, StatusTone> = { new: "neutral", contacted: "waiting", qualified: "waiting", converted: "done", lost: "late" };

export default function LeadObjectClient({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  async function load() {
    try {
      const [data, historyData] = await Promise.all([
        fetchJson<Lead>(`/api/leads/${leadId}`),
        fetchJson<{ history?: HistoryEntry[] }>(`/api/leads/${leadId}/history`).catch(() => ({ history: [] })),
      ]);
      setLead(data);
      setHistory(historyData.history ?? []);
      setLoadError(null);
    } catch (err) {
      setLead(null);
      setLoadError(errorMessage(err, "Couldn't load this lead"));
    }
  }
  useEffect(() => { load(); }, [leadId]);

  async function updateStatus(status: string) {
    setStatusBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to update lead status");
      toast.success(`Moved to ${status}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update lead status");
    } finally {
      setStatusBusy(false);
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
  if (!lead) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Sales / Lead"
      title={lead.name}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[lead.status] ?? "neutral", label: lead.status }}
      facets={[
        { label: "Contact", value: lead.contactEmail ?? lead.contactPhone ?? "—" },
        { label: "Source", value: lead.source ?? "—" },
        { label: "Owner", value: lead.ownerId ?? "—" },
        { label: "Next Follow-up", value: lead.nextActionDate ?? "—" },
      ]}
      onBack={() => router.push("/sales/leads")}
      messages={[]}
    >
      <div className="flex items-center gap-2 border-b border-ct-border px-4 py-3">
        <Select value={lead.status} onValueChange={updateStatus}>
          <SelectTrigger className="h-8 w-40" disabled={statusBusy}><SelectValue /></SelectTrigger>
          <SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="px-4 py-3">
        <h4 className="mb-2 text-sm font-semibold text-ct-navy">Stage History</h4>
        {history.length === 0 ? (
          <p className="text-sm text-ct-muted">No stage changes recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-md border border-ct-border px-3 py-2 text-sm">
                <span>{h.fromStage ? `${h.fromStage} → ${h.toStage}` : `Created as ${h.toStage}`}</span>
                <span className="text-ct-muted">{formatDate(h.changedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
