"use client";

// Real-screen conversion (2026-08-30): the Policy Library never had a
// detail view -- and the server's own "edit" action (updatePolicy(action:
// 'edit'), bumps the version and appends to history) had ZERO UI entry
// point despite existing since Priority 15. Real Object Page with a real
// Edit that actually calls it, plus the real "Request Publish" maker-
// checker action (moved from a list-row button into the object page).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type HistoryEntry = { version: string; date: string; editedBy: string; note: string };
type Policy = {
  id: string; title: string; category: string; version: string; status: string;
  attestationRate: number | null; history: HistoryEntry[] | null;
};

const STATUS_TONE: Record<string, "needs-you" | "running" | "waiting" | "done" | "late" | "neutral"> = {
  draft: "neutral", under_review: "waiting", published: "done",
};

export default function PolicyObjectClient({ policyId }: { policyId: string }) {
  const router = useRouter();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  async function load() {
    try {
      const res = await fetch(`/api/policies/${policyId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load this policy");
      setPolicy(data);
      setLoadError(null);
    } catch (err) {
      setPolicy(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this policy");
    }
  }

  useEffect(() => { load(); }, [policyId]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/policies/${policyId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit", note: note || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save policy");
      toast.success(`Updated to ${data.version}`);
      setNote(""); setMode("display");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save policy");
    } finally {
      setSaving(false);
    }
  }

  async function requestPublish() {
    setPublishing(true);
    try {
      const res = await fetch(`/api/policies/${policyId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "request_publish" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to request publish");
      toast.success("Publish requested — awaiting maker-checker approval");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't request publish");
    } finally {
      setPublishing(false);
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
  if (!policy) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="GRC / Policy"
      title={policy.title}
      subtitle={policy.version}
      mode={mode}
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[policy.status] ?? "neutral", label: policy.status.replace(/_/g, " ") }}
      facets={[
        { label: "Category", value: policy.category },
        { label: "Attestation Rate", value: policy.attestationRate != null ? `${policy.attestationRate}%` : "—" },
      ]}
      onEdit={mode === "display" ? () => { setNote(""); setMode("edit"); } : undefined}
      onSave={mode === "edit" ? handleSave : undefined}
      onCancel={mode === "edit" ? () => setMode("display") : undefined}
      onBack={() => router.push("/grc?tab=policies")}
      saveDisabled={saving}
      saveDisabledReason={saving ? "Saving…" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {mode === "display" && policy.status === "draft" && (
          <div className="border-b border-ct-border pb-3">
            <Button size="sm" variant="outline" disabled={publishing} onClick={requestPublish}>
              {publishing ? "Requesting…" : "Request Publish"}
            </Button>
          </div>
        )}
        {mode === "edit" && (
          <div className="space-y-1.5 max-w-md">
            <Label>Change Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What changed in this version?" />
          </div>
        )}
        <div className="border-t border-ct-border pt-3">
          <p className="mb-1 text-xs font-semibold text-ct-muted">Version History</p>
          {!policy.history || policy.history.length === 0 ? (
            <p className="text-sm text-ct-muted">No history recorded.</p>
          ) : (
            <ul className="space-y-1 text-[13px]">
              {policy.history.map((h, i) => (
                <li key={i} className="text-ct-navy">
                  <span className="font-medium">{h.version}</span> — {h.date} by {h.editedBy}{h.note ? `: "${h.note}"` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ObjectScreen>
  );
}
