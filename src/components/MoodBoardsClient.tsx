"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus, Image as ImageIcon } from "lucide-react";

type MoodBoardItem = { id: string; label: string | null; notes: string | null };
type MoodBoard = { id: string; title: string; roomOrArea: string | null; status: string; items: MoodBoardItem[] };

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline", shared: "secondary", approved: "default",
};

export default function MoodBoardsClient({ projectId }: { projectId: string }) {
  const [boards, setBoards] = useState<MoodBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [roomOrArea, setRoomOrArea] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [addingTo, setAddingTo] = useState<MoodBoard | null>(null);
  const [itemLabel, setItemLabel] = useState("");
  const [itemNotes, setItemNotes] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/mood-boards?projectId=${encodeURIComponent(projectId)}`);
      const data = await res.json();
      setBoards(data.boards ?? []);
    } catch {
      toast.error("Couldn't load mood boards");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [projectId]);

  async function createBoard() {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/mood-boards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title, roomOrArea: roomOrArea || undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success("Mood board created");
      setTitle(""); setRoomOrArea(""); setOpen(false);
      load();
    } catch {
      toast.error("Couldn't create mood board");
    } finally {
      setSubmitting(false);
    }
  }

  async function addItem() {
    if (!addingTo || !itemLabel.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/mood-boards/${addingTo.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: itemLabel, notes: itemNotes || undefined }),
      });
      if (!res.ok) throw new Error();
      setItemLabel(""); setItemNotes(""); setAddingTo(null);
      load();
    } catch {
      toast.error("Couldn't add item");
    } finally {
      setSubmitting(false);
    }
  }

  async function setStatus(board: MoodBoard, status: string) {
    try {
      const res = await fetch(`/api/mood-boards/${board.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      load();
    } catch {
      toast.error("Couldn't update status");
    }
  }

  if (loading) return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4" /> New Mood Board</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New Mood Board</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Room / Area (optional)</Label><Input value={roomOrArea} onChange={(e) => setRoomOrArea(e.target.value)} placeholder="e.g. Living Room" /></div>
            </div>
            <DialogFooter><Button onClick={createBoard} disabled={submitting}>{submitting ? "Creating…" : "Create"}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {boards.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-px-muted">No mood boards yet.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {boards.map((b) => (
            <Card key={b.id} className="shadow-card">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="font-heading text-base">{b.title}</CardTitle>
                  {b.roomOrArea && <p className="text-xs text-px-muted mt-0.5">{b.roomOrArea}</p>}
                </div>
                <Badge variant={STATUS_VARIANT[b.status]}>{b.status}</Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                {b.items.length === 0 ? (
                  <p className="text-xs text-px-muted">No items yet.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {b.items.map((i) => (
                      <div key={i.id} className="rounded-lg border border-px-border bg-px-concrete/40 p-2">
                        <ImageIcon className="size-4 text-px-muted mb-1" />
                        <p className="text-xs font-medium text-px-ink truncate">{i.label}</p>
                        {i.notes && <p className="text-[10px] text-px-muted truncate">{i.notes}</p>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between pt-1">
                  <Button size="sm" variant="outline" onClick={() => setAddingTo(b)}><Plus className="size-3.5" /> Add Item</Button>
                  {b.status === "draft" && <Button size="sm" variant="ghost" onClick={() => setStatus(b, "shared")}>Share with Client</Button>}
                  {b.status === "shared" && <Button size="sm" variant="ghost" onClick={() => setStatus(b, "approved")}>Mark Approved</Button>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!addingTo} onOpenChange={(v) => !v && setAddingTo(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Item: {addingTo?.title}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>Label</Label><Input value={itemLabel} onChange={(e) => setItemLabel(e.target.value)} placeholder="e.g. Accent Wallpaper" /></div>
            <div className="space-y-1.5"><Label>Notes (optional)</Label><Textarea value={itemNotes} onChange={(e) => setItemNotes(e.target.value)} rows={2} /></div>
          </div>
          <DialogFooter><Button onClick={addItem} disabled={submitting}>{submitting ? "Adding…" : "Add"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
