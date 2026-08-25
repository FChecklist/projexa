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
import { formatDate } from "@/lib/format-date";
// Priority 17 remaining gap (2026-07-15): crm_leads gained a companyId
// column (was orgId-only before this wave) -- reuses the exact selector
// AccountingClient.tsx already built, not a second copy. consolidate has no
// meaning for a flat leads list (no parent/sub-company tree to roll up),
// so the toggle is hidden here.
import { type Company, type CompanyScope, CompanySelector } from "@/components/company-scope";

type Lead = {
  id: string; name: string; contactEmail: string | null; contactPhone: string | null;
  source: string | null; status: string; ownerId: string | null; companyId: string | null;
  nextActionDate: string | null; nextActionNote: string | null; createdAt: string;
};

type HistoryEntry = { id: string; fromStage: string | null; toStage: string; note: string | null; changedAt: string };

const STATUS_OPTIONS = ["new", "contacted", "qualified", "converted", "lost"];
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  new: "outline", contacted: "secondary", qualified: "default", converted: "default", lost: "destructive",
};

export default function LeadsClient() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOwnerId, setBulkOwnerId] = useState("");

  // Priority 17 remaining gap: companies list + the list-level filter scope.
  // Defaults to "All companies" -- an org that hasn't set up companies/
  // offices yet (or a lead never attributed to one) sees no change at all.
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scope, setScope] = useState<CompanyScope>({ companyId: null, consolidate: false });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [source, setSource] = useState("");
  const [nextActionDate, setNextActionDate] = useState("");
  const [leadCompanyId, setLeadCompanyId] = useState<string>("__none__");
  const [submitting, setSubmitting] = useState(false);

  const [historyFor, setHistoryFor] = useState<Lead | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (scope.companyId) params.set("companyId", scope.companyId);
      const res = await fetch(`/api/leads?${params.toString()}`);
      const data = await res.json();
      setLeads(data.leads ?? []);
      setTotal(data.total ?? 0);
      setSelected(new Set());
    } catch {
      toast.error("Couldn't load leads");
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, scope.companyId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/companies");
        const data = await res.json();
        setCompanies(data.companies ?? []);
      } catch {
        // Non-fatal -- CompanySelector renders nothing when companies is
        // empty, so a failed fetch just means no selector, not a broken page.
      }
    })();
  }, []);

  async function createLead() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/leads", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, contactEmail: contactEmail || undefined, contactPhone: contactPhone || undefined,
          source: source || undefined, nextActionDate: nextActionDate || undefined,
          companyId: leadCompanyId === "__none__" ? undefined : leadCompanyId,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Lead created");
      setName(""); setContactEmail(""); setContactPhone(""); setSource(""); setNextActionDate(""); setLeadCompanyId("__none__"); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't create lead");
    } finally {
      setSubmitting(false);
    }
  }

  async function updateStatus(lead: Lead, status: string) {
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      toast.success(`${lead.name} moved to ${status}`);
      load();
    } catch {
      toast.error("Couldn't update lead status");
    }
  }

  async function bulkReassign() {
    if (!selected.size || !bulkOwnerId.trim()) return;
    try {
      const res = await fetch("/api/leads/bulk-reassign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: Array.from(selected), ownerId: bulkOwnerId }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Reassigned ${selected.size} lead(s)`);
      setBulkOwnerId("");
      load();
    } catch {
      toast.error("Couldn't bulk-reassign leads");
    }
  }

  async function openHistory(lead: Lead) {
    setHistoryFor(lead);
    try {
      const res = await fetch(`/api/leads/${lead.id}/history`);
      const data = await res.json();
      setHistory(data.history ?? []);
    } catch {
      toast.error("Couldn't load history");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <CompanySelector companies={companies} scope={scope} onChange={(s) => { setPage(1); setScope(s); }} showConsolidateToggle={false} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search leads…" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} className="w-56" />
          <Select value={statusFilter} onValueChange={(v) => { setPage(1); setStatusFilter(v); }}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New Lead</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Lead</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Email (optional)</Label><Input value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Phone (optional)</Label><Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Source (optional)</Label><Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. referral, website" /></div>
                <div className="space-y-1.5"><Label>Next Follow-up (optional)</Label><Input type="date" value={nextActionDate} onChange={(e) => setNextActionDate(e.target.value)} /></div>
              </div>
              {companies.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Company / Office (optional)</Label>
                  <Select value={leadCompanyId} onValueChange={setLeadCompanyId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Unattributed</SelectItem>
                      {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <DialogFooter><Button onClick={createLead} disabled={submitting}>{submitting ? "Creating…" : "Create Lead"}</Button></DialogFooter>
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
          ) : leads.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No leads found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">
                    <Checkbox
                      checked={selected.size === leads.length && leads.length > 0}
                      onCheckedChange={(c) => setSelected(c ? new Set(leads.map((l) => l.id)) : new Set())}
                    />
                  </TableHead>
                  <TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Source</TableHead>
                  <TableHead>Status</TableHead><TableHead>Next Follow-up</TableHead><TableHead>Owner</TableHead><TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(l.id)}
                        onCheckedChange={(c) => setSelected((prev) => { const next = new Set(prev); if (c) next.add(l.id); else next.delete(l.id); return next; })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell className="text-px-muted">{l.contactEmail ?? l.contactPhone ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{l.source ?? "—"}</TableCell>
                    <TableCell>
                      <Select value={l.status} onValueChange={(v) => updateStatus(l, v)}>
                        <SelectTrigger className="h-7 w-32 border-none p-0 shadow-none">
                          <Badge variant={STATUS_VARIANT[l.status] ?? "outline"}>{l.status}</Badge>
                        </SelectTrigger>
                        <SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-px-muted">{l.nextActionDate ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{l.ownerId ?? "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => openHistory(l)}><History className="size-4" /></Button>
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
          <span>Page {page} of {totalPages} — {total} lead(s)</span>
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
                <span className="text-px-muted">{formatDate(h.changedAt)}</span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
