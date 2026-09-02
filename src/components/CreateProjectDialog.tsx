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
import { invalidateShell } from "@/lib/shell-store";
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
  const [loadError, setLoadError] = useState<string | null>(null);

  const [productId, setProductId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [targetDate, setTargetDate] = useState("");

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setLoadingProducts(true);
    setLoadError(null);
    setProducts([]);
    try {
      const res = await fetch("/api/products");
      // /api/products answers a failure with { error } and a real status. Parsing
      // the body without checking res.ok turned that error into `undefined`, and
      // `?? []` then turned it into an empty product list -- so the picker opened
      // silently empty and no project could ever be created, with nothing on
      // screen saying why. Read the status first, and keep the backend's own words.
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg =
          data && typeof data.error === "string" && data.error.trim()
            ? data.error
            : `Couldn't load products from VERIDIAN (HTTP ${res.status})`;
        setLoadError(msg);
        toast.error(msg);
        return;
      }
      setProducts(data?.products ?? []);
    } catch (err) {
      const detail = err instanceof Error && err.message ? `: ${err.message}` : "";
      const msg = `Couldn't load products from VERIDIAN${detail}`;
      setLoadError(msg);
      toast.error(msg);
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
      // Same rule on the way out: never replace the backend's reason with a
      // generic one. A user who is told "Couldn't create project" cannot act;
      // a user who is told what the server actually refused, can.
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body && typeof body.error === "string" && body.error.trim()
            ? body.error
            : `HTTP ${res.status}`
        );
      }
      toast.success("Project created");
      // R67 F-21: the shell's project list is held in a session store; mark
      // that ONE key stale so the new project appears in the top rail's
      // switcher at once, without re-reading the whole bootstrap.
      invalidateShell("projects");
      setProductId(""); setName(""); setDescription(""); setStartDate(""); setTargetDate(""); setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? `Couldn't create project: ${err.message}`
          : "Couldn't create project"
      );
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
              {/* An empty picker is not an answer. Say which of the two it is:
                  the product list could not be loaded, or it loaded and is empty. */}
              {loadError ? (
                <p role="alert" className="rounded-md border border-px-error-border bg-px-error-light p-2 text-sm text-px-error">
                  {loadError}
                </p>
              ) : products.length === 0 ? (
                <p role="status" className="rounded-md border border-px-border bg-px-cloud p-2 text-sm text-px-muted">
                  No products are set up for this organisation yet. An administrator must add a
                  product before a project can be created.
                </p>
              ) : (
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger><SelectValue placeholder="Select a product" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
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
