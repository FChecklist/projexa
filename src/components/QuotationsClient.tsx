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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Copy, ArrowRightCircle, FileDown } from "lucide-react";

type QuotationItem = { id: string; description: string; quantity: string; rate: string; amount: string };
type Quotation = {
  id: string; quotationNumber: number; customerId: string | null; customerName: string | null;
  quotationDate: string; validTill: string | null; status: string; version: number; revisionOf: string | null;
  grandTotal: string; items: QuotationItem[];
};
type Customer = { id: string; customerName: string };
type Project = { id: string; name: string };

// Mirrors erp-selling-service.ts's QUOTATION_TRANSITIONS -- UX-only duplicate,
// the backend enforces the real gate; this just decides which action
// button(s) to show for a given current status.
const NEXT_ACTIONS: Record<string, { label: string; status: string }[]> = {
  draft: [{ label: "Submit for Approval", status: "pending_approval" }],
  pending_approval: [{ label: "Approve", status: "approved" }, { label: "Reject to Draft", status: "draft" }],
  approved: [{ label: "Mark Sent", status: "sent" }],
  sent: [{ label: "Mark Lost", status: "lost" }, { label: "Mark Expired", status: "expired" }],
  ordered: [], lost: [], expired: [],
};
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", pending_approval: "secondary", approved: "secondary", sent: "default", ordered: "default", lost: "destructive", expired: "destructive",
};

type Line = { description: string; quantity: string; rate: string };

export default function QuotationsClient() {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [quotationDate, setQuotationDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [validTill, setValidTill] = useState("");
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: "1", rate: "" }]);
  const [submitting, setSubmitting] = useState(false);

  const [convertFor, setConvertFor] = useState<Quotation | null>(null);
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await fetch(`/api/quotations?${params.toString()}`);
      const data = await res.json();
      setQuotations(data.quotations ?? []);
      setTotal(data.total ?? 0);
    } catch {
      toast.error("Couldn't load quotations");
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetch("/api/customers").then((r) => r.json()).then((d) => setCustomers(d.customers ?? [])).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/projects").then((r) => r.json()).then((d) => setProjects(d.projects ?? [])).catch(() => {}); }, []);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function createQuotation() {
    if (!customerId || lines.some((l) => !l.description.trim() || !l.rate)) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/quotations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId, projectId: projectId || undefined, quotationDate, validTill: validTill || undefined,
          items: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 1, rate: Number(l.rate) })),
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Quotation created");
      setCustomerId(""); setProjectId(""); setLines([{ description: "", quantity: "1", rate: "" }]); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't create quotation");
    } finally {
      setSubmitting(false);
    }
  }

  async function transition(q: Quotation, status: string) {
    try {
      const res = await fetch(`/api/quotations/${q.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error); }
      toast.success(`Quotation #${q.quotationNumber} → ${status}`);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't update quotation status");
    }
  }

  async function createRevision(q: Quotation) {
    try {
      const res = await fetch(`/api/quotations/${q.id}/revisions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error();
      toast.success(`Revision v${q.version + 1} created for quotation #${q.quotationNumber}`);
      load();
    } catch {
      toast.error("Couldn't create revision");
    }
  }

  async function downloadPdf(q: Quotation) {
    setDownloadingId(q.id);
    try {
      const res = await fetch(`/api/quotations/${q.id}/pdf`);
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quotation-${q.quotationNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't download quotation PDF");
    } finally {
      setDownloadingId(null);
    }
  }

  async function convertToOrder() {
    if (!convertFor) return;
    try {
      const res = await fetch(`/api/quotations/${convertFor.id}/convert`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderDate }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error); }
      toast.success(`Converted to a sales order`);
      setConvertFor(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't convert quotation");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const STATUS_OPTIONS = ["draft", "pending_approval", "approved", "sent", "ordered", "lost", "expired"];

  return (
    <div className="space-y-4">
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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New Quotation</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New Quotation</DialogTitle></DialogHeader>
            <div className="max-h-[70vh] space-y-3 overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Customer</Label>
                  <Select value={customerId} onValueChange={setCustomerId}>
                    <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
                    <SelectContent>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customerName}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Project (optional)</Label>
                  <Select value={projectId} onValueChange={setProjectId}>
                    <SelectTrigger><SelectValue placeholder="No project" /></SelectTrigger>
                    <SelectContent>{projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Quotation Date</Label><Input type="date" value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Valid Till (optional)</Label><Input type="date" value={validTill} onChange={(e) => setValidTill(e.target.value)} /></div>
              </div>
              <div className="space-y-2">
                <Label>Line Items</Label>
                {lines.map((l, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input placeholder="Description" value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} className="flex-1" />
                    <Input placeholder="Qty" type="number" value={l.quantity} onChange={(e) => updateLine(i, { quantity: e.target.value })} className="w-16" />
                    <Input placeholder="Rate" type="number" value={l.rate} onChange={(e) => updateLine(i, { rate: e.target.value })} className="w-24" />
                    <Button variant="ghost" size="icon" disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, { description: "", quantity: "1", rate: "" }])}>
                  <Plus className="size-3.5" /> Add Line
                </Button>
              </div>
            </div>
            <DialogFooter><Button onClick={createQuotation} disabled={submitting || !customerId}>{submitting ? "Creating…" : "Create Quotation"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
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
                  <TableHead>Version</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quotations.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className="font-medium">{q.quotationNumber}</TableCell>
                    <TableCell className="text-px-muted">{q.customerName ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{q.quotationDate}</TableCell>
                    <TableCell className="text-px-muted">v{q.version}{q.revisionOf ? " (revision)" : ""}</TableCell>
                    <TableCell className="text-px-muted">₹{Number(q.grandTotal).toLocaleString("en-IN")}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[q.status] ?? "outline"}>{q.status.replace("_", " ")}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {(NEXT_ACTIONS[q.status] ?? []).map((action) => (
                          <Button key={action.status} size="sm" variant="outline" onClick={() => transition(q, action.status)}>{action.label}</Button>
                        ))}
                        {q.status === "sent" && (
                          <Button size="sm" onClick={() => setConvertFor(q)}><ArrowRightCircle className="size-3.5" /> Convert</Button>
                        )}
                        {!["ordered", "lost", "expired"].includes(q.status) && (
                          <Button size="sm" variant="ghost" onClick={() => createRevision(q)} title="New revision"><Copy className="size-3.5" /></Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={downloadingId === q.id}
                          onClick={() => downloadPdf(q)}
                          title="Download PDF"
                        >
                          {downloadingId === q.id ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
                        </Button>
                      </div>
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
          <span>Page {page} of {totalPages} — {total} quotation(s)</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <Dialog open={!!convertFor} onOpenChange={(o) => !o && setConvertFor(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Convert Quotation #{convertFor?.quotationNumber} to a Sales Order</DialogTitle></DialogHeader>
          <div className="space-y-1.5"><Label>Order Date</Label><Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></div>
          <DialogFooter><Button onClick={convertToOrder}>Convert</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
