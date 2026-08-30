"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

// Real-screen conversion (2026-08-30): "New Opportunity" routes to a real
// create screen (OpportunityCreateClient.tsx). Rows route to a real Object
// Page (OpportunityObjectClient.tsx, which gained a real detail view this
// conversion -- getOpportunity() existed in crm-service.ts but had no
// route) instead of the old "History" Dialog popup. The inline stage
// Select and bulk-reassign bar were already real (no Dialog) and stay
// unchanged.
type Opportunity = {
  id: string; name: string; leadId: string | null; erpCustomerId: string | null; stage: string;
  estimatedValue: string | null; expectedCloseDate: string | null; ownerId: string | null;
  nextActionDate: string | null;
};
type Customer = { id: string; customerName: string };

const STAGE_OPTIONS = ["prospecting", "proposal", "negotiation", "won", "lost"];
const STAGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  prospecting: "outline", proposal: "secondary", negotiation: "secondary", won: "default", lost: "destructive",
};

export default function OpportunitiesClient() {
  const router = useRouter();
  const currencies = useCurrencies();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOwnerId, setBulkOwnerId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      if (stageFilter !== "all") params.set("stage", stageFilter);
      const data = await fetchJson<{ opportunities?: Opportunity[]; total?: number }>(`/api/opportunities?${params.toString()}`);
      setOpportunities(data.opportunities ?? []);
      setTotal(data.total ?? 0);
      setSelected(new Set());
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load opportunities"));
    } finally {
      setLoading(false);
    }
  }, [page, search, stageFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/customers").then((r) => r.json()).then((d) => setCustomers(d.customers ?? [])).catch(() => {}); }, []);

  async function updateStage(opp: Opportunity, stage: string) {
    try {
      const res = await fetch(`/api/opportunities/${opp.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }),
      });
      if (!res.ok) throw new Error();
      toast.success(`${opp.name} moved to ${stage}`);
      load();
    } catch {
      toast.error("Couldn't update opportunity stage");
    }
  }

  async function bulkReassign() {
    if (!selected.size || !bulkOwnerId.trim()) return;
    try {
      const res = await fetch("/api/opportunities/bulk-reassign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityIds: Array.from(selected), ownerId: bulkOwnerId }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Reassigned ${selected.size} opportunity(ies)`);
      setBulkOwnerId("");
      load();
    } catch {
      toast.error("Couldn't bulk-reassign opportunities");
    }
  }

  const customerName = (id: string | null) => customers.find((c) => c.id === id)?.customerName ?? id ?? "—";
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search opportunities…" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} className="w-56" />
          <Select value={stageFilter} onValueChange={(v) => { setPage(1); setStageFilter(v); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Stage" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {STAGE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Opportunity" Dialog popup with a real create route. */}
        <Button onClick={() => router.push("/sales/opportunities/new")}><Plus className="size-4" /> New Opportunity</Button>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-px-orange/30 bg-px-orange/5 px-3 py-2 text-sm">
          <span>{selected.size} selected</span>
          <Input placeholder="Owner user ID" value={bulkOwnerId} onChange={(e) => setBulkOwnerId(e.target.value)} className="h-8 w-48" />
          <Button size="sm" onClick={bulkReassign} disabled={!bulkOwnerId.trim()}>Bulk Reassign</Button>
        </div>
      )}

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : opportunities.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No opportunities found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={selected.size === opportunities.length && opportunities.length > 0}
                      onCheckedChange={(c) => setSelected(c ? new Set(opportunities.map((o) => o.id)) : new Set())}
                    />
                  </TableHead>
                  <TableHead>Name</TableHead><TableHead>Customer</TableHead><TableHead>Value</TableHead>
                  <TableHead>Stage</TableHead><TableHead>Expected Close</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Real screen navigation (2026-08-30) -- rows open the
                    real Object Page, where the old "History" Dialog's
                    content now lives for real. */}
                {opportunities.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/sales/opportunities/${o.id}`)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(o.id)}
                        onCheckedChange={(c) => setSelected((prev) => { const next = new Set(prev); if (c) next.add(o.id); else next.delete(o.id); return next; })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{o.name}</TableCell>
                    <TableCell className="text-px-muted">{customerName(o.erpCustomerId)}</TableCell>
                    <TableCell className="text-px-muted">{o.estimatedValue ? `${currencyLabel(undefined, currencies)}${Number(o.estimatedValue).toLocaleString("en-US")}` : "—"}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Select value={o.stage} onValueChange={(v) => updateStage(o, v)}>
                        <SelectTrigger className="h-7 w-32 border-none p-0 shadow-none">
                          <Badge variant={STAGE_VARIANT[o.stage] ?? "outline"}>{o.stage}</Badge>
                        </SelectTrigger>
                        <SelectContent>{STAGE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-px-muted">{o.expectedCloseDate ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {total > pageSize && (
        <div className="flex items-center justify-between text-sm text-px-muted">
          <span>Page {page} of {totalPages} — {total} opportunity(ies)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
