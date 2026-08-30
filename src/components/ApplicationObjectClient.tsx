"use client";

// Real-screen conversion (2026-08-30): replaces a genuine 3-level Dialog
// nest (Application detail Dialog -> "Schedule Interview" Dialog opened
// from inside it -> a separate "Interview Feedback" Dialog) with one real
// Object Page. getApplication()/getJobOpening() didn't exist before this
// conversion (only list functions). Also surfaces `offerAmount` on the
// "offer" transition -- moveApplicationStage() has always accepted it but
// the old UI never asked for it.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserCheck } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { formatDateTime } from "@/lib/format-date";

type Application = {
  id: string; jobOpeningId: string; candidateId: string; stage: string; rejectedReason: string | null;
  offerAmount: string | null; hiredEmployeeProfileId: string | null;
};
type JobOpening = { id: string; title: string };
type Candidate = { id: string; name: string };
type InterviewFeedback = { id: string; interviewerId: string; roundName: string; scheduledAt: string; rating: number | null; recommendation: string | null; completedAt: string | null };
type Employee = { id: string; name: string; profile: { id: string; employeeCode: string | null } | null };

const STAGE_LABEL: Record<string, string> = { applied: "Applied", screening: "Screening", interview: "Interview", offer: "Offer", hired: "Hired", rejected: "Rejected" };
const VALID_TRANSITIONS: Record<string, string[]> = {
  applied: ["screening", "rejected"], screening: ["interview", "rejected"], interview: ["offer", "rejected"], offer: ["hired", "rejected"], hired: [], rejected: [],
};
const STATUS_TONE: Record<string, StatusTone> = {
  applied: "neutral", screening: "waiting", interview: "waiting", offer: "waiting", hired: "done", rejected: "late",
};

