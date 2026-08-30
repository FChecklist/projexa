"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Loader2, Plus } from "lucide-react";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import DataLoadError from "@/components/DataLoadError";

// Real-screen conversion (2026-08-30): the "New Job Opening"/"Add
// Candidate"/"New Application" Dialog popups are gone -- each routes to a
// real create screen. The old 3-level Dialog nest (Application detail ->
// nested "Schedule Interview" Dialog -> separate "Interview Feedback"
// Dialog) is now one real Object Page (ApplicationObjectClient.tsx) --
// getApplication()/getJobOpening() didn't exist before this conversion.
// Job Opening rows also route to a real Object Page (job description was
// never shown anywhere before). Candidates stay a flat list (no Object
// Page -- simple master data, no get/update function exists). Job
// Opening's inline status-change Select was already real and stays on the
// list, unchanged.
type JobOpening = { id: string; title: string; departmentId: string | null; jobDescription: string | null; employmentType: string; numPositions: number; status: string };
type Candidate = { id: string; name: string; email: string; phone: string | null; source: string | null };
type Application = { id: string; jobOpeningId: string; candidateId: string; stage: string };
type Department = { id: string; name: string };

const STAGE_ORDER = ["applied", "screening", "interview", "offer", "hired", "rejected"];
const STAGE_LABEL: Record<string, string> = {
  applied: "Applied", screening: "Screening", interview: "Interview", offer: "Offer", hired: "Hired", rejected: "Rejected",
};
const JOB_STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  open: "default", on_hold: "secondary", closed: "outline", filled: "outline",
};
const VALID_TABS = new Set(["openings", "candidates", "pipeline"]);

export default function RecruitmentClient({ initialTab }: { initialTab?: string }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(initialTab && VALID_TABS.has(initialTab) ? initialTab : "openings");
  const [openings, setOpenings] = useState<JobOpening[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [jobStatusFilter, setJobStatusFilter] = useState("all");
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [openData, candData, appData, deptData] = await Promise.all([
        fetchJson<{ jobOpenings?: JobOpening[] }>("/api/recruitment/job-openings"),
        fetchJson<{ candidates?: Candidate[] }>("/api/recruitment/candidates"),
        fetchJson<{ applications?: Application[] }>("/api/recruitment/applications"),
        fetchJson<{ departments?: Department[] }>("/api/hr/departments"),
      ]);
      setOpenings(openData.jobOpenings ?? []);
      setCandidates(candData.candidates ?? []);
      setApplications(appData.applications ?? []);
      setDepartments(deptData.departments ?? []);
    } catch (err) {
      const msg = errorMessage(err, "Couldn't load recruitment data");
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

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

  const candidateName = (id: string) => candidates.find((c) => c.id === id)?.name ?? "—";
  const jobTitle = (id: string) => openings.find((o) => o.id === id)?.title ?? "—";
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
        <div className="flex items-center gap-2">
          <Select
            value=""
            onValueChange={(v) => updateOpeningStatus(row.original.id, v)}
          >
            <SelectTrigger className="h-8 w-32" disabled={statusBusyId === row.original.id} onClick={(e) => e.stopPropagation()}><SelectValue placeholder="Change status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="on_hold">On Hold</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="filled">Filled</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); router.push(`/recruitment/openings/${row.original.id}`); }}>View</Button>
        </div>
      ),
    },
  ];

  const candidateColumns: ColumnDef<Candidate>[] = [
    { accessorKey: "name", header: "Name", cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { accessorKey: "email", header: "Email", cell: ({ row }) => <span className="text-px-muted">{row.original.email}</span> },
    { id: "phone", header: "Phone", cell: ({ row }) => row.original.phone ?? "—" },
    { id: "source", header: "Source", cell: ({ row }) => row.original.source ?? "—" },
  ];

  function goToTab(tab: string) {
    setActiveTab(tab);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tab);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  if (loading) {
    return <div className="grid h-64 place-items-center"><Loader2 className="size-6 animate-spin text-px-muted" /></div>;
  }

  return (
    <Tabs value={activeTab} onValueChange={goToTab} className="space-y-4">
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
          {/* Real screen navigation (2026-08-30) -- replaces the old "New
              Job Opening" Dialog popup with a real create route. */}
          <Button onClick={() => router.push("/recruitment/openings/new")}><Plus className="size-4" /> New Job Opening</Button>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-4">
            {loadError ? <DataLoadError messages={[loadError]} onRetry={load} /> : filteredOpenings.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No job openings yet.</p> : <DataTable columns={openingColumns} data={filteredOpenings} searchKey="title" searchPlaceholder="Search job openings…" />}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="candidates" className="space-y-4">
        <div className="flex justify-end">
          {/* Real screen navigation (2026-08-30) -- replaces the old "Add
              Candidate" Dialog popup with a real create route. */}
          <Button onClick={() => router.push("/recruitment/candidates/new")}><Plus className="size-4" /> Add Candidate</Button>
        </div>
        <Card className="shadow-card">
          <CardContent className="p-4">
            {candidates.length === 0 ? <p className="py-10 text-center text-sm text-px-muted">No candidates yet.</p> : <DataTable columns={candidateColumns} data={candidates} searchKey="name" searchPlaceholder="Search candidates…" />}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="pipeline" className="space-y-4">
        <div className="flex justify-end">
          {/* Real screen navigation (2026-08-30) -- replaces the old "New
              Application" Dialog popup with a real create route. */}
          <Button onClick={() => router.push("/recruitment/applications/new")}><Plus className="size-4" /> New Application</Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {STAGE_ORDER.map((stage) => (
            <div key={stage} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-px-muted">{STAGE_LABEL[stage]}</h4>
                <Badge variant="outline" className="text-[10px]">{applications.filter((a) => a.stage === stage).length}</Badge>
              </div>
              <div className="space-y-2">
                {/* Real screen navigation (2026-08-30) -- cards open the
                    real Object Page (was a Dialog nesting 2 more Dialogs
                    inside it). */}
                {applications.filter((a) => a.stage === stage).map((a) => (
                  <Card key={a.id} className="shadow-card cursor-pointer hover:shadow-md" onClick={() => router.push(`/recruitment/applications/${a.id}`)}>
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
    </Tabs>
  );
}
