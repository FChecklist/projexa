"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus } from "lucide-react";

type Vendor = {
  id: string; vendorName: string; vendorType: string | null; gst: string | null;
  trade: string | null; creditLimit: string | null; isActive: boolean;
};

export default function VendorsClient() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [vendorType, setVendorType] = useState("");
  const [gst, setGst] = useState("");
  const [trade, setTrade] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/vendors");
      const data = await res.json();
      setVendors(data.vendors ?? []);
    } catch {
      toast.error("Couldn't load vendors");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createVendor() {
    if (!vendorName.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/vendors", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendorName, vendorType: vendorType || undefined, gst: gst || undefined,
          trade: trade || undefined, creditLimit: creditLimit ? Number(creditLimit) : undefined,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Vendor added");
      setVendorName(""); setVendorType(""); setGst(""); setTrade(""); setCreditLimit(""); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't add vendor");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New Vendor</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Vendor</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Vendor Name</Label><Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>Type (optional)</Label><Input value={vendorType} onChange={(e) => setVendorType(e.target.value)} placeholder="e.g. Subcontractor" /></div>
                <div className="space-y-1.5"><Label>Trade (optional)</Label><Input value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="e.g. Electrical" /></div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label>GST (optional)</Label><Input value={gst} onChange={(e) => setGst(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Credit Limit (optional)</Label><Input type="number" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} /></div>
              </div>
            </div>
            <DialogFooter><Button onClick={createVendor} disabled={submitting}>{submitting ? "Adding…" : "Add Vendor"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : vendors.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No vendors added yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Trade</TableHead><TableHead>GST</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{v.vendorName}</TableCell>
                    <TableCell className="text-px-muted">{v.vendorType ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{v.trade ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{v.gst ?? "—"}</TableCell>
                    <TableCell><Badge variant={v.isActive ? "default" : "outline"}>{v.isActive ? "active" : "inactive"}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
