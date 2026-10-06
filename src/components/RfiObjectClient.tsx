"use client";

// Real-screen conversion (2026-08-30): RFIs never had a detail view --
// getRfi() didn't exist before this conversion (only the list). Real
// Object Page on the kit's ObjectScreen. The old "Answer" Dialog popup is
// now a real inline form (not a second popup). No generic Edit/Delete --
// no updateRfi() exists, only the 2 real transitions (answer/close).
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDate } from "@/lib/format-date";
import { answerRfiLocally, localBaseVersion } from "@/lib/local-first/local-writes";
import { useLocalWrites } from "@/lib/local-first/use-local-writes";
import { useDraft } from "@/lib/local-first/outbox-drafts";
import { PendingSyncMarker } from "@/components/PendingSyncMarker";
import { viaPxApi } from "@/lib/px-api";

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
  // LOCAL-FIRST (data:F12): the laptop's version of this RFI when the screen LOADED; the answer is based on it.
  const baseVersion = useRef<number | null>(null);
  // LOCAL-FIRST "Edit again": an answer the server did not take, named in the URL, is put back in the box.
  const searchParams = useSearchParams();
  const { draft, clear: clearDraft } = useDraft(searchParams?.get("draft"));
  useEffect(() => {
    if (draft?.functionId === "answer_rfi" && draft.params.rfiId === rfiId && typeof draft.params.answer === "string") setAnswerText(draft.params.answer);
  }, [draft, rfiId]);

  async function load() {
    try {
      const data = await fetchJson<Rfi>(`/api/rfis/${rfiId}`);
      setRfi(data);
      setLoadError(null);
      baseVersion.current = await localBaseVersion({ projectId: data.projectId, kind: "rfis", id: rfiId }).catch(() => null);
    } catch (err) {
      setRfi(null);
      setLoadError(errorMessage(err, "Couldn't load this RFI"));
    }
  }
  useEffect(() => { load(); }, [rfiId]);

  // LOCAL-FIRST: an answer made on this laptop that the server has not confirmed yet. Flag off = an empty view.
  // Only an applied change of THIS RFI reloads it (data:F5).
  const pending = useLocalWrites("rfis", rfi?.projectId, { onApplied: (applied) => { if (applied.recordId === rfiId) void load(); } });

  async function submitAnswer() {
    if (!answerText.trim()) { toast.error("An answer is required"); return; }
    setBusy("answer");
    let refused: string | null = null;
    try {
      // LOCAL-FIRST (see src/lib/local-first/local-writes.ts): with this RFI on the laptop, the answer is written there at once and
      // sent by the outbox; anything else returns null and the request below runs as it always did. A refusal before storing
      // (a text above the server's limit) keeps the text in the box and still tries the online answer.
      const result = rfi ? await answerRfiLocally({ projectId: rfi.projectId, rfiId, answer: answerText, baseVersion: baseVersion.current }) : null;
      if (result?.queued) {
        toast.success("Answer saved on this laptop. It is being sent to the server.");
        setAnswerText("");
        void clearDraft();
        return;
      }
      if (result && !result.queued) refused = result.refused;
      const res = await viaPxApi(`/api/rfis/${rfiId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "answer", answer: answerText }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to answer RFI");
      toast.success("RFI answered");
      setAnswerText("");
      void clearDraft();
      await load();
    } catch (err) {
      toast.error(refused ?? (err instanceof Error ? err.message : "Couldn't answer RFI"));
    } finally {
      setBusy(null);
    }
  }

  async function closeRfi() {
    setBusy("close");
    try {
      const res = await viaPxApi(`/api/rfis/${rfiId}`, {
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

  // The server's row with this laptop's waiting answer laid over it.
  const waiting = pending.edits.get(rfiId);
  const shown: Rfi = typeof waiting?.answer === "string" ? { ...rfi, answer: waiting.answer, status: "answered" } : rfi;

  return (
    <ObjectScreen
      breadcrumb="RFIs / RFI"
      title={`RFI-${shown.number} — ${shown.subject}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[shown.status] ?? "neutral", label: shown.status }}
      facets={[
        { label: "Ball in Court", value: shown.ballInCourt },
        { label: "Due Date", value: shown.dueDate ? formatDate(shown.dueDate) : "—" },
      ]}
      onBack={() => router.push(`/rfis?projectId=${shown.projectId}`)}
      messages={[]}
    >
      <div className="space-y-4 px-4 py-3">
        {waiting ? <div><PendingSyncMarker /></div> : null}
        <div>
          <h4 className="mb-1 text-sm font-semibold text-ct-navy">Question</h4>
          <p className="whitespace-pre-wrap text-sm text-ct-muted">{shown.question}</p>
        </div>

        {shown.answer && (
          <div>
            <h4 className="mb-1 text-sm font-semibold text-ct-navy">Answer</h4>
            <p className="whitespace-pre-wrap text-sm text-ct-muted">{shown.answer}</p>
          </div>
        )}

        {shown.status === "open" && (
          <div className="space-y-2 border-t border-ct-border pt-3">
            <h4 className="text-sm font-semibold text-ct-navy">Answer this RFI</h4>
            <Textarea value={answerText} onChange={(e) => setAnswerText(e.target.value)} rows={4} placeholder="Your answer…" />
            <Button size="sm" disabled={busy !== null} onClick={submitAnswer}>{busy === "answer" ? "Submitting…" : "Submit Answer"}</Button>
          </div>
        )}
        {shown.status === "answered" && (
          <div className="border-t border-ct-border pt-3">
            <Button size="sm" variant="outline" disabled={busy !== null || !!waiting} onClick={closeRfi}>{busy === "close" ? "Closing…" : "Close"}</Button>
          </div>
        )}
      </div>
    </ObjectScreen>
  );
}
