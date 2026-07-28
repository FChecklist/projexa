"use client";

// Priority 13 (Permits as a first-class module): reuses the same
// Card/Table/Badge/Select primitives DocumentsClient.tsx already uses for
// generic documents, rather than inventing new ones -- a permit is a
// documents row with category='permit' (Wave 117 on the VERIDIAN side).
//
// Wave 143: real create (PDF upload + permit name/issue date/end date) and
// a real "list all" mode alongside the original expiring-soon view -- both
// project-scoped now that `projectId` is a required prop.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Loader2, ShieldCheck, ExternalLink, Plus } from "lucide-react";

type Permit = {
  id: string;
  name: string;
  permitNumber: string | null;
  permitAuthority: string | null;
  issueDate: string | null;
  endDate: string | null;
  daysToExpiry: number | null;
  documentUrl: string | null;
};

const WINDOW_OPTIONS = [
  { value: "all", label: "All permits" },
  { value: "30", label: "Expiring in 30 days" },
  { value: "60", label: "Expiring in 60 days" },
  { value: "90", label: "Expiring in 90 days" },
];

function expiryVariant(daysToExpiry: number | null): { label: string; className: string } {
  if (daysToExpiry === null) return { label: "No expiry set", className: "bg-px-muted/10 text-px-muted border-px-muted/30" };
  if (daysToExpiry < 0) return { label: `Expired ${Math.abs(daysToExpiry)}d ago`, className: "bg-red-50 text-red-700 border-red-200" };
  if (daysToExpiry <= 7) return { label: `${daysToExpiry}d left`, className: "bg-red-50 text-red-700 border-red-200" };
  if (daysToExpiry <= 30) return { label: `${daysToExpiry}d left`, className: "bg-amber-50 text-amber-700 border-amber-200" };
  return { label: `${daysToExpiry}d left`, className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
}

export default function PermitsClient({ projectId }: { projectId: string }) {
  const [permits, setPermits] = useState<Permit[]>([]);
  const [loading, setLoading] = useState(true);
  const [windowFilter, setWindowFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ projectId });
      if (windowFilter === "all") params.set("all", "true");
      else params.set("withinDays", windowFilter);
      const res = await fetch(`/api/permits?${params.toString()}`);
      const data = await res.json();
      setPermits(data.permits ?? []);
    } catch {
      toast.error("Couldn't load permits");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId, windowFilter]);

  async function handleCreate(formData: FormData) {
    formData.set("projectId", projectId);
    setSaving(true);
    try {
      const res = await fetch("/api/permits", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to create permit");
      }
      toast.success("Permit created");
      setDialogOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create permit");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-px-muted">Permits for this project, backed by VERIDIAN&apos;s document store.</p>
        <div className="flex items-center gap-2">
          <Select value={windowFilter} onValueChange={setWindowFilter}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{WINDOW_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="size-4" /> New Permit</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Permit</DialogTitle></DialogHeader>
              <form action={handleCreate} className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="name">Permit name</Label>
                  <Input id="name" name="name" required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="permitAuthority">Issuing authority</Label>
                    <Input id="permitAuthority" name="permitAuthority" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="permitNumber">Permit number</Label>
                    <Input id="permitNumber" name="permitNumber" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="issueDate">Issue date</Label>
                    <Input id="issueDate" name="issueDate" type="date" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="endDate">End date</Label>
                    <Input id="endDate" name="endDate" type="date" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="file">Permit PDF</Label>
                  <Input id="file" name="file" type="file" accept="application/pdf" required />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : "Create"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : permits.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No permits found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Permit</TableHead><TableHead>Number</TableHead><TableHead>Authority</TableHead>
                  <TableHead>Issued</TableHead><TableHead>Expiry</TableHead><TableHead>Status</TableHead><TableHead className="text-right">PDF</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {permits.map((p) => {
                  const variant = expiryVariant(p.daysToExpiry);
                  return (
                    <TableRow key={p.id}>
                      <TableCell className="flex items-center gap-2 font-medium"><ShieldCheck className="size-4 text-px-muted" />{p.name}</TableCell>
                      <TableCell className="text-px-muted">{p.permitNumber ?? "—"}</TableCell>
                      <TableCell className="text-px-muted">{p.permitAuthority ?? "—"}</TableCell>
                      <TableCell className="text-px-muted">{p.issueDate ? new Date(p.issueDate).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-px-muted">{p.endDate ? new Date(p.endDate).toLocaleDateString() : "—"}</TableCell>
                      <TableCell><Badge variant="outline" className={variant.className}>{variant.label}</Badge></TableCell>
                      <TableCell className="text-right">
                        {p.documentUrl ? (
                          <Button variant="ghost" size="sm" asChild>
                            <a href={p.documentUrl} target="_blank" rel="noopener noreferrer">
                              View <ExternalLink className="size-3.5" />
                            </a>
                          </Button>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
