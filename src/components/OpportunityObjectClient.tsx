"use client";

// Real-screen conversion (2026-08-30): replaces the old "History" Dialog
// popup with a real Object Page -- getOpportunity() already existed in
// crm-service.ts with no route until this conversion. Real facets + stage
// history + the inline stage-change control (already real, no Dialog) now
// live here too. Same scope boundary as LeadObjectClient.tsx: AI analysis
// (analyzeOpportunity), follow-up-task chaining, account-linking, and
// Delete are deliberately not built here.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

type Opportunity = {
  id: string; name: string; leadId: string | null; erpCustomerId: string | null; stage: string;
  estimatedValue: string | null; expectedCloseDate: string | null; ownerId: string | null;
};
type HistoryEntry = { id: string; fromStage: string | null; toStage: string; changedAt: string };
type Customer = { id: string; customerName: string };

const STAGE_OPTIONS = ["prospecting", "proposal", "negotiation", "won", "lost"];
const STAGE_TONE: Record<string, StatusTone> = { prospecting: "neutral", proposal: "waiting", negotiation: "waiting", won: "done", lost: "late" };

export default function OpportunityObjectClient({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const [opportunity, setOpportunity] = useState<Opportunity | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stageBusy, setStageBusy] = useState(false);

  async function load() {
    try {
      const [data, custData, historyData] = await Promise.all([
        fetchJson<Opportunity>(`/api/opportunities/${opportunityId}`),
        fetchJson<{ customers?: Customer[] }>("/api/customers").catch(() => ({ customers: [] })),
        fetchJson<{ history?: HistoryEntry[] }>(`/api/opportunities/${opportunityId}/history`).catch(() => ({ history: [] })),
      ]);
      setOpportunity(data);
      setCustomers(custData.customers ?? []);
      setHistory(historyData.history ?? []);
      setLoadError(null);
    } catch (err) {
      setOpportunity(null);
      setLoadError(errorMessage(err, "Couldn't load this opportunity"));
    }
  }
  useEffect(() => { load(); }, [opportunityId]);

  async function updateStage(stage: string) {
    setStageBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to update opportunity stage");
      toast.success(`Moved to ${stage}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update opportunity stage");
    } finally {
      setStageBusy(false);
    }
  }

  const customerName = customers.find((c) => c.id === opportunity?.erpCustomerId)?.customerName ?? opportunity?.erpCustomerId ?? "—";

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!opportunity) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Sales / Opportunity"
      title={opportunity.name}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STAGE_TONE[opportunity.stage] ?? "neutral", label: opportunity.stage }}
      facets={[
        { label: "Customer", value: customerName },
        { label: "Value", value: opportunity.estimatedValue ? `${currencyLabel(undefined, currencies)}${Number(opportunity.estimatedValue).toLocaleString()}` : "—" },
        { label: "Expected Close", value: opportunity.expectedCloseDate ?? "—" },
        { label: "Owner", value: opportunity.ownerId ?? "—" },
      ]}
      onBack={() => router.push("/sales/opportunities")}
      messages={[]}
    >
      <div className="flex items-center gap-2 border-b border-ct-border px-4 py-3">
        <Select value={opportunity.stage} onValueChange={updateStage}>
          <SelectTrigger className="h-8 w-40" disabled={stageBusy}><SelectValue /></SelectTrigger>
          <SelectContent>{STAGE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
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
