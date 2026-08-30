"use client";

// Real-screen conversion (2026-08-30): replaces SubmittalsClient.tsx's old
// "New Submittal" Dialog popup with a real create screen. Also surfaces
// `type` and `dueDate` -- createSubmittal() has always accepted both
// (type defaulting to "shop_drawing") but the old Dialog never asked.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function SubmittalCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [specSection, setSpecSection] = useState("");
  const [type, setType] = useState("shop_drawing");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function create() {
    if (!title.trim()) { toast.error("Title is required"); return; }
    setSubmitting(true);
    try {
      const submittal = await fetchJson<{ id: string }>("/api/submittals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, title, specSection: specSection || undefined, type, dueDate: dueDate || undefined }),
      });
      toast.success("Submittal created");
      router.push(`/submittals/${submittal.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create submittal"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Submittals / New Submittal"
      title="New Submittal"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push(`/submittals?projectId=${projectId}`)}
      onBack={() => router.push(`/submittals?projectId=${projectId}`)}
      saveDisabled={submitting || !title.trim()}
      saveDisabledReason={submitting ? "Creating…" : !title.trim() ? "Title is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Spec Section (optional)</Label><Input value={specSection} onChange={(e) => setSpecSection(e.target.value)} placeholder="e.g. 05 12 00" /></div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="shop_drawing">Shop Drawing</SelectItem>
                <SelectItem value="product_data">Product Data</SelectItem>
                <SelectItem value="sample">Sample</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5"><Label>Due Date (optional)</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
