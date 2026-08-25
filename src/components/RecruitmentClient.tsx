"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Loader2, Plus, UserCheck } from "lucide-react";
import { formatDateTime } from "@/lib/format-date";

type JobOpening = { id: string; title: string; departmentId: string | null; jobDescription: string | null; employmentType: string; numPositions: number; status: string };
type Candidate = { id: string; name: string; email: string; phone: string | null; source: string | null };
type Application = { id: string; jobOpeningId: string; candidateId: string; stage: string; rejectedReason: string | null; offerAmount: string | null; hiredEmployeeProfileId: string | null };
type InterviewFeedback = { id: string; applicationId: string; interviewerId: string; roundName: string; scheduledAt: string; rating: number | null; recommendation: string | null; feedback: string | null; completedAt: string | null };
// `id` here is the user account id (interviewer picker); `profile.id` is the
// separate employeeProfiles.id that linkHiredEmployee actually needs -- the
// two are NOT the same id, hr-service.ts keeps them as distinct rows.
type Employee = { id: string; name: string; profile: { id: string; employeeCode: string | null } | null };
type Department = { id: string; name: string };

const STAGE_ORDER = ["applied", "screening", "interview", "offer", "hired", "rejected"];
const VALID_TRANSITIONS: Record<string, string[]> = {
  applied: ["screening", "rejected"],
  screening: ["interview", "rejected"],
  interview: ["offer", "rejected"],
  offer: ["hired", "rejected"],
  hired: [], rejected: [],
};
const STAGE_LABEL: Record<string, string> = {
  applied: "Applied", screening: "Screening", interview: "Interview", offer: "Offer", hired: "Hired", rejected: "Rejected",
};
const JOB_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "default", on_hold: "secondary", closed: "outline", filled: "outline",
};

