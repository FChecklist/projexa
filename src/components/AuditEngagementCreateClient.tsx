"use client";

// Real-screen conversion (2026-08-30) -- replaces GrcClient.tsx's old "Plan
// Audit" Dialog popup with a real create screen. No Object Page yet: no
// getAuditEngagement()/updateAuditEngagement() exists server-side (only
// list-with-nested-findings + create) -- an honest scope cut.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TYPES = ["internal", "certification", "statutory"];

export default function AuditEngagementCreateClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [auditType, setAuditType] = useState("internal");
  const [submitting, setSubmitting] = useState(false);

  async function createEngagement() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/audit-engagements", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, auditType }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to plan audit engagement");
      toast.success("Audit engagement planned");
      router.push("/grc?tab=audits");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't plan audit engagement");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="GRC / Plan Audit"
      title="Plan an Audit Engagement"
      mode="create"
      hasDraft={false}
      onSave={createEngagement}
      onCancel={() => router.push("/grc?tab=audits")}
      onBack={() => router.push("/grc?tab=audits")}
      saveDisabled={submitting || !name.trim()}
      saveDisabledReason={submitting ? "Planning…" : !name.trim() ? "Name is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q3 Site Safety Audit" /></div>
        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select value={auditType} onValueChange={setAuditType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TYPES.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
    </ObjectScreen>
  );
}
