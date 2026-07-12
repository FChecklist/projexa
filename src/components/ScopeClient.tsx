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
import { Loader2, Plus, Trash2 } from "lucide-react";

type Boq = {
  id: string;
  version: number;
  title: string;
  status: string;
  parentBoqId: string | null;
  createdAt: string;
};

type LineItemDraft = { description: string; unit: string; quantity: string; rate: string };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary", submitted: "default", approved: "outline", superseded: "destructive",
};

const emptyLine = (): LineItemDraft => ({ description: "", unit: "", quantity: "", rate: "" });

export default function ScopeClient({ projectId }: { projectId: string }) {
  const [boqs, setBoqs] = useState<Boq[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [lines, setLines] = useState<LineItemDraft[]>([emptyLine()]);
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/scope?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setBoqs(data.boqs ?? []);
    } catch {
      toast.error("Couldn't load scope of work");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  function updateLine(index: number, field: keyof LineItemDraft, value: string) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  }

  async function createBoq() {
    if (!title.trim()) return;
    const validLines = lines.filter((l) => l.description.trim() && l.unit.trim() && l.quantity && l.rate);
    if (validLines.length === 0) {
      toast.error("Add at least one complete line item");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/scope", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, title,
          lineItems: validLines.map((l) => ({ description: l.description, unit: l.unit, quantity: Number(l.quantity), rate: Number(l.rate) })),
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("BOQ created");
      setTitle(""); setLines([emptyLine()]); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't create BOQ");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New BOQ</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>New Bill of Quantities</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Civil Works - Phase 1" /></div>
              <div className="space-y-2">
                <Label>Line Items</Label>
                {lines.map((line, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px_90px_90px_28px] gap-2">
                    <Input placeholder="Description" value={line.description} onChange={(e) => updateLine(i, "description", e.target.value)} />
                    <Input placeholder="Unit" value={line.unit} onChange={(e) => updateLine(i, "unit", e.target.value)} />
                    <Input placeholder="Qty" type="number" value={line.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} />
                    <Input placeholder="Rate" type="number" value={line.rate} onChange={(e) => updateLine(i, "rate", e.target.value)} />
                    <Button variant="ghost" size="icon" onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} disabled={lines.length === 1}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
                  <Plus className="size-3.5" /> Add Line
                </Button>
              </div>
            </div>
            <DialogFooter><Button onClick={createBoq} disabled={submitting}>{submitting ? "Creating…" : "Create BOQ"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : boqs.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No BOQs yet for this project.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead><TableHead>Version</TableHead><TableHead>Status</TableHead><TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {boqs.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.title}</TableCell>
                    <TableCell className="text-px-muted">v{b.version}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[b.status] ?? "outline"}>{b.status}</Badge></TableCell>
                    <TableCell className="text-px-muted">{new Date(b.createdAt).toLocaleDateString()}</TableCell>
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
