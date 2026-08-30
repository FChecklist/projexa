"use client";

// Real-screen conversion (2026-08-30): the Risk Register never had a
// detail view -- real status-advance (open -> mitigating -> closed) was
// already an inline row button (kept as-is in the list); this adds the
// missing detail view. No Edit: no updateRisk() for title/category/
// likelihood/impact exists, only status and linked-controls (a separate,
// more advanced feature not wired to any UI yet).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Risk = {
  id: string; title: string; category: string; likelihood: number; impact: number;
  severity: string; status: string; ownerDept: string | null;
};

const RISK_STATUS_FLOW: Record<string, string> = { open: "mitigating", mitigating: "closed" };
const SEVERITY_TONE: Record<string, "needs-you" | "running" | "waiting" | "done" | "late" | "neutral"> = {
  low: "neutral", medium: "waiting", high: "late",
};

export default function RiskObjectClient({ riskId }: { riskId: string }) {
  const router = useRouter();
  const [risk, setRisk] = useState<Risk | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);

  async function load() {
    try {
      const data = await fetchJson<Risk>(`/api/risks/${riskId}`);
      setRisk(data);
      setLoadError(null);
    } catch (err) {
      setRisk(null);
      setLoadError(errorMessage(err, "Couldn't load this risk"));
    }
  }

  useEffect(() => { load(); }, [riskId]);

  async function advanceStatus() {
    if (!risk) return;
    const next = RISK_STATUS_FLOW[risk.status];
    if (!next) return;
    setAdvancing(true);
    try {
      const res = await fetch(`/api/risks/${riskId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update risk status");
      toast.success(`Moved to ${next}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update risk status");
    } finally {
      setAdvancing(false);
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
  if (!risk) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const next = RISK_STATUS_FLOW[risk.status];

  return (
    <ObjectScreen
      breadcrumb="GRC / Risk"
      title={risk.title}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: SEVERITY_TONE[risk.severity] ?? "neutral", label: `${risk.severity} severity` }}
      facets={[
        { label: "Category", value: risk.category },
        { label: "Likelihood", value: `${risk.likelihood} / 5` },
        { label: "Impact", value: `${risk.impact} / 5` },
        { label: "Status", value: risk.status },
      ]}
      onBack={() => router.push("/grc?tab=risks")}
      messages={[]}
    >
      {next && (
        <div className="border-b border-ct-border px-4 py-3">
          <Button size="sm" disabled={advancing} onClick={advanceStatus}>{advancing ? "Updating…" : `Move to ${next}`}</Button>
        </div>
      )}
      <div className="px-4 py-3 text-[13px] text-ct-muted">
        Owner department: {risk.ownerDept ?? "Unassigned"}
      </div>
    </ObjectScreen>
  );
}
