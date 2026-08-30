"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";
import { currencyLabel, useCurrencies } from "@/lib/currency";
// Priority 17 final gap (2026-07-16): erp_quotations gained a companyId
// column this wave -- reuses the exact selector AccountingClient.tsx/
// LeadsClient.tsx already built (company-scope.tsx), not a second copy.
// consolidate has no meaning for a flat quotations list (no parent/sub-
// company tree to roll up), so the toggle is hidden here, same as Leads.
import { type Company, type CompanyScope, CompanySelector } from "@/components/company-scope";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

// Real-screen conversion (2026-08-30): "New Quotation" routes to a real
// create screen (SalesQuotationCreateClient.tsx). Rows route to a real
// Object Page (SalesQuotationObjectClient.tsx, which gained a real detail
// view this conversion -- getQuotation() didn't exist before, only
// getQuotationForPdf) instead of the inline status/convert/revision/PDF
// action buttons, all of which moved there.
type Quotation = {
  id: string; quotationNumber: number; customerId: string | null; customerName: string | null;
  quotationDate: string; validTill: string | null; status: string; version: number; revisionOf: string | null;
  companyId: string | null;
  currencyId: string | null; exchangeRate: string; grandTotal: string;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", pending_approval: "secondary", approved: "secondary", sent: "default", ordered: "default", lost: "destructive", expired: "destructive",
};
const STATUS_OPTIONS = ["draft", "pending_approval", "approved", "sent", "ordered", "lost", "expired"];

export default function QuotationsClient() {
  const router = useRouter();
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const currencies = useCurrencies();

  // Priority 17 final gap: companies list + the list-level filter scope.
  // Defaults to "All companies" -- an org that hasn't set up companies/
  // offices yet (or a quotation never attributed to one) sees no change.
  const [companies, setCompanies] = useState<Company[]>([]);
  const [scope, setScope] = useState<CompanyScope>({ companyId: null, consolidate: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (scope.companyId) params.set("companyId", scope.companyId);
      const data = await fetchJson<{ quotations?: Quotation[]; total?: number }>(`/api/quotations?${params.toString()}`);
      setQuotations(data.quotations ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load quotations"));
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

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <CompanySelector companies={companies} scope={scope} onChange={(s) => { setPage(1); setScope(s); }} showConsolidateToggle={false} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search by customer…" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} className="w-56" />
          <Select value={statusFilter} onValueChange={(v) => { setPage(1); setStatusFilter(v); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {/* Real screen navigation (2026-08-30) -- replaces the old "New
            Quotation" Dialog popup with a real create route. */}
        <Button onClick={() => router.push("/quotations/new")}><Plus className="size-4" /> New Quotation</Button>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : quotations.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No quotations found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead><TableHead>Customer</TableHead><TableHead>Date</TableHead>
                  <TableHead>Version</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Real screen navigation (2026-08-30) -- rows open the
                    real Object Page, where status transitions/Convert/
                    Revision/PDF now all live. */}
                {quotations.map((q) => (
                  <TableRow key={q.id} className="cursor-pointer hover:bg-px-cloud/40" onClick={() => router.push(`/quotations/${q.id}`)}>
                    <TableCell className="font-medium">{q.quotationNumber}</TableCell>
                    <TableCell className="text-px-muted">{q.customerName ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{q.quotationDate}</TableCell>
                    <TableCell className="text-px-muted">v{q.version}{q.revisionOf ? " (revision)" : ""}</TableCell>
                    <TableCell className="text-px-muted">
                      {currencyLabel(q.currencyId, currencies)}{Number(q.grandTotal).toLocaleString("en-US")}
                    </TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[q.status] ?? "outline"}>{q.status.replace("_", " ")}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {total > pageSize && (
        <div className="flex items-center justify-between text-sm text-px-muted">
          <span>Page {page} of {totalPages} — {total} quotation(s)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
