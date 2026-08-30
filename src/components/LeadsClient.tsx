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
// Priority 17 remaining gap (2026-07-15): crm_leads gained a companyId
// column (was orgId-only before this wave) -- reuses the exact selector
// AccountingClient.tsx already built, not a second copy. consolidate has no
// meaning for a flat leads list (no parent/sub-company tree to roll up),
// so the toggle is hidden here.
import { type Company, type CompanyScope, CompanySelector } from "@/components/company-scope";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

// Real-screen conversion (2026-08-30): "New Lead" routes to a real create
// screen (LeadCreateClient.tsx). Rows route to a real Object Page
// (LeadObjectClient.tsx, which gained a real detail view this conversion --
// getLead() existed in crm-service.ts but had no route) instead of the old
// "History" Dialog popup (the History icon/button is gone -- the Object
// Page's own facets + history log replace it). The inline status Select
// and bulk-reassign bar were already real (no Dialog) and stay unchanged.
type Lead = {
  id: string; name: string; contactEmail: string | null; contactPhone: string | null;
  source: string | null; status: string; ownerId: string | null; companyId: string | null;
  nextActionDate: string | null; nextActionNote: string | null; createdAt: string;
};

const STATUS_OPTIONS = ["new", "contacted", "qualified", "converted", "lost"];
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  new: "outline", contacted: "secondary", qualified: "default", converted: "default", lost: "destructive",
};

export default function LeadsClient() {
  const router = useRouter();
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (scope.companyId) params.set("companyId", scope.companyId);
      const data = await fetchJson<{ leads?: Lead[]; total?: number }>(`/api/leads?${params.toString()}`);
      setLeads(data.leads ?? []);
      setTotal(data.total ?? 0);
      setSelected(new Set());
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load leads"));
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter, scope.companyId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchJson<{ companies?: Company[] }>("/api/companies");
        setCompanies(data.companies ?? []);
      } catch {
        // Non-fatal -- CompanySelector renders nothing when companies is
        // empty, so a failed fetch just means no selector, not a broken page.
      }
    })();
  }, []);

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
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Lead" Dialog popup with a real create route. */}
        <Button onClick={() => router.push("/sales/leads/new")}><Plus className="size-4" /> New Lead</Button>
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
                  <TableHead>Status</TableHead><TableHead>Next Follow-up</TableHead><TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Real screen navigation (2026-08-30) -- rows open the
                    real Object Page, where the old "History" Dialog's
                    content now lives for real. */}
                {leads.map((l) => (
                  <TableRow key={l.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/sales/leads/${l.id}`)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(l.id)}
                        onCheckedChange={(c) => setSelected((prev) => { const next = new Set(prev); if (c) next.add(l.id); else next.delete(l.id); return next; })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell className="text-px-muted">{l.contactEmail ?? l.contactPhone ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{l.source ?? "—"}</TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Select value={l.status} onValueChange={(v) => updateStatus(l, v)}>
                        <SelectTrigger className="h-7 w-32 border-none p-0 shadow-none">
                          <Badge variant={STATUS_VARIANT[l.status] ?? "outline"}>{l.status}</Badge>
                        </SelectTrigger>
                        <SelectContent>{STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-px-muted">{l.nextActionDate ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{l.ownerId ?? "—"}</TableCell>
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
    </div>
  );
}
