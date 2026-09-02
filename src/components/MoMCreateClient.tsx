"use client";

// Real-screen conversion (2026-08-30): replaces MoMsClient.tsx's old "New
// Meeting" Dialog popup with a real create screen.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

// R67 D-20: `projectName` is required, not decorative -- the screen states
// which project it is about to write into ("Project: Cedar Heights Villa -
// Phase 1"), in the same context tint the rail and the breadcrumb use, so a
// user can never save minutes into a project they did not knowingly pick.
// The route above this refuses to render the form at all without one.
export default function MoMCreateClient({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const missing = [...(title.trim() ? [] : ["Title"]), ...(scheduledAt ? [] : ["Date & time"])];

  async function createMeeting() {
    if (missing.length) return;
    setSubmitting(true);
    try {
      const meeting = await fetchJson<{ id: string }>("/api/moms", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), scheduledAt, projectId }),
      });
      toast.success("Meeting created");
      router.push(`/moms/${meeting.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create meeting"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Minutes of Meeting / New Meeting"
      title="New Meeting"
      mode="create"
      hasDraft={false}
      onSave={createMeeting}
      onCancel={() => router.push(`/moms?projectId=${projectId}`)}
      onBack={() => router.push(`/moms?projectId=${projectId}`)}
      saveDisabled={submitting || missing.length > 0}
      saveDisabledReason={submitting ? "Creating…" : missing.length ? missing.join(", ") : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <p className="text-[12px] text-px-muted">
          Project:{" "}
          <span style={{ color: "var(--color-veri-status-context)" }}>{projectName}</span>
        </p>
        <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Date &amp; time</Label><Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
