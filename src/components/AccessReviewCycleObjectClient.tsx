"use client";

// Real-screen conversion (2026-08-30): replaces GrcClient.tsx's in-tab
// master-detail state (clicking a cycle name in a list, no URL) with a real
// routed Object Page. Reuses the ALREADY-REAL `/api/access-review?cycleId=`
// query-param route -- getAccessReviewCycleDetail() already existed
// server-side, it just had no route of its own. Confirm/Revoke stay real
// inline actions (already non-popup), just moved here from the old tab.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Certification = { id: string; userId: string; userName: string; userEmail: string | null; reviewedRole: string; decision: string };
type Cycle = { id: string; name: string; status: string; dueDate: string | null; completedAt: string | null; certifications: Certification[] };

const DECISION_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline", confirmed: "default", revoked: "destructive",
};

export default function AccessReviewCycleObjectClient({ cycleId }: { cycleId: string }) {
  const router = useRouter();
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  async function load() {
    try {
      const data = await fetchJson<Cycle>(`/api/access-review?cycleId=${encodeURIComponent(cycleId)}`);
      setCycle(data);
      setLoadError(null);
    } catch (err) {
      setCycle(null);
      setLoadError(errorMessage(err, "Couldn't load this access review cycle"));
    }
  }

  useEffect(() => { load(); }, [cycleId]);

  async function decide(certificationId: string, decision: "confirmed" | "revoked") {
    setDecidingId(certificationId);
    try {
      const res = await fetch(`/api/access-review/certifications/${certificationId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update certification");
      toast.success(`Certification ${decision}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update certification");
    } finally {
      setDecidingId(null);
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
  if (!cycle) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const pendingCount = cycle.certifications.filter((c) => c.decision === "pending").length;

  return (
    <ObjectScreen
      breadcrumb="GRC / Access Review Cycle"
      title={cycle.name}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: pendingCount === 0 ? "done" : "needs-you", label: cycle.status }}
      facets={[
        { label: "Due", value: cycle.dueDate ?? "—" },
        { label: "Pending", value: String(pendingCount) },
        { label: "Total", value: String(cycle.certifications.length) },
      ]}
      onBack={() => router.push("/grc?tab=access-review")}
      messages={[]}
    >
      <Table>
        <TableHeader>
          <TableRow><TableHead>User</TableHead><TableHead>Role</TableHead><TableHead>Decision</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {cycle.certifications.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">{c.userName}<div className="text-xs text-ct-muted">{c.userEmail}</div></TableCell>
              <TableCell className="text-ct-muted">{c.reviewedRole}</TableCell>
              <TableCell><Badge variant={DECISION_VARIANT[c.decision] ?? "outline"}>{c.decision}</Badge></TableCell>
              <TableCell className="text-right">
                {c.decision === "pending" && (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" disabled={decidingId === c.id} onClick={() => decide(c.id, "confirmed")}>Confirm</Button>
                    <Button size="sm" variant="destructive" disabled={decidingId === c.id} onClick={() => decide(c.id, "revoked")}>Revoke</Button>
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </ObjectScreen>
  );
}
