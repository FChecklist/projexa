"use client";

// Real-screen conversion (2026-08-30): job openings never had a detail view
// -- getJobOpening() didn't exist before this conversion (only the list,
// which never showed jobDescription at all). Real Object Page on the kit's
// ObjectScreen. No generic Edit -- no updateJobOpening() exists, only the
// real status-change (already inline on the list, kept as a real inline
// action here too). No Delete -- no delete function exists.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import type { StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson, errorMessage } from "@/lib/fetch-json";

type JobOpening = { id: string; title: string; departmentId: string | null; jobDescription: string | null; employmentType: string; numPositions: number; status: string };
type Department = { id: string; name: string };

const STATUS_TONE: Record<string, StatusTone> = { open: "done", on_hold: "waiting", closed: "late", filled: "neutral" };

export default function JobOpeningObjectClient({ openingId }: { openingId: string }) {
  const router = useRouter();
  const [opening, setOpening] = useState<JobOpening | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  async function load() {
    try {
      const [data, deptData] = await Promise.all([
        fetchJson<JobOpening>(`/api/recruitment/job-openings/${openingId}`),
        fetchJson<{ departments?: Department[] }>("/api/hr/departments").catch(() => ({ departments: [] })),
      ]);
      setOpening(data);
      setDepartments(deptData.departments ?? []);
      setLoadError(null);
    } catch (err) {
      setOpening(null);
      setLoadError(errorMessage(err, "Couldn't load this job opening"));
    }
  }
  useEffect(() => { load(); }, [openingId]);

  async function changeStatus(status: string) {
    setStatusBusy(true);
    try {
      const res = await fetch(`/api/recruitment/job-openings/${openingId}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Failed to update status");
      toast.success("Job opening status updated");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update status");
    } finally {
      setStatusBusy(false);
    }
  }

  const departmentName = departments.find((d) => d.id === opening?.departmentId)?.name ?? "—";

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!opening) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Recruitment / Job Opening"
      title={opening.title}
      mode="display"
      hasDraft={false}
      headerStatus={{ tone: STATUS_TONE[opening.status] ?? "neutral", label: opening.status.replace(/_/g, " ") }}
      facets={[
        { label: "Department", value: departmentName },
        { label: "Employment Type", value: opening.employmentType.replace(/_/g, " ") },
        { label: "Positions", value: String(opening.numPositions) },
      ]}
      onBack={() => router.push("/recruitment?tab=openings")}
      messages={[]}
    >
      <div className="flex items-center gap-2 border-b border-ct-border px-4 py-3">
        <Select value="" onValueChange={changeStatus}>
          <SelectTrigger className="h-8 w-40" disabled={statusBusy}><SelectValue placeholder="Change status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="filled">Filled</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {opening.jobDescription && (
        <div className="px-4 py-3">
          <h4 className="mb-1 text-sm font-semibold text-ct-navy">Job Description</h4>
          <p className="whitespace-pre-wrap text-sm text-ct-muted">{opening.jobDescription}</p>
        </div>
      )}
    </ObjectScreen>
  );
}