export default function RecruitmentClient() {
  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobStatusFilter, setJobStatusFilter] = useState("all");

  const [openingOpen, setOpeningOpen] = useState(false);
  const [openingTitle, setOpeningTitle] = useState("");
  const [openingDept, setOpeningDept] = useState("");
  const [openingDesc, setOpeningDesc] = useState("");
  const [openingType, setOpeningType] = useState("full_time");
  const [openingPositions, setOpeningPositions] = useState("1");
  const [openingSubmitting, setOpeningSubmitting] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const [candOpen, setCandOpen] = useState(false);
  const [candName, setCandName] = useState("");
  const [candEmail, setCandEmail] = useState("");
  const [candPhone, setCandPhone] = useState("");
  const [candSource, setCandSource] = useState("");
  const [candSubmitting, setCandSubmitting] = useState(false);

  const [appOpen, setAppOpen] = useState(false);
  const [appJobOpeningId, setAppJobOpeningId] = useState("");
  const [appCandidateId, setAppCandidateId] = useState("");
  const [appSubmitting, setAppSubmitting] = useState(false);

  const [detailApp, setDetailApp] = useState<Application | null>(null);
  const [detailInterviews, setDetailInterviews] = useState<InterviewFeedback[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [stageBusy, setStageBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const [interviewOpen, setInterviewOpen] = useState(false);
  const [ivInterviewerId, setIvInterviewerId] = useState("");
  const [ivRoundName, setIvRoundName] = useState("");
  const [ivScheduledAt, setIvScheduledAt] = useState("");
  const [ivSubmitting, setIvSubmitting] = useState(false);

  const [feedbackTarget, setFeedbackTarget] = useState<InterviewFeedback | null>(null);
  const [fbRating, setFbRating] = useState("5");
  const [fbRecommendation, setFbRecommendation] = useState("yes");
  const [fbNotes, setFbNotes] = useState("");
  const [fbSubmitting, setFbSubmitting] = useState(false);

  const [hireEmployeeProfileId, setHireEmployeeProfileId] = useState("");
  const [hireSubmitting, setHireSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [openRes, candRes, appRes, empRes, deptRes] = await Promise.all([
        fetch("/api/recruitment/job-openings"),
        fetch("/api/recruitment/candidates"),
        fetch("/api/recruitment/applications"),
        fetch("/api/employees"),
        fetch("/api/hr/departments"),
      ]);
      setOpenings((await openRes.json()).jobOpenings ?? []);
      setCandidates((await candRes.json()).candidates ?? []);
      setApplications((await appRes.json()).applications ?? []);
      setEmployees((await empRes.json()).employees ?? []);
      setDepartments((await deptRes.json()).departments ?? []);
    } catch {
      toast.error("Couldn't load recruitment data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createOpening() {
    if (!openingTitle.trim()) return;
    setOpeningSubmitting(true);
    try {
      const res = await fetch("/api/recruitment/job-openings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: openingTitle, departmentId: openingDept || undefined, jobDescription: openingDesc || undefined,
          employmentType: openingType, numPositions: Number(openingPositions) || 1,
        }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success("Job opening created");
      setOpeningTitle(""); setOpeningDept(""); setOpeningDesc(""); setOpeningPositions("1"); setOpeningOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create job opening");
    } finally {
      setOpeningSubmitting(false);
    }
  }

  async function updateOpeningStatus(id: string, status: string) {
    setStatusBusyId(id);
    try {
      const res = await fetch(`/api/recruitment/job-openings/${id}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success("Job opening status updated");
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't update status");
    } finally {
      setStatusBusyId(null);
    }
  }

  async function createCandidate() {
    if (!candName.trim() || !candEmail.trim()) return;
    setCandSubmitting(true);
    try {
      const res = await fetch("/api/recruitment/candidates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: candName, email: candEmail, phone: candPhone || undefined, source: candSource || undefined }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success("Candidate added");
      setCandName(""); setCandEmail(""); setCandPhone(""); setCandSource(""); setCandOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't add candidate");
    } finally {
      setCandSubmitting(false);
    }
  }

  async function createApplication() {
    if (!appJobOpeningId || !appCandidateId) return;
    setAppSubmitting(true);
    try {
      const res = await fetch("/api/recruitment/applications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobOpeningId: appJobOpeningId, candidateId: appCandidateId }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success("Application created");
      setAppJobOpeningId(""); setAppCandidateId(""); setAppOpen(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't create application");
    } finally {
      setAppSubmitting(false);
    }
  }

  async function openDetail(app: Application) {
    setDetailApp(app);
    setRejectReason("");
    setHireEmployeeProfileId("");
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/recruitment/applications/${app.id}/interviews`);
      const data = await res.json();
      setDetailInterviews(data.interviews ?? []);
    } catch {
      toast.error("Couldn't load interview history");
    } finally {
      setDetailLoading(false);
    }
  }

  async function moveStage(toStage: string) {
    if (!detailApp) return;
    setStageBusy(true);
    try {
      const res = await fetch(`/api/recruitment/applications/${detailApp.id}/stage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: toStage, rejectedReason: toStage === "rejected" ? (rejectReason || undefined) : undefined }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success(`Moved to ${STAGE_LABEL[toStage]}`);
      const updated = await res.json();
      setDetailApp(updated);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't move application stage");
    } finally {
      setStageBusy(false);
    }
  }

  async function scheduleInterview() {
    if (!detailApp || !ivInterviewerId || !ivRoundName.trim() || !ivScheduledAt) return;
    setIvSubmitting(true);
    try {
      const res = await fetch(`/api/recruitment/applications/${detailApp.id}/interviews`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewerId: ivInterviewerId, roundName: ivRoundName, scheduledAt: ivScheduledAt }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success("Interview scheduled");
      setIvInterviewerId(""); setIvRoundName(""); setIvScheduledAt(""); setInterviewOpen(false);
      openDetail(detailApp);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't schedule interview");
    } finally {
      setIvSubmitting(false);
    }
  }

  async function submitFeedback() {
    if (!feedbackTarget) return;
    setFbSubmitting(true);
    try {
      const res = await fetch(`/api/recruitment/interviews/${feedbackTarget.id}/feedback`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: Number(fbRating), recommendation: fbRecommendation, feedback: fbNotes || undefined }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success("Feedback submitted");
      setFeedbackTarget(null); setFbNotes("");
      if (detailApp) openDetail(detailApp);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't submit feedback");
    } finally {
      setFbSubmitting(false);
    }
  }

  async function linkHire() {
    if (!detailApp || !hireEmployeeProfileId) return;
    setHireSubmitting(true);
    try {
      const res = await fetch(`/api/recruitment/applications/${detailApp.id}/hire`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeProfileId: hireEmployeeProfileId }),
      });
      if (!res.ok) { const err = await res.json().catch(() => null); throw new Error(err?.error); }
      toast.success("Linked to employee record");
      const updated = await res.json();
      setDetailApp(updated);
      load();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't link hired employee");
    } finally {
      setHireSubmitting(false);
    }
  }

  const jobTitle = (id: string) => openings.find((o) => o.id === id)?.title ?? "—";
  const candidateName = (id: string) => candidates.find((c) => c.id === id)?.name ?? "—";
  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";

  const filteredOpenings = useMemo(
    () => (jobStatusFilter === "all" ? openings : openings.filter((o) => o.status === jobStatusFilter)),
    [openings, jobStatusFilter]
  );

  const openingColumns: ColumnDef<JobOpening>[] = [
    { accessorKey: "title", header: "Title", cell: ({ row }) => <span className="font-medium">{row.original.title}</span> },
    { id: "department", header: "Department", cell: ({ row }) => departmentName(row.original.departmentId) },
    { id: "type", header: "Employment Type", cell: ({ row }) => row.original.employmentType.replace(/_/g, " ") },
    { id: "positions", header: "Positions", cell: ({ row }) => row.original.numPositions },
    { id: "status", header: "Status", cell: ({ row }) => <Badge variant={JOB_STATUS_VARIANT[row.original.status] ?? "outline"}>{row.original.status.replace(/_/g, " ")}</Badge> },
    {
      id: "actions", header: "", cell: ({ row }) => (
        <Select
          value=""
          onValueChange={(v) => updateOpeningStatus(row.original.id, v)}
        >
          <SelectTrigger className="h-8 w-32" disabled={statusBusyId === row.original.id}><SelectValue placeholder="Change status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="filled">Filled</SelectItem>
          </SelectContent>
        </Select>
      ),
    },
  ];

  const candidateColumns: ColumnDef<Candidate>[] = [
    { accessorKey: "name", header: "Name", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { accessorKey: "email", header: "Email", cell: ({ row }) => <span className="text-px-muted">{row.original.email}</span> },
    { id: "phone", header: "Phone", cell: ({ row }) => row.original.phone ?? "—" },
    { id: "source", header: "Source", cell: ({ row }) => row.original.source ?? "—" },
  ];

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;
  }

  return (
    <Tabs defaultValue="openings" className="space-y-4">
      <TabsList>
        <TabsTrigger value="openings">Job Openings</TabsTrigger>
        <TabsTrigger value="candidates">Candidates</TabsTrigger>
        <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
      </TabsList>

      <TabsContent value="openings" className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="w-44">
            <Select value={jobStatusFilter} onValueChange={setJobStatusFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="on_hold">On Hold</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="filled">Filled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Dialog open={openingOpen} onOpenChange={setOpeningOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4" /> New Job Opening</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Job Opening</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5"><Label>Title</Label><Input value={openingTitle} onChange={(e) => setOpeningTitle(e.target.value)} placeholder="e.g. Site Engineer" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>Department (optional)</Label>
                    <Select value={openingDept} onValueChange={setOpeningDept}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Employment Type</Label>
                    <Select value={openingType} onValueChange={setOpeningType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full_time">Full Time</SelectItem>
                        <SelectItem value="part_time">Part Time</SelectItem>
                        <SelectItem value="contract">Contract</SelectItem>
                        <SelectItem value="intern">Intern</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5"><Label>Number of Positions</Label><Input type="number" value={openingPositions} onChange={(e) => setOpeningPositions(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Job Description (optional)</Label><Input value={openingDesc} onChange={(e) => setOpeningDesc(e.target.value)} /></div>
              </div>
              <DialogFooter><Button onClick={createOpening} disabled={openingSubmitting}>{openingSubmitting ? "Creating…" : "Create"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-4">
            {filteredOpenings.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No job openings yet.</p> : <DataTable columns={openingColumns} data={filteredOpenings} searchKey="title" searchPlaceholder="Search job openings…" />}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="candidates" className="space-y-4">
        <div className="flex justify-end">
          <Dialog open={candOpen} onOpenChange={setCandOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4" /> Add Candidate</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Candidate</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5"><Label>Name</Label><Input value={candName} onChange={(e) => setCandName(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={candEmail} onChange={(e) => setCandEmail(e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5"><Label>Phone (optional)</Label><Input value={candPhone} onChange={(e) => setCandPhone(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Source (optional)</Label><Input value={candSource} onChange={(e) => setCandSource(e.target.value)} placeholder="e.g. LinkedIn" /></div>
                </div>
              </div>
              <DialogFooter><Button onClick={createCandidate} disabled={candSubmitting}>{candSubmitting ? "Adding…" : "Add"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-4">
            {candidates.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No candidates yet.</p> : <DataTable columns={candidateColumns} data={candidates} searchKey="name" searchPlaceholder="Search candidates…" />}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="pipeline" className="space-y-4">
        <div className="flex justify-end">
          <Dialog open={appOpen} onOpenChange={setAppOpen}>
            <DialogTrigger asChild><Button><Plus className="size-4" /> New Application</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>New Application</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Job Opening</Label>
                  <Select value={appJobOpeningId} onValueChange={setAppJobOpeningId}>
                    <SelectTrigger><SelectValue placeholder="Select job opening" /></SelectTrigger>
                    <SelectContent>{openings.map((o) => <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Candidate</Label>
                  <Select value={appCandidateId} onValueChange={setAppCandidateId}>
                    <SelectTrigger><SelectValue placeholder="Select candidate" /></SelectTrigger>
                    <SelectContent>{candidates.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter><Button onClick={createApplication} disabled={appSubmitting}>{appSubmitting ? "Creating…" : "Create"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {STAGE_ORDER.map((stage) => (
            <div key={stage} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-px-muted">{STAGE_LABEL[stage]}</h4>
                <Badge variant="outline" className="text-[10px]">{applications.filter((a) => a.stage === stage).length}</Badge>
              </div>
              <div className="space-y-2">
                {applications.filter((a) => a.stage === stage).map((a) => (
                  <Card key={a.id} className="shadow-card cursor-pointer hover:shadow-md" onClick={() => openDetail(a)}>
                    <CardContent className="p-3">
                      <p className="text-sm font-medium">{candidateName(a.candidateId)}</p>
                      <p className="text-xs text-px-muted">{jobTitle(a.jobOpeningId)}</p>
                    </CardContent>
                  </Card>
                ))}
                {applications.filter((a) => a.stage === stage).length === 0 && <p className="px-1 text-xs text-px-muted">—</p>}
              </div>
            </div>
          ))}
        </div>
      </TabsContent>

      {/* Application detail dialog */}
      <Dialog open={!!detailApp} onOpenChange={(open) => { if (!open) setDetailApp(null); }}>
        <DialogContent className="max-w-lg">
          {detailApp && (
            <>
              <DialogHeader>
                <DialogTitle>{candidateName(detailApp.candidateId)} — {jobTitle(detailApp.jobOpeningId)}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Badge variant={detailApp.stage === "rejected" ? "destructive" : "default"}>{STAGE_LABEL[detailApp.stage]}</Badge>
                  {detailApp.offerAmount && <span className="text-sm text-px-muted">Offer: {detailApp.offerAmount}</span>}
                </div>

                {(VALID_TRANSITIONS[detailApp.stage] ?? []).length > 0 && (
                  <div className="space-y-2 border-t border-px-border pt-3">
                    <Label>Move Stage</Label>
                    <div className="flex flex-wrap gap-2">
                      {(VALID_TRANSITIONS[detailApp.stage] ?? []).map((next) => (
                        <Button key={next} size="sm" variant={next === "rejected" ? "outline" : "default"} disabled={stageBusy} onClick={() => moveStage(next)}>
                          {STAGE_LABEL[next]}
                        </Button>
                      ))}
                    </div>
                    {(VALID_TRANSITIONS[detailApp.stage] ?? []).includes("rejected") && (
                      <Input placeholder="Rejection reason (optional)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                    )}
                  </div>
                )}

                <div className="space-y-2 border-t border-px-border pt-3">
                  <div className="flex items-center justify-between">
                    <Label>Interviews</Label>
                    <Dialog open={interviewOpen} onOpenChange={setInterviewOpen}>
                      <DialogTrigger asChild><Button size="sm" variant="outline"><Plus className="size-3" /> Schedule</Button></DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Schedule Interview</DialogTitle></DialogHeader>
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label>Interviewer</Label>
                            <Select value={ivInterviewerId} onValueChange={setIvInterviewerId}>
                              <SelectTrigger><SelectValue placeholder="Select interviewer" /></SelectTrigger>
                              <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1.5"><Label>Round Name</Label><Input value={ivRoundName} onChange={(e) => setIvRoundName(e.target.value)} placeholder="e.g. Technical Round 1" /></div>
                          <div className="space-y-1.5"><Label>Scheduled At</Label><Input type="datetime-local" value={ivScheduledAt} onChange={(e) => setIvScheduledAt(e.target.value)} /></div>
                        </div>
                        <DialogFooter><Button onClick={scheduleInterview} disabled={ivSubmitting}>{ivSubmitting ? "Scheduling…" : "Schedule"}</Button></DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                  {detailLoading ? (
                    <div className="grid h-16 place-items-center"><Loader2 className="size-4 animate-spin text-px-muted" /></div>
                  ) : detailInterviews.length === 0 ? (
                    <p className="text-xs text-px-muted">No interviews scheduled yet.</p>
                  ) : (
                    <Table>
                      <TableBody>
                        {detailInterviews.map((iv) => (
                          <TableRow key={iv.id}>
                            <TableCell className="text-sm">{iv.roundName}</TableCell>
                            <TableCell className="text-xs text-px-muted">{formatDateTime(iv.scheduledAt)}</TableCell>
                            <TableCell>
                              {iv.completedAt ? (
                                <Badge variant="outline">{iv.recommendation}</Badge>
                              ) : (
                                <Button size="sm" variant="ghost" onClick={() => { setFeedbackTarget(iv); setFbRating("5"); setFbRecommendation("yes"); setFbNotes(""); }}>Add Feedback</Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                {detailApp.stage === "hired" && !detailApp.hiredEmployeeProfileId && (
                  <div className="space-y-2 border-t border-px-border pt-3">
                    <Label className="flex items-center gap-1"><UserCheck className="size-4" /> Link to Employee Record</Label>
                    <p className="text-xs text-px-muted">Requires an existing employee profile (create one on the Employees page first — the person must already have a user account and a saved employee profile).</p>
                    <div className="flex gap-2">
                      <Select value={hireEmployeeProfileId} onValueChange={setHireEmployeeProfileId}>
                        <SelectTrigger className="flex-1"><SelectValue placeholder="Select employee profile" /></SelectTrigger>
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
                {detailApp.hiredEmployeeProfileId && (
                  <p className="text-xs text-px-success">Linked to employee profile {detailApp.hiredEmployeeProfileId}.</p>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Interview feedback dialog */}
      <Dialog open={!!feedbackTarget} onOpenChange={(open) => { if (!open) setFeedbackTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Interview Feedback — {feedbackTarget?.roundName}</DialogTitle></DialogHeader>
          <div className="space-y-3">
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
            <div className="space-y-1.5"><Label>Notes (optional)</Label><Input value={fbNotes} onChange={(e) => setFbNotes(e.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={submitFeedback} disabled={fbSubmitting}>{fbSubmitting ? "Submitting…" : "Submit"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Tabs>
  );
}
