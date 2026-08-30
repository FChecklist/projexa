"use client";

// Real-screen conversion (2026-08-30): mood boards never had a detail view
// or any way to edit title/room/description short of re-creating the
// board -- getMoodBoard()/updateMoodBoard() didn't exist before this
// conversion (only status changes did). Real Object Page on the kit's
// ObjectScreen. Real Delete = real item removal per-item (removeMoodBoardItem
// already had a working v1 route, just no PROJEXA proxy) -- there is no
// delete-the-whole-board function, so no board-level Delete is offered.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Image as ImageIcon, X } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type MoodBoardItem = { id: string; label: string | null; notes: string | null };
type MoodBoard = { id: string; projectId: string; title: string; roomOrArea: string | null; description: string | null; status: string; items: MoodBoardItem[] };

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", shared: "waiting", approved: "done" };

export default function MoodBoardObjectClient({ boardId }: { boardId: string }) {
  const router = useRouter();
  const [board, setBoard] = useState<MoodBoard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [draft, setDraft] = useState({ title: "", roomOrArea: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [itemLabel, setItemLabel] = useState("");
  const [itemNotes, setItemNotes] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchJson<MoodBoard>(`/api/mood-boards/${boardId}`);
      setBoard(data);
      setLoadError(null);
    } catch (err) {
      setBoard(null);
      setLoadError(errorMessage(err, "Couldn't load this mood board"));
    }
  }
  useEffect(() => { load(); }, [boardId]);

  function startEdit() {
    if (!board) return;
    setDraft({ title: board.title, roomOrArea: board.roomOrArea ?? "", description: board.description ?? "" });
    setMode("edit");
  }

  async function saveEdit() {
    if (!draft.title.trim()) { toast.error("Title is required"); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/mood-boards/${boardId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draft.title.trim(), roomOrArea: draft.roomOrArea || null, description: draft.description || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save mood board");
      toast.success("Mood board saved");
      setMode("display");
      setBoard((prev) => (prev ? { ...prev, ...data } : data));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save mood board");
    } finally {
      setSaving(false);
    }
  }

  async function advanceStatus(next: string) {
    setStatusBusy(true);
    try {
      const res = await fetch(`/api/mood-boards/${boardId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status", status: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update status");
      toast.success(next === "shared" ? "Shared with client" : "Marked approved");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update status");
    } finally {
      setStatusBusy(false);
    }
  }

  async function addItem() {
    if (!itemLabel.trim()) return;
    setAddingItem(true);
    try {
      const res = await fetch(`/api/mood-boards/${boardId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: itemLabel, notes: itemNotes || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to add item");
      toast.success("Item added");
      setItemLabel(""); setItemNotes("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add item");
    } finally {
      setAddingItem(false);
    }
  }

  async function removeItem(itemId: string) {
    setRemovingId(itemId);
    try {
      const res = await fetch(`/api/mood-boards/${boardId}/items/${itemId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to remove item");
      toast.success("Item removed");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove item");
    } finally {
      setRemovingId(null);
    }
  }

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!board) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Mood Boards / Board"
      title={mode === "edit" ? "Edit Mood Board" : board.title}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[board.status] ?? "neutral", label: board.status }}
      facets={[{ label: "Room / Area", value: board.roomOrArea ?? "—" }]}
      onEdit={mode === "display" ? startEdit : undefined}
      onSave={mode === "edit" ? saveEdit : undefined}
      onCancel={mode === "edit" ? () => setMode("display") : undefined}
      onBack={() => router.push(`/mood-boards?projectId=${board.projectId}`)}
      saveDisabled={saving || !draft.title.trim()}
      saveDisabledReason={saving ? "Saving…" : !draft.title.trim() ? "Title is required" : undefined}
      messages={[]}
    >
      {mode === "edit" ? (
        <div className="space-y-3 px-4 py-3">
          <div className="space-y-1.5"><Label>Title</Label><Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} /></div>
          <div className="space-y-1.5"><Label>Room / Area (optional)</Label><Input value={draft.roomOrArea} onChange={(e) => setDraft((d) => ({ ...d, roomOrArea: e.target.value }))} placeholder="e.g. Living Room" /></div>
          <div className="space-y-1.5"><Label>Description (optional)</Label><Textarea value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} rows={3} /></div>
        </div>
      ) : (
        <div className="space-y-4 px-4 py-3">
          {board.description && <p className="text-sm text-ct-muted">{board.description}</p>}

          {mode === "display" && (
            <div className="flex items-center gap-2">
              {board.status === "draft" && <Button size="sm" variant="outline" disabled={statusBusy} onClick={() => advanceStatus("shared")}>Share with Client</Button>}
              {board.status === "shared" && <Button size="sm" variant="outline" disabled={statusBusy} onClick={() => advanceStatus("approved")}>Mark Approved</Button>}
            </div>
          )}

          <div>
            <h4 className="mb-2 text-sm font-semibold text-ct-navy">Items</h4>
            {board.items.length === 0 ? (
              <p className="text-sm text-ct-muted">No items yet.</p>
            ) : (
              <div className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {board.items.map((i) => (
                  <div key={i.id} className="relative rounded-lg border border-ct-border bg-ct-cloud/40 p-2">
                    <Button
                      size="sm" variant="ghost" disabled={removingId === i.id}
                      className="absolute right-0.5 top-0.5 h-5 w-5 p-0"
                      onClick={() => removeItem(i.id)} title="Remove item"
                    >
                      <X className="size-3" />
                    </Button>
                    <ImageIcon className="mb-1 size-4 text-ct-muted" />
                    <p className="truncate text-xs font-medium text-ct-navy">{i.label}</p>
                    {i.notes && <p className="truncate text-[10px] text-ct-muted">{i.notes}</p>}
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5"><Label>Label</Label><Input className="w-48" value={itemLabel} onChange={(e) => setItemLabel(e.target.value)} placeholder="e.g. Accent Wallpaper" /></div>
              <div className="space-y-1.5"><Label>Notes (optional)</Label><Input className="w-56" value={itemNotes} onChange={(e) => setItemNotes(e.target.value)} /></div>
              <Button size="sm" disabled={addingItem || !itemLabel.trim()} onClick={addItem}>{addingItem ? "Adding…" : "Add Item"}</Button>
            </div>
          </div>
        </div>
      )}
    </ObjectScreen>
  );
}
