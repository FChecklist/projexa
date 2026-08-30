"use client";

// Real-screen conversion (2026-08-30): submittals never had a detail view --
// getSubmittal() didn't exist before this conversion (only the list). Real
// Object Page on the kit's ObjectScreen. The old "Review" Dialog popup is
// now a real inline action bar (not a second popup) -- keeps the same
// PATCH body shape (action/status/comments/projectId) the notification
// wiring in api/submittals/[id]/route.ts already depends on.
//
// Real, pre-existing, deliberate constraint (not introduced here): like
// Punch List's verifyPunchListItemClosed (module #23), reviewSubmittal()
// has a genuine self-approval check (the submitter can't review their own
// submittal) that's effectively a no-op through PROJEXA's shared API key --
// documented, not fixed (no fix exists without a real per-user identity
// bridge).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

type Submittal = {
  id: string; projectId: string; number: number; title: string; specSection: string | null; type: string;
  status: string; reviewComments: string | null; dueDate: string | null;
};

const STATUS_TONE: Record<string, StatusTone> = {
  pending: "needs-you", approved: "done", approved_as_noted: "done", revise_resubmit: "waiting", rejected: "late",
};

export default function SubmittalObjectClient({ submittalId }: { submittalId: string }) {
  const router = useRouter();
  const [submittal, setSubmittal] = useState<Submittal | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      setSubmittal(await fetchJson<Submittal>(`/api/submittals/${submittalId}`));
      setLoadError(null);
    } catch (err) {
      setSubmittal(null);
      setLoadError(errorMessage(err, "Couldn't load this submittal"));
    }
  }
  useEffect(() => { load(); }, [submittalId]);

  async function review(status: string) {
    if (!submittal) return;
    setBusy(status);
    try {
      const res = await fetch(`/api/submittals/${submittalId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "review", status, comments, projectId: submittal.projectId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to review submittal");
      toast.success("Submittal reviewed");
      setComments("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't review submittal");
    } finally {
      setBusy(null);
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
  if (!submittal) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Submittals / Submittal"
      title={`SUB-${submittal.number} — ${submittal.title}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[submittal.status] ?? "neutral", label: submittal.status.replace(/_/g, " ") }}
      facets={[
        { label: "Spec Section", value: submittal.specSection ?? "—" },
        { label: "Type", value: submittal.type.replace(/_/g, " ") },
        { label: "Due Date", value: submittal.dueDate ? formatDate(submittal.dueDate) : "—" },
      ]}
      onBack={() => router.push(`/submittals?projectId=${submittal.projectId}`)}
      messages={[]}
    >
      <div className="space-y-4 px-4 py-3">
        {submittal.reviewComments && (
          <div>
            <h4 className="mb-1 text-sm font-semibold text-ct-navy">Review Comments</h4>
            <p className="whitespace-pre-wrap text-sm text-ct-muted">{submittal.reviewComments}</p>
          </div>
        )}

        {submittal.status === "pending" && (
          <div className="space-y-2 border-t border-ct-border pt-3">
            <h4 className="text-sm font-semibold text-ct-navy">Review this Submittal</h4>
            <Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} placeholder="Review comments (optional)…" />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy !== null} onClick={() => review("approved")}>{busy === "approved" ? "Working…" : "Approve"}</Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => review("approved_as_noted")}>{busy === "approved_as_noted" ? "Working…" : "Approve as Noted"}</Button>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => review("revise_resubmit")}>{busy === "revise_resubmit" ? "Working…" : "Revise & Resubmit"}</Button>
              <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => review("rejected")}>{busy === "rejected" ? "Working…" : "Reject"}</Button>
            </div>
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
