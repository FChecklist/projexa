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
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";

type PunchItem = {
  id: string; number: number; description: string; location: string | null; trade: string | null; priority: string; status: string;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "destructive", ready_for_review: "secondary", verified_closed: "outline",
};
const PRIORITY_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  high: "destructive", medium: "secondary", low: "outline",
};

export default function PunchListClient({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<PunchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [trade, setTrade] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJson(`/api/punch-list?projectId=${encodeURIComponent(projectId)}`);
      setItems(data.items ?? []);
    } catch (err) {
      const msg = errorMessage(err, "Couldn't load punch list");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  async function createItem() {
    if (!description.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/punch-list", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, description, location: location || undefined, trade: trade || undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success("Punch list item added");
      setDescription(""); setLocation(""); setTrade(""); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't add item");
    } finally {
      setSubmitting(false);
    }
  }

  async function transition(id: string, action: "ready" | "verify") {
    try {
      const res = await fetch(`/api/punch-list/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast.error("Couldn't update item");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New Item</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Punch List Item</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Location (optional)</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Trade (optional)</Label><Input value={trade} onChange={(e) => setTrade(e.target.value)} /></div>
            </div>
            <DialogFooter><Button onClick={createItem} disabled={submitting}>{submitting ? "Adding…" : "Add Item"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : loadError ? (
            <DataLoadError messages={[loadError]} onRetry={load} />
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">Nothing on the punch list yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead><TableHead>Description</TableHead><TableHead>Location</TableHead>
                  <TableHead>Priority</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-mono text-xs">PL-{i.number}</TableCell>
                    <TableCell className="font-medium">{i.description}</TableCell>
                    <TableCell className="text-px-muted">{i.location ?? "—"}</TableCell>
                    <TableCell><Badge variant={PRIORITY_VARIANT[i.priority]}>{i.priority}</Badge></TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[i.status]}>{i.status.replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell className="text-right">
                      {i.status === "open" && <Button size="sm" variant="outline" onClick={() => transition(i.id, "ready")}>Mark Done</Button>}
                      {i.status === "ready_for_review" && <Button size="sm" variant="outline" onClick={() => transition(i.id, "verify")}>Verify & Close</Button>}
                    </TableCell>
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
