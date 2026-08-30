"use client";

// Real-screen conversion (2026-08-30): replaces RecruitmentClient.tsx's old
// "New Job Opening" Dialog popup with a real create screen.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type Department = { id: string; name: string };

export default function JobOpeningCreateClient() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [description, setDescription] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [numPositions, setNumPositions] = useState("1");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ departments?: Department[] }>("/api/hr/departments").then((d) => setDepartments(d.departments ?? [])).catch(() => {});
  }, []);

  async function create() {
    if (!title.trim()) { toast.error("Title is required"); return; }
    setSubmitting(true);
    try {
      const opening = await fetchJson<{ id: string }>("/api/recruitment/job-openings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, departmentId: departmentId || undefined, jobDescription: description || undefined,
          employmentType, numPositions: Number(numPositions) || 1,
        }),
      });
      toast.success("Job opening created");
      router.push(`/recruitment/openings/${opening.id}`);
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't create job opening"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Recruitment / New Job Opening"
      title="New Job Opening"
      mode="create"
      hasDraft={false}
      onSave={create}
      onCancel={() => router.push("/recruitment?tab=openings")}
      onBack={() => router.push("/recruitment?tab=openings")}
      saveDisabled={submitting || !title.trim()}
      saveDisabledReason={submitting ? "Creating…" : !title.trim() ? "Title is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Site Engineer" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Department (optional)</Label>
            <Select value={departmentId} onValueChange={setDepartmentId}>
              <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Employment Type</Label>
            <Select value={employmentType} onValueChange={setEmploymentType}>
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
        <div className="space-y-1.5"><Label>Number of Positions</Label><Input type="number" value={numPositions} onChange={(e) => setNumPositions(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Job Description (optional)</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
