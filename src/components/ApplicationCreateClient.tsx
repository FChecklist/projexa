"use client";

// Real-screen conversion (2026-08-30): replaces RecruitmentClient.tsx's old
// "New Application" Dialog popup with a real create screen.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type JobOpening = { id: string; title: string };
type Candidate = { id: string; name: string };

export default function ApplicationCreateClient() {
  const router = useRouter();
  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [jobOpeningId, setJobOpeningId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ jobOpenings?: JobOpening[] }>("/api/recruitment/job-openings").then((d) => setOpenings(d.jobOpenings ?? [])).catch(() => {});
    fetchJson<{ candidates?: Candidate[] }>("/api/recruitment/candidates").then((d) => setCandidates(d.candidates ?? [])).catch(() => {});
  }, []);

  async function create() {
    if (!jobOpeningId || !candidateId) { toast.error("Job opening and candidate are required"); return; }
    setSubmitting(true);
    try {
      const application = await fetchJson<{ id: string }>("/api/recruitment/applications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobOpeningId, candidateId }),
      });
      toast.success("Application created");
      router.push(`/recruitment/applications/${application.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create application"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Recruitment / New Application"
      title="New Application"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/recruitment?tab=pipeline")}
      onBack={() => router.push("/recruitment?tab=pipeline")}
      saveDisabled={submitting || !jobOpeningId || !candidateId}
      saveDisabledReason={submitting ? "Creating…" : (!jobOpeningId || !candidateId) ? "Job opening and candidate are required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>Job Opening</Label>
          <Select value={jobOpeningId} onValueChange={setJobOpeningId}>
            <SelectTrigger><SelectValue placeholder="Select job opening" /></SelectTrigger>
            <SelectContent>{openings.map((o) => <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Candidate</Label>
          <Select value={candidateId} onValueChange={setCandidateId}>
            <SelectTrigger><SelectValue placeholder="Select candidate" /></SelectTrigger>
            <SelectContent>{candidates.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
    </ObjectScreen>
  );
}
