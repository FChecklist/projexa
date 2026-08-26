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
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Submittal = {
  id: string; number: number; title: string; specSection: string | null; type: string; status: string; reviewComments: string | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline", approved: "secondary", approved_as_noted: "secondary", revise_resubmit: "destructive", rejected: "destructive",
};

export default function SubmittalsClient({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Submittal[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [specSection, setSpecSection] = useState("");
  const [reviewing, setReviewing] = useState<Submittal | null>(null);
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await fetchJson(`/api/submittals?projectId=${encodeURIComponent(projectId)}`);
      setItems(data.submittals ?? []);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't load submittals"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  async function createSubmittal() {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/submittals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title, specSection: specSection || undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success("Submittal created");
      setTitle(""); setSpecSection(""); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't create submittal");
    } finally {
      setSubmitting(false);
    }
  }

  async function review(status: string) {
    if (!reviewing) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/submittals/${reviewing.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "review", status, comments, projectId }),
      });
      if (!res.ok) throw new Error();
      toast.success("Submittal reviewed");
      setReviewing(null); setComments("");
      load();
    } catch {
      toast.error("Couldn't review submittal");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New Submittal</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Submittal</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Spec Section (optional)</Label><Input value={specSection} onChange={(e) => setSpecSection(e.target.value)} placeholder="e.g. 05 12 00" /></div>
            </div>
            <DialogFooter><Button onClick={createSubmittal} disabled={submitting}>{submitting ? "Creating…" : "Create"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="shadow-card">
        <CardContent className="p-0">
          {loading ? (
            <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-px-muted" /></div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-px-muted">No submittals yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead><TableHead>Title</TableHead><TableHead>Spec Section</TableHead>
                  <TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">SUB-{s.number}</TableCell>
                    <TableCell className="font-medium">{s.title}</TableCell>
                    <TableCell className="text-px-muted">{s.specSection ?? "—"}</TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[s.status]}>{s.status.replace(/_/g, " ")}</Badge></TableCell>
                    <TableCell className="text-right">
                      {s.status === "pending" && (
                        <Button size="sm" variant="outline" onClick={() => { setReviewing(s); setComments(""); }}>Review</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!reviewing} onOpenChange={(v) => !v && setReviewing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Review: {reviewing?.title}</DialogTitle></DialogHeader>
          <Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} placeholder="Review comments (optional)…" />
          <DialogFooter className="flex-wrap gap-2">
            <Button size="sm" onClick={() => review("approved")} disabled={submitting}>Approve</Button>
            <Button size="sm" variant="outline" onClick={() => review("approved_as_noted")} disabled={submitting}>Approve as Noted</Button>
            <Button size="sm" variant="outline" onClick={() => review("revise_resubmit")} disabled={submitting}>Revise & Resubmit</Button>
            <Button size="sm" variant="destructive" onClick={() => review("rejected")} disabled={submitting}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
