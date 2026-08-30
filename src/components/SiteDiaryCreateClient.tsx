"use client";

// Real-screen conversion (2026-08-30): replaces SiteDiaryClient.tsx's old
// "New Entry" Dialog popup with a real create screen. Also surfaces
// `visitors`/`materialReceived`/`remarks` -- createSiteDiary() has always
// accepted all three but the old Dialog never asked.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

export default function SiteDiaryCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [diaryDate, setDiaryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [weather, setWeather] = useState("");
  const [workDone, setWorkDone] = useState("");
  const [visitors, setVisitors] = useState("");
  const [labourCount, setLabourCount] = useState("");
  const [issues, setIssues] = useState("");
  const [instructions, setInstructions] = useState("");
  const [materialReceived, setMaterialReceived] = useState("");
  const [remarks, setRemarks] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function create() {
    if (!diaryDate) { toast.error("Date is required"); return; }
    setSubmitting(true);
    try {
      const diary = await fetchJson<{ id: string }>("/api/site-diary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId, diaryDate, weather: weather || undefined, workDone: workDone || undefined,
          visitors: visitors || undefined, labourCount: labourCount ? Number(labourCount) : undefined,
          issues: issues || undefined, instructions: instructions || undefined,
          materialReceived: materialReceived || undefined, remarks: remarks || undefined,
        }),
      });
      toast.success("Diary entry saved");
      router.push(`/site-diary/${diary.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't save diary entry"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Site Diary / New Entry"
      title="New Site Diary Entry"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push(`/site-diary?projectId=${projectId}`)}
      onBack={() => router.push(`/site-diary?projectId=${projectId}`)}
      saveDisabled={submitting || !diaryDate}
      saveDisabledReason={submitting ? "Saving…" : !diaryDate ? "Date is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={diaryDate} onChange={(e) => setDiaryDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Weather</Label><Input value={weather} onChange={(e) => setWeather(e.target.value)} placeholder="e.g. Clear, 28°C" /></div>
        </div>
        <div className="space-y-1.5"><Label>Work Done</Label><Textarea value={workDone} onChange={(e) => setWorkDone(e.target.value)} rows={3} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Labour Count</Label><Input type="number" value={labourCount} onChange={(e) => setLabourCount(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Visitors (optional)</Label><Input value={visitors} onChange={(e) => setVisitors(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label>Material Received (optional)</Label><Textarea value={materialReceived} onChange={(e) => setMaterialReceived(e.target.value)} rows={2} /></div>
        <div className="space-y-1.5"><Label>Issues (optional)</Label><Textarea value={issues} onChange={(e) => setIssues(e.target.value)} rows={2} /></div>
        <div className="space-y-1.5"><Label>Instructions (optional)</Label><Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} /></div>
        <div className="space-y-1.5"><Label>Remarks (optional)</Label><Textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} /></div>
      </div>
    </ObjectScreen>
  );
}
