"use client";

// Real-screen conversion (2026-08-30): replaces MoodBoardsClient.tsx's old
// "New Mood Board" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function MoodBoardCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [roomOrArea, setRoomOrArea] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function createBoard() {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      const board = await fetchJson<{ id: string }>("/api/mood-boards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title, roomOrArea: roomOrArea || undefined }),
      });
      toast.success("Mood board created");
      router.push(`/mood-boards/${board.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create mood board"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Mood Boards / New Board"
      title="New Mood Board"
      mode="create"
      hasDraft={false}
      onSave={createBoard}
      onCancel={() => router.push(`/mood-boards?projectId=${projectId}`)}
      onBack={() => router.push(`/mood-boards?projectId=${projectId}`)}
      saveDisabled={submitting || !title.trim()}
      saveDisabledReason={submitting ? "Creating…" : !title.trim() ? "Title is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Room / Area (optional)</Label><Input value={roomOrArea} onChange={(e) => setRoomOrArea(e.target.value)} placeholder="e.g. Living Room" /></div>
      </div>
    </ObjectScreen>
  );
}
