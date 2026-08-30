"use client";

// Real-screen conversion (2026-08-30): the Case Register never had a
// detail view -- description/financialExposure/investigatorId/
// detectionSource were write-only from the create dialog, never shown
// again. Real Object Page with the real branching status machine
// (investigating -> confirmed OR unsubstantiated), including the real
// resolutionSummary field on the final "resolved" transition that the old
// inline row button never collected.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { currencyLabel, useCurrencies } from "@/lib/currency";

type FraudCase = {
  id: string; caseNumber: number; title: string; status: string; fraudType: string;
  description: string | null; financialExposure: string | null; reportedDate: string;
  resolutionSummary: string | null; resolvedDate: string | null;
};

const TRANSITIONS: Record<string, string[]> = {
  reported: ["investigating"], investigating: ["confirmed", "unsubstantiated"],
  confirmed: ["resolved"], unsubstantiated: ["resolved"], resolved: [],
};
const STATUS_TONE: Record<string, "needs-you" | "running" | "waiting" | "done" | "late" | "neutral"> = {
  reported: "needs-you", investigating: "running", confirmed: "late", unsubstantiated: "neutral", resolved: "done",
};

export default function FraudCaseObjectClient({ caseId }: { caseId: string }) {
  const router = useRouter();
  const currencies = useCurrencies();
  const [fraudCase, setFraudCase] = useState<FraudCase | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [resolutionSummary, setResolutionSummary] = useState("");

  async function load() {
    try {
      const res = await fetch(`/api/fraud-cases/${caseId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load this case");
      setFraudCase(data);
      setLoadError(null);
    } catch (err) {
      setFraudCase(null);
      setLoadError(err instanceof Error ? err.message : "Couldn't load this case");
    }
  }

  useEffect(() => { load(); }, [caseId]);

  async function transition(status: string) {
    setTransitioning(status);
    try {
      const res = await fetch(`/api/fraud-cases/${caseId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, resolutionSummary: status === "resolved" ? (resolutionSummary || undefined) : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to update case status");
      toast.success(`Case moved to ${status}`);
      setResolutionSummary("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update case status");
    } finally {
      setTransitioning(null);
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
  if (!fraudCase) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const nextOptions = TRANSITIONS[fraudCase.status] ?? [];

  return (
    <ObjectScreen
      breadcrumb="GRC / Case"
      title={`Case #${fraudCase.caseNumber} — ${fraudCase.title}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[fraudCase.status] ?? "neutral", label: fraudCase.status }}
      facets={[
        { label: "Type", value: fraudCase.fraudType.replace(/_/g, " ") },
        { label: "Reported", value: fraudCase.reportedDate },
        { label: "Financial Exposure", value: fraudCase.financialExposure ? `${currencyLabel(undefined, currencies)}${Number(fraudCase.financialExposure).toLocaleString()}` : "—" },
      ]}
      onBack={() => router.push("/grc?tab=fraud")}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {nextOptions.length > 0 && (
          <div className="space-y-2 border-b border-ct-border pb-3">
            {nextOptions.includes("resolved") && (
              <div className="space-y-1.5 max-w-md">
                <Label>Resolution Summary (optional)</Label>
                <Textarea value={resolutionSummary} onChange={(e) => setResolutionSummary(e.target.value)} rows={2} />
              </div>
            )}
            <div className="flex gap-2">
              {nextOptions.map((s) => (
                <Button key={s} size="sm" variant={s === "resolved" ? "default" : "outline"} disabled={transitioning !== null} onClick={() => transition(s)}>
                  {transitioning === s ? "Updating…" : `Move to ${s.replace(/_/g, " ")}`}
                </Button>
              ))}
            </div>
          </div>
        )}
        <p className="text-sm text-ct-navy whitespace-pre-wrap">{fraudCase.description || <span className="text-ct-muted">No description.</span>}</p>
        {fraudCase.status === "resolved" && (
          <div className="border-t border-ct-border pt-3">
            <p className="mb-1 text-xs font-semibold text-ct-muted">Resolution</p>
            <p className="text-[13px] text-ct-navy">{fraudCase.resolutionSummary ?? "—"}</p>
            <p className="text-[12px] text-ct-muted">Resolved {fraudCase.resolvedDate}</p>
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
