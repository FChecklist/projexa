"use client";

// Real-screen conversion (2026-08-30): replaces RfisClient.tsx's old "New
// RFI" Dialog popup with a real create screen. Also surfaces `dueDate` --
// createRfi() has always accepted it but the old Dialog never asked for it.
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { createRfiLocally } from "@/lib/local-first/local-writes";
import { useDraft } from "@/lib/local-first/outbox-drafts";

export default function RfiCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [question, setQuestion] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // LOCAL-FIRST "Edit again": a new RFI the server did not take, named in the URL, opens with what the person typed.
  const searchParams = useSearchParams();
  const { draft, clear: clearDraft } = useDraft(searchParams?.get("draft"));
  useEffect(() => {
    if (draft?.functionId !== "create_rfi" || draft.projectId !== projectId) return;
    if (typeof draft.params.subject === "string") setSubject(draft.params.subject);
    if (typeof draft.params.question === "string") setQuestion(draft.params.question);
    if (typeof draft.params.dueDate === "string") setDueDate(draft.params.dueDate);
  }, [draft, projectId]);

  async function create() {
    if (!subject.trim() || !question.trim()) { toast.error("Subject and question are required"); return; }
    setSubmitting(true);
    let refused: string | null = null;
    try {
      // LOCAL-FIRST (flag px-local-first=1, see src/lib/local-first/local-writes.ts): with the laptop's workspace ready the
      // RFI is written to this laptop at once and sent to the server by the outbox -- so it is not lost offline, and the
      // list shows it immediately with a "saved on this laptop, syncing" marker. Anything else (flag off, nobody signed in,
      // project not copied yet) returns null and the request below runs exactly as it always did. A refusal before storing
      // (a text above the server's limit) keeps the form as typed and still tries the online request.
      const result = await createRfiLocally({ projectId, subject, question, dueDate: dueDate || undefined });
      if (result?.queued) {
        toast.success("RFI saved on this laptop. It is being sent to the server.");
        void clearDraft();
        router.push(`/rfis?projectId=${encodeURIComponent(projectId)}`);
        return;
      }
      if (result && !result.queued) refused = result.refused;
      const rfi = await fetchJson<{ id: string }>("/api/rfis", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, subject, question, dueDate: dueDate || undefined }),
      });
      toast.success("RFI created");
      void clearDraft();
      router.push(`/rfis/${rfi.id}`);
    } catch (err) {
      toast.error(refused ?? errorMessage(err, "Couldn't create RFI"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="RFIs / New RFI"
      title="New RFI"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push(`/rfis?projectId=${projectId}`)}
      onBack={() => router.push(`/rfis?projectId=${projectId}`)}
      saveDisabled={submitting || !subject.trim() || !question.trim()}
      saveDisabledReason={submitting ? "Creating…" : (!subject.trim() || !question.trim()) ? "Subject and question are required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Subject</Label><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Question</Label><Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={4} /></div>
        <div className="space-y-1.5"><Label>Due Date (optional)</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
