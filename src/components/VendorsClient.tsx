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
import { useOrgRole } from "@/hooks/use-org-role";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { LoadFailure } from "@/components/LoadFailure";

type Vendor = {
  id: string; vendorName: string; vendorType: string | null; gst: string | null;
  trade: string | null; creditLimit: string | null; isActive: boolean;
};

// Priority 19 Part 2, Workstream C: GST is an Indian GST-registration
// field with no UAE VAT/TRN (or any other country's) equivalent -- it was
// rendering unconditionally regardless of the org's own country. Gated on
// isIndiaOrg (hide, don't error, for non-IN orgs), same pattern as
// CustomersClient.tsx's GSTIN field.
export default function VendorsClient() {
  const { isIndiaOrg } = useOrgRole();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [vendorName, setVendorName] = useState("");
  const [vendorType, setVendorType] = useState("");
  const [gst, setGst] = useState("");
  const [trade, setTrade] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJson("/api/vendors");
      setVendors(data.vendors ?? []);
    } catch (err) {
      const msg = errorMessage(err, "Couldn't load vendors");
      setLoadError(msg);
      toast.error(msg);
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
              <div className={isIndiaOrg ? "grid grid-cols-2 gap-2" : ""}>
                {isIndiaOrg && (
                  <div className="space-y-1.5"><Label>GST (optional)</Label><Input value={gst} onChange={(e) => setGst(e.target.value)} /></div>
                )}
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
          ) : loadError ? (
            // R48_VENDORS_500_RENDERED_AS_EMPTY_STATE_01: "No vendors added
            // yet." used to render here on a load where GET /api/vendors had
            // returned 500 on 3 of 3 attempts. The screen stated a fact about
            // the user's data that the failed read makes unknowable.
            <LoadFailure error={loadError} onRetry={load} className="m-4" />
          ) : vendors.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No vendors added yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Trade</TableHead>{isIndiaOrg && <TableHead>GST</TableHead>}<TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{v.vendorName}</TableCell>
                    <TableCell className="text-px-muted">{v.vendorType ?? "—"}</TableCell>
                    <TableCell className="text-px-muted">{v.trade ?? "—"}</TableCell>
                    {isIndiaOrg && <TableCell className="text-px-muted">{v.gst ?? "—"}</TableCell>}
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
