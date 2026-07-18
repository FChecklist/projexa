"use client";

// 2026-07-18 production-readiness pass: closes the one real gap in
// PROJEXA's otherwise-complete per-module CRUD surface -- every other
// entity (RFIs, submittals, punch list, ...) already has a real create
// path; Projects, the entity everything else nests under, did not. This is
// what a customer typing "create new project" into VeriChat's Discuss mode
// actually needed -- Discuss is a free-form conversational endpoint with no
// dispatch capability by design, so the fix is a real form, same pattern as
// CreateInvoiceDialog, not making chat pretend to run actions it can't.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";

type Product = { id: string; name: string };

export function CreateProjectDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);

  const [productId, setProductId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setLoadingProducts(true);
    try {
      const res = await fetch("/api/products");
      const data = await res.json();
      setProducts(data.products ?? []);
    } catch {
      toast.error("Couldn't load products from VERIDIAN");
    } finally {
      setLoadingProducts(false);
    }
  }

  async function createProject() {
    if (!productId || !name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId, name,
          description: description || undefined,
          startDate: startDate || undefined,
          targetDate: targetDate || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success("Project created");
      setProductId(""); setName(""); setDescription(""); setStartDate(""); setTargetDate(""); setOpen(false);
      router.refresh();
    } catch {
      toast.error("Couldn't create project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="size-4" /> Create Project</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Project</DialogTitle></DialogHeader>
        {loadingProducts ? (
          <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Product</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="Select a product" /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Project Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lakeview Residence — Phase 2" /></div>
            <div className="space-y-1.5"><Label>Description (optional)</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label>Start Date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Target Date</Label><Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></div>
            </div>
          </div>
        )}
        <DialogFooter><Button onClick={createProject} disabled={submitting || loadingProducts || !productId || !name.trim()}>{submitting ? "Creating…" : "Create Project"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
