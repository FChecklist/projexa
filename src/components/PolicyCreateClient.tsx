"use client";

// Real-screen conversion (2026-08-30) -- replaces GrcClient.tsx's old
// "Draft Policy" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORIES = ["governance", "hr", "environment", "data_privacy", "third_party", "sop"];

export default function PolicyCreateClient() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("governance");
  const [submitting, setSubmitting] = useState(false);

  async function createPolicy() {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/policies", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, category }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to draft policy");
      toast.success("Policy drafted");
      router.push(`/grc/policies/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't draft policy");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="GRC / Draft Policy"
      title="Draft Policy"
      mode="create"
      hasDraft={false}
      onSave={createPolicy}
      onCancel={() => router.push("/grc?tab=policies")}
      onBack={() => router.push("/grc?tab=policies")}
      saveDisabled={submitting || !title.trim()}
      saveDisabledReason={submitting ? "Drafting…" : !title.trim() ? "Title is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
    </ObjectScreen>
  );
}
