"use client";

// Real-screen conversion (2026-08-30) -- replaces GrcClient.tsx's old "Open
// an Access Review Cycle" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function AccessReviewCreateClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function createCycle() {
    if (!name.trim()) {
      toast.error("Cycle name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/access-review", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to open cycle");
      toast.success("Access review cycle opened");
      router.push(`/grc/access-review/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open cycle");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="GRC / New Access Review Cycle"
      title="Open an Access Review Cycle"
      mode="create"
      hasDraft={false}
      onSave={createCycle}
      onCancel={() => router.push("/grc?tab=access-review")}
      onBack={() => router.push("/grc?tab=access-review")}
      saveDisabled={submitting || !name.trim()}
      saveDisabledReason={submitting ? "Opening…" : !name.trim() ? "Cycle name is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <p className="text-sm text-ct-muted">Snapshots every active team member's current role into a pending certification you'll confirm or revoke.</p>
        <div className="space-y-1.5"><Label>Cycle Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 2026 Access Review" /></div>
      </div>
    </ObjectScreen>
  );
}