export default function ApplicationObjectClient({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [application, setApplication] = useState<Application | null>(null);
  const [jobOpening, setJobOpening] = useState<JobOpening | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [interviews, setInterviews] = useState<InterviewFeedback[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [stageBusy, setStageBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [offerAmount, setOfferAmount] = useState("");

  const [ivInterviewerId, setIvInterviewerId] = useState("");
  const [ivRoundName, setIvRoundName] = useState("");
  const [ivScheduledAt, setIvScheduledAt] = useState("");
  const [ivSubmitting, setIvSubmitting] = useState(false);

  const [feedbackTargetId, setFeedbackTargetId] = useState<string | null>(null);
  const [fbRating, setFbRating] = useState("5");
  const [fbRecommendation, setFbRecommendation] = useState("yes");
  const [fbNotes, setFbNotes] = useState("");
  const [fbSubmitting, setFbSubmitting] = useState(false);

  const [hireEmployeeProfileId, setHireEmployeeProfileId] = useState("");
  const [hireSubmitting, setHireSubmitting] = useState(false);

  async function load() {
    try {
      const app = await fetchJson<Application>(`/api/recruitment/applications/${applicationId}`);
      const [openingData, candData, ivData, empData] = await Promise.all([
        fetchJson<JobOpening>(`/api/recruitment/job-openings/${app.jobOpeningId}`).catch(() => null),
        fetchJson<{ candidates?: Candidate[] }>("/api/recruitment/candidates").catch(() => ({ candidates: [] })),
        fetchJson<{ interviews?: InterviewFeedback[] }>(`/api/recruitment/applications/${applicationId}/interviews`).catch(() => ({ interviews: [] })),
        fetchJson<{ employees?: Employee[] }>("/api/employees").catch(() => ({ employees: [] })),
      ]);
      setApplication(app);
      setJobOpening(openingData);
      setCandidate((candData.candidates ?? []).find((c) => c.id === app.candidateId) ?? null);
      setInterviews(ivData.interviews ?? []);
      setEmployees(empData.employees ?? []);
      setLoadError(null);
    } catch (err) {
      setApplication(null);
      setLoadError(errorMessage(err, "Couldn't load this application"));
    }
  }
  useEffect(() => { load(); }, [applicationId]);

  async function moveStage(toStage: string) {
    setStageBusy(true);
    try {
      const res = await fetch(`/api/recruitment/applications/${applicationId}/stage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: toStage,
          rejectedReason: toStage === "rejected" ? (rejectReason || undefined) : undefined,
          offerAmount: toStage === "offer" && offerAmount ? Number(offerAmount) : undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to move application stage");
      toast.success(`Moved to ${STAGE_LABEL[toStage]}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't move application stage");
    } finally {
      setStageBusy(false);
    }
  }

  async function scheduleInterview() {
    if (!ivInterviewerId || !ivRoundName.trim() || !ivScheduledAt) { toast.error("Interviewer, round name, and date/time are required"); return; }
    setIvSubmitting(true);
    try {
      const res = await fetch(`/api/recruitment/applications/${applicationId}/interviews`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewerId: ivInterviewerId, roundName: ivRoundName, scheduledAt: ivScheduledAt }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to schedule interview");
      toast.success("Interview scheduled");
      setIvInterviewerId(""); setIvRoundName(""); setIvScheduledAt("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't schedule interview");
    } finally {
      setIvSubmitting(false);
    }
  }

  async function submitFeedback() {
    if (!feedbackTargetId) return;
    setFbSubmitting(true);
    try {
      const res = await fetch(`/api/recruitment/interviews/${feedbackTargetId}/feedback`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: Number(fbRating), recommendation: fbRecommendation, feedback: fbNotes || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to submit feedback");
      toast.success("Feedback submitted");
      setFeedbackTargetId(null); setFbNotes("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit feedback");
    } finally {
      setFbSubmitting(false);
    }
  }

  async function linkHire() {
    if (!hireEmployeeProfileId) return;
    setHireSubmitting(true);
    try {
      const res = await fetch(`/api/recruitment/applications/${applicationId}/hire`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeProfileId: hireEmployeeProfileId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to link hired employee");
      toast.success("Linked to employee record");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't link hired employee");
    } finally {
      setHireSubmitting(false);
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
  if (!application) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  const nextStages = VALID_TRANSITIONS[application.stage] ?? [];

  return (
    <ObjectScreen
      breadcrumb="Recruitment / Application"
      title={`${candidate?.name ?? "—"} — ${jobOpening?.title ?? "—"}`}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[application.stage] ?? "neutral", label: STAGE_LABEL[application.stage] }}
      facets={[
        ...(application.offerAmount ? [{ label: "Offer", value: application.offerAmount }] : []),
        ...(application.rejectedReason ? [{ label: "Rejection Reason", value: application.rejectedReason }] : []),
      ]}
      onBack={() => router.push("/recruitment?tab=pipeline")}
      messages={[]}
    >
      <div className="space-y-4 px-4 py-3">
        {nextStages.length > 0 && (
          <div className="space-y-2 border-b border-ct-border pb-4">
            <Label>Move Stage</Label>
            <div className="flex flex-wrap items-end gap-2">
              {nextStages.map((next) => (
                <Button key={next} size="sm" variant={next === "rejected" ? "outline" : "default"} disabled={stageBusy} onClick={() => moveStage(next)}>
                  {STAGE_LABEL[next]}
                </Button>
              ))}
              {nextStages.includes("rejected") && (
                <Input placeholder="Rejection reason (optional)" className="w-56" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
              )}
              {nextStages.includes("offer") && (
                <Input type="number" placeholder="Offer amount (optional)" className="w-44" value={offerAmount} onChange={(e) => setOfferAmount(e.target.value)} />
              )}
            </div>
          </div>
        )}

        <div className="space-y-2 border-b border-ct-border pb-4">
          <Label>Interviews</Label>
          {interviews.length === 0 ? (
            <p className="text-xs text-ct-muted">No interviews scheduled yet.</p>
          ) : (
            <Table>
              <TableBody>
                {interviews.map((iv) => (
                  <TableRow key={iv.id}>
                    <TableCell className="text-sm">{iv.roundName}</TableCell>
                    <TableCell className="text-xs text-ct-muted">{formatDateTime(iv.scheduledAt)}</TableCell>
                    <TableCell>
                      {iv.completedAt ? (
                        <Badge variant="outline">{iv.recommendation}</Badge>
                      ) : feedbackTargetId === iv.id ? (
                        <span className="text-xs text-ct-muted">Filling out feedback below…</span>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => { setFeedbackTargetId(iv.id); setFbRating("5"); setFbRecommendation("yes"); setFbNotes(""); }}>Add Feedback</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {feedbackTargetId && (
            <div className="mt-2 space-y-2 rounded-md border border-ct-border p-3">
              <p className="text-xs font-medium text-ct-navy">Interview Feedback</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Rating (1–5)</Label>
                  <Select value={fbRating} onValueChange={setFbRating}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Recommendation</Label>
                  <Select value={fbRecommendation} onValueChange={setFbRecommendation}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="strong_yes">Strong Yes</SelectItem>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                      <SelectItem value="strong_no">Strong No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Input placeholder="Notes (optional)" value={fbNotes} onChange={(e) => setFbNotes(e.target.value)} />
              <div className="flex gap-2">
                <Button size="sm" disabled={fbSubmitting} onClick={submitFeedback}>{fbSubmitting ? "Submitting…" : "Submit"}</Button>
                <Button size="sm" variant="ghost" onClick={() => setFeedbackTargetId(null)}>Cancel</Button>
              </div>
            </div>
          )}

          <div className="mt-3 space-y-2">
            <p className="text-xs font-medium text-ct-navy">Schedule Interview</p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label>Interviewer</Label>
                <Select value={ivInterviewerId} onValueChange={setIvInterviewerId}>
                  <SelectTrigger className="w-48"><SelectValue placeholder="Select interviewer" /></SelectTrigger>
                  <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Round Name</Label><Input className="w-40" value={ivRoundName} onChange={(e) => setIvRoundName(e.target.value)} placeholder="e.g. Technical Round 1" /></div>
              <div className="space-y-1.5"><Label>Scheduled At</Label><Input type="datetime-local" className="w-56" value={ivScheduledAt} onChange={(e) => setIvScheduledAt(e.target.value)} /></div>
              <Button size="sm" variant="outline" disabled={ivSubmitting} onClick={scheduleInterview}>{ivSubmitting ? "Scheduling…" : "Schedule"}</Button>
            </div>
          </div>
        </div>

        {application.stage === "hired" && !application.hiredEmployeeProfileId && (
          <div className="space-y-2">
            <Label className="flex items-center gap-1"><UserCheck className="size-4" /> Link to Employee Record</Label>
            <p className="text-xs text-ct-muted">Requires an existing employee profile (create one on the Employees page first — the person must already have a user account and a saved employee profile).</p>
            <div className="flex gap-2">
              <Select value={hireEmployeeProfileId} onValueChange={setHireEmployeeProfileId}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Select employee profile" /></SelectTrigger>
                <SelectContent>
                  {employees.filter((e) => e.profile).map((e) => (
                    <SelectItem key={e.profile!.id} value={e.profile!.id}>{e.name}{e.profile?.employeeCode ? ` (${e.profile.employeeCode})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" disabled={hireSubmitting || !hireEmployeeProfileId} onClick={linkHire}>Link</Button>
            </div>
          </div>
        )}
        {application.hiredEmployeeProfileId && (
          <p className="text-xs text-px-success">Linked to employee profile {application.hiredEmployeeProfileId}.</p>
        )}
      </div>
    </ObjectScreen>
  );
}
