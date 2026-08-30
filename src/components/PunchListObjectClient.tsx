"use client";

// Real-screen conversion (2026-08-30): punch list items never had a detail
// view -- getPunchListItem() didn't exist before this conversion (only the
// list). Real Object Page on the kit's ObjectScreen. No generic Edit/Delete
// -- no updatePunchListItem() exists, only the 2 real status transitions
// (Mark Done -> Verify & Close), both moved here from the list.
//
// Real, pre-existing constraint (not introduced here): verifyPunchListItemClosed()
// has a genuine "don't let the person who did the work sign off their own
// fix" self-approval check (isSelfApproval(assignedToId, verifierId)) --
// but since PROJEXA calls through one shared org API key for every action,
// neither "who marked it ready" nor "who is verifying" carries a real,
// distinct per-user identity through that path, so the check is
// effectively a no-op today (same class of finding as KPI entries, module
// #15). Not fixed here -- there's no fix without a real per-user identity
// bridge, and this conversion doesn't invent one.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type PunchItem = {
  id: string; projectId: string; number: number; description: string; location: string | null; trade: string | null;
  priority: string; status: string; assignedToId: string | null; dueDate: string | null;
};

const STATUS_TONE: Record<string, StatusTone> = { open: "needs-you", ready_for_review: "waiting", verified_closed: "done" };

export default function PunchListObjectClient({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [item, setItem] = useState<PunchItem | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"ready" | "verify" | null>(null);

  async function load() {
    try {
      setItem(await fetchJson<PunchItem>(`/api/punch-list/${itemId}`));
      setLoadError(null);
    } catch (err) {
      setItem(null);
      setLoadError(errorMessage(err, "Couldn't load this punch list item"));
    }
  }
  useEffect(() => { load(); }, [itemId]);

  async function transition(action: "ready" | "verify") {
    setBusy(action);
    try {
      const res = await fetch(`/api/punch-list/${itemId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to update item");
      toast.success(action === "ready" ? "Marked done" : "Verified and closed");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update item");
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
  if (!item) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Punch List / Item"
      title={`PL-${item.number}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[item.status] ?? "neutral", label: item.status.replace(/_/g, " ") }}
      facets={[
        { label: "Location", value: item.location ?? "—" },
        { label: "Trade", value: item.trade ?? "—" },
        { label: "Priority", value: item.priority },
      ]}
      onBack={() => router.push(`/punch-list?projectId=${item.projectId}`)}
      messages={[]}
    >
      <div className="space-y-4 px-4 py-3">
        <div className="flex items-center gap-2">
          {item.status === "open" && (
            <Button size="sm" disabled={busy !== null} onClick={() => transition("ready")}>{busy === "ready" ? "Marking…" : "Mark Done"}</Button>
          )}
          {item.status === "ready_for_review" && (
            <Button size="sm" disabled={busy !== null} onClick={() => transition("verify")}>{busy === "verify" ? "Verifying…" : "Verify & Close"}</Button>
          )}
        </div>
        <p className="text-sm text-ct-navy">{item.description}</p>
      </div>
    </ObjectScreen>
  );
}
