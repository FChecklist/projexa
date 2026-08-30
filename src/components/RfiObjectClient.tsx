"use client";

// Real-screen conversion (2026-08-30): RFIs never had a detail view --
// getRfi() didn't exist before this conversion (only the list). Real
// Object Page on the kit's ObjectScreen. The old "Answer" Dialog popup is
// now a real inline form (not a second popup). No generic Edit/Delete --
// no updateRfi() exists, only the 2 real transitions (answer/close).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";

type Rfi = {
  id: string; projectId: string; number: number; subject: string; question: string; status: string;
  ballInCourt: string; answer: string | null; dueDate: string | null;
};

const STATUS_TONE: Record<string, StatusTone> = { open: "needs-you", answered: "waiting", closed: "done" };

export default function RfiObjectClient({ rfiId }: { rfiId: string }) {
  const router = useRouter();
  const [rfi, setRfi] = useState<Rfi | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [busy, setBusy] = useState<"answer" | "close" | null>(null);

  async function load() {
    try {
      setRfi(await fetchJson<Rfi>(`/api/rfis/${rfiId}`));
      setLoadError(null);
    } catch (err) {
      setRfi(null);
      setLoadError(errorMessage(err, "Couldn't load this RFI"));
    }
  }
  useEffect(() => { load(); }, [rfiId]);

  async function submitAnswer() {
    if (!answerText.trim()) { toast.error("An answer is required"); return; }
    setBusy("answer");
    try {
      const res = await fetch(`/api/rfis/${rfiId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "answer", answer: answerText }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to answer RFI");
      toast.success("RFI answered");
      setAnswerText("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't answer RFI");
    } finally {
      setBusy(null);
    }
  }

  async function closeRfi() {
    setBusy("close");
    try {
      const res = await fetch(`/api/rfis/${rfiId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to close RFI");
      toast.success("RFI closed");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't close RFI");
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
  if (!rfi) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="RFIs / RFI"
      title={`RFI-${rfi.number} — ${rfi.subject}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[rfi.status] ?? "neutral", label: rfi.status }}
      facets={[
        { label: "Ball in Court", value: rfi.ballInCourt },
        { label: "Due Date", value: rfi.dueDate ? formatDate(rfi.dueDate) : "—" },
      ]}
      onBack={() => router.push(`/rfis?projectId=${rfi.projectId}`)}
      messages={[]}
    >
      <div className="space-y-4 px-4 py-3">
        <div>
          <h4 className="mb-1 text-sm font-semibold text-ct-navy">Question</h4>
          <p className="whitespace-pre-wrap text-sm text-ct-muted">{rfi.question}</p>
        </div>

        {rfi.answer && (
          <div>
            <h4 className="mb-1 text-sm font-semibold text-ct-navy">Answer</h4>
            <p className="whitespace-pre-wrap text-sm text-ct-muted">{rfi.answer}</p>
          </div>
        )}

        {rfi.status === "open" && (
          <div className="space-y-2 border-t border-ct-border pt-3">
            <h4 className="text-sm font-semibold text-ct-navy">Answer this RFI</h4>
            <Textarea value={answerText} onChange={(e) => setAnswerText(e.target.value)} rows={4} placeholder="Your answer…" />
            <Button size="sm" disabled={busy !== null} onClick={submitAnswer}>{busy === "answer" ? "Submitting…" : "Submit Answer"}</Button>
          </div>
        )}
        {rfi.status === "answered" && (
          <div className="border-t border-ct-border pt-3">
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={closeRfi}>{busy === "close" ? "Closing…" : "Close"}</Button>
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
