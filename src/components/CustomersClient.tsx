"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus } from "lucide-react";
import { useOrgRole } from "@/hooks/use-org-role";
import { currencyLabel, useCurrencies } from "@/lib/currency";

type Customer = { id: string; customerName: string; gstin: string | null; defaultPaymentTermsDays: number | null; creditLimit: string | null; isActive: boolean };

// Priority 19 Part 2, Workstream C: GSTIN is an Indian GST-registration
// field with no UAE VAT/TRN (or any other country's) equivalent -- it was
// rendering unconditionally regardless of the org's own country. Gated on
// isIndiaOrg (hide, don't error, for non-IN orgs), matching the same
// principle compliance-tracker's getComplianceEngine() registry already
// applies to computation.
export default function CustomersClient() {
  const { isIndiaOrg } = useOrgRole();
  const currencies = useCurrencies();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [open, setOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [gstin, setGstin] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/customers?${params.toString()}`);
      const data = await res.json();
      setCustomers(data.customers ?? []);
      setTotal(data.total ?? data.customers?.length ?? 0);
    } catch {
      toast.error("Couldn't load customers");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { load(); }, [load]);

  async function createCustomer() {
    if (!customerName.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/customers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName, gstin: gstin || undefined, creditLimit: creditLimit ? Number(creditLimit) : undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success("Customer added");
      setCustomerName(""); setGstin(""); setCreditLimit(""); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't add customer");
    } finally {
      setSubmitting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input placeholder="Search customers…" value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} className="w-56" />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New Customer</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Customer</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Customer Name</Label><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></div>
              <div className={isIndiaOrg ? "grid grid-cols-2 gap-2" : ""}>
                {isIndiaOrg && (
                  <div className="space-y-1.5"><Label>GSTIN (optional)</Label><Input value={gstin} onChange={(e) => setGstin(e.target.value)} /></div>
                )}
                <div className="space-y-1.5"><Label>Credit Limit (optional)</Label><Input type="number" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} /></div>
              </div>
            </div>
            <DialogFooter><Button onClick={createCustomer} disabled={submitting}>{submitting ? "Adding…" : "Add Customer"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : customers.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No customers found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead>{isIndiaOrg && <TableHead>GSTIN</TableHead>}<TableHead>Credit Limit</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">
                      <Link href={`/customers/${c.id}`} className="hover:text-px-orange hover:underline">{c.customerName}</Link>
                    </TableCell>
                    {isIndiaOrg && <TableCell className="text-px-muted">{c.gstin ?? "—"}</TableCell>}
                    <TableCell className="text-px-muted">{c.creditLimit ? `${currencyLabel(undefined, currencies)}${Number(c.creditLimit).toLocaleString("en-IN")}` : "—"}</TableCell>
                    <TableCell><Badge variant={c.isActive ? "default" : "outline"}>{c.isActive ? "active" : "inactive"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {total > pageSize && (
        <div className="flex items-center justify-between text-sm text-px-muted">
          <span>Page {page} of {totalPages} — {total} customer(s)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
