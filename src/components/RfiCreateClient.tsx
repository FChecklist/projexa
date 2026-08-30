"use client";

// Real-screen conversion (2026-08-30): replaces RfisClient.tsx's old "New
// RFI" Dialog popup with a real create screen. Also surfaces `dueDate` --
// createRfi() has always accepted it but the old Dialog never asked for it.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function RfiCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [question, setQuestion] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function create() {
    if (!subject.trim() || !question.trim()) { toast.error("Subject and question are required"); return; }
    setSubmitting(true);
    try {
      const rfi = await fetchJson<{ id: string }>("/api/rfis", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, subject, question, dueDate: dueDate || undefined }),
      });
      toast.success("RFI created");
      router.push(`/rfis/${rfi.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create RFI"));
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
