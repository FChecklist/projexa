"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, History } from "lucide-react";

type Opportunity = {
  id: string; name: string; leadId: string | null; erpCustomerId: string | null; stage: string;
  estimatedValue: string | null; expectedCloseDate: string | null; ownerId: string | null;
  nextActionDate: string | null;
};
type HistoryEntry = { id: string; fromStage: string | null; toStage: string; changedAt: string };
type Customer = { id: string; customerName: string };

const STAGE_OPTIONS = ["prospecting", "proposal", "negotiation", "won", "lost"];
const STAGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  prospecting: "outline", proposal: "secondary", negotiation: "secondary", won: "default", lost: "destructive",
};

export default function OpportunitiesClient() {
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

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [erpCustomerId, setErpCustomerId] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [historyFor, setHistoryFor] = useState<Opportunity | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      if (stageFilter !== "all") params.set("stage", stageFilter);
      const res = await fetch(`/api/opportunities?${params.toString()}`);
      const data = await res.json();
      setOpportunities(data.opportunities ?? []);
      setTotal(data.total ?? 0);
      setSelected(new Set());
    } catch {
      toast.error("Couldn't load opportunities");
    } finally {
      setLoading(false);
    }
  }, [page, search, stageFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/customers").then((r) => r.json()).then((d) => setCustomers(d.customers ?? [])).catch(() => {}); }, []);

  async function createOpportunity() {
    if (!name.trim() || !erpCustomerId) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/opportunities", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, erpCustomerId, estimatedValue: estimatedValue ? Number(estimatedValue) : undefined,
          expectedCloseDate: expectedCloseDate || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Opportunity created");
      setName(""); setErpCustomerId(""); setEstimatedValue(""); setExpectedCloseDate(""); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't create opportunity");
    } finally {
      setSubmitting(false);
    }
  }

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

  async function openHistory(opp: Opportunity) {
    setHistoryFor(opp);
    try {
      const res = await fetch(`/api/opportunities/${opp.id}/history`);
      const data = await res.json();
      setHistory(data.history ?? []);
    } catch {
      toast.error("Couldn't load history");
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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New Opportunity</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Opportunity</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label>Customer</Label>
                <Select value={erpCustomerId} onValueChange={setErpCustomerId}>
                  <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                  <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customerName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Estimated Value (optional)</Label><Input type="number" value={estimatedValue} onChange={(e) => setEstimatedValue(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Expected Close (optional)</Label><Input type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} /></div>
              </div>
            </div>
            <DialogFooter><Button onClick={createOpportunity} disabled={submitting || !erpCustomerId}>{submitting ? "Creating…" : "Create Opportunity"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
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
                  <TableHead>Stage</TableHead><TableHead>Expected Close</TableHead><TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opportunities.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(o.id)}
                        onCheckedChange={(c) => setSelected((prev) => { const next = new Set(prev); if (c) next.add(o.id); else next.delete(o.id); return next; })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{o.name}</TableCell>
                    <TableCell className="text-px-muted">{customerName(o.erpCustomerId)}</TableCell>
                    <TableCell className="text-px-muted">{o.estimatedValue ? `₹${Number(o.estimatedValue).toLocaleString("en-IN")}` : "—"}</TableCell>
                    <TableCell>
                      <Select value={o.stage} onValueChange={(v) => updateStage(o, v)}>
                        <SelectTrigger className="h-7 w-32 border-none p-0 shadow-none">
                          <Badge variant={STAGE_VARIANT[o.stage] ?? "outline"}>{o.stage}</Badge>
                        </SelectTrigger>
                        <SelectContent>{STAGE_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-px-muted">{o.expectedCloseDate ?? "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => openHistory(o)}><History className="size-4" /></Button>
                    </TableCell>
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

      <Dialog open={!!historyFor} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{historyFor?.name} — Stage History</DialogTitle></DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {history.length === 0 ? (
              <p className="py-6 text-center text-sm text-px-muted">No stage changes recorded yet.</p>
            ) : history.map((h) => (
              <div key={h.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span>{h.fromStage ? `${h.fromStage} → ${h.toStage}` : `Created as ${h.toStage}`}</span>
                <span className="text-px-muted">{new Date(h.changedAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
