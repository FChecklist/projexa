"use client";

// Real-screen conversion (2026-08-30) -- replaces GrcClient.tsx's old "Log
// a Fraud / Incident Case" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const FRAUD_TYPES = ["procurement", "payroll", "expense", "vendor_collusion", "asset_misappropriation", "other"];

export default function FraudCaseCreateClient() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [fraudType, setFraudType] = useState("procurement");
  const [reportedDate, setReportedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function createCase() {
    if (!title.trim() || !reportedDate) {
      toast.error("Title and reported date are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/fraud-cases", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, fraudType, reportedDate, description: description || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to log case");
      toast.success("Case logged");
      router.push(`/grc/cases/${data.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't log case");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="GRC / Log Case"
      title="Log a Fraud / Incident Case"
      mode="create"
      hasDraft={false}
      onSave={createCase}
      onCancel={() => router.push("/grc?tab=fraud")}
      onBack={() => router.push("/grc?tab=fraud")}
      saveDisabled={submitting || !title.trim() || !reportedDate}
      saveDisabledReason={submitting ? "Logging…" : (!title.trim() || !reportedDate) ? "Title and reported date are required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={fraudType} onValueChange={setFraudType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{FRAUD_TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5"><Label>Reported Date</Label><Input type="date" value={reportedDate} onChange={(e) => setReportedDate(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label>Description (optional)</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></div>
      </div>
    </ObjectScreen>
  );
}
