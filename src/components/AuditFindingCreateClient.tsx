"use client";

// Real-screen conversion (2026-08-30) -- replaces GrcClient.tsx's old
// "Record Finding" Dialog popup with a real create screen. No Object Page
// yet: findings are only ever fetched pre-nested inside an engagement (no
// standalone GET), matching the data model's own shape -- an honest scope
// cut, not an oversight.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetch-json";

type Engagement = { id: string; name: string };

export default function AuditFindingCreateClient() {
  const router = useRouter();
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [engagementId, setEngagementId] = useState("");
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ engagements?: Engagement[] }>("/api/audit-engagements").then((d) => setEngagements(d.engagements ?? [])).catch(() => {});
  }, []);

  async function createFinding() {
    if (!engagementId || !title.trim()) {
      toast.error("Audit engagement and title are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/audit-findings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditEngagementId: engagementId, title, severity }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to record finding");
      toast.success("Finding recorded");
      router.push("/grc?tab=audits");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't record finding");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="GRC / Record Finding"
      title="Record a Finding"
      mode="create"
      hasDraft={false}
      onSave={createFinding}
      onCancel={() => router.push("/grc?tab=audits")}
      onBack={() => router.push("/grc?tab=audits")}
      saveDisabled={submitting || !engagementId || !title.trim()}
      saveDisabledReason={submitting ? "Recording…" : (!engagementId || !title.trim()) ? "Audit engagement and title are required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Audit Engagement</Label>
          <Select value={engagementId} onValueChange={setEngagementId}>
            <SelectTrigger><SelectValue placeholder={engagements.length ? "Select an engagement" : "Plan an engagement first"} /></SelectTrigger>
            <SelectContent>{engagements.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><Label>Finding Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Missing fire-exit signage on Floor 3" /></div>
        <div className="space-y-1.5">
          <Label>Severity</Label>
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{["low", "medium", "high", "critical"].map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
    </ObjectScreen>
  );
}
