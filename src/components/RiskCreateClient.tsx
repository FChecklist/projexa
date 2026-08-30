"use client";

// Real-screen conversion (2026-08-30) -- replaces GrcClient.tsx's old "Log
// Risk" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORIES = ["regulatory", "operational", "financial", "strategic", "reputational", "cyber"];

export default function RiskCreateClient() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("operational");
  const [likelihood, setLikelihood] = useState("3");
  const [impact, setImpact] = useState("3");
  const [submitting, setSubmitting] = useState(false);

  async function createRisk() {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/risks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, category, likelihood: Number(likelihood), impact: Number(impact) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to log risk");
      toast.success("Risk logged");
      router.push(`/grc/risks/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't log risk");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="GRC / Log Risk"
      title="Log Risk"
      mode="create"
      hasDraft={false}
      onSave={createRisk}
      onCancel={() => router.push("/grc?tab=risks")}
      onBack={() => router.push("/grc?tab=risks")}
      saveDisabled={submitting || !title.trim()}
      saveDisabledReason={submitting ? "Logging…" : !title.trim() ? "Title is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="space-y-1.5">
          <Label>Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Likelihood (1-5)</Label>
            <Select value={likelihood} onValueChange={setLikelihood}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Impact (1-5)</Label>
            <Select value={impact} onValueChange={setImpact}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </ObjectScreen>
  );
}
