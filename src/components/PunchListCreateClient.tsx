"use client";

// Real-screen conversion (2026-08-30): replaces PunchListClient.tsx's old
// "New Item" Dialog popup with a real create screen. Also surfaces
// `priority` -- createPunchListItem() has always accepted it (defaulting to
// "medium") but the old Dialog never asked for it.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function PunchListCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [trade, setTrade] = useState("");
  const [priority, setPriority] = useState("medium");
  const [submitting, setSubmitting] = useState(false);

  async function create() {
    if (!description.trim()) { toast.error("Description is required"); return; }
    setSubmitting(true);
    try {
      const item = await fetchJson<{ id: string }>("/api/punch-list", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, description, location: location || undefined, trade: trade || undefined, priority }),
      });
      toast.success("Punch list item added");
      router.push(`/punch-list/${item.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't add item"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Punch List / New Item"
      title="New Punch List Item"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push(`/punch-list?projectId=${projectId}`)}
      onBack={() => router.push(`/punch-list?projectId=${projectId}`)}
      saveDisabled={submitting || !description.trim()}
      saveDisabledReason={submitting ? "Adding…" : !description.trim() ? "Description is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Description</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Location (optional)</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Trade (optional)</Label><Input value={trade} onChange={(e) => setTrade(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5">
          <Label>Priority</Label>
          <Select value={priority} onValueChange={setPriority}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </ObjectScreen>
  );
}
