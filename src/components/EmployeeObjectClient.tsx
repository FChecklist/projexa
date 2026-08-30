"use client";

// Real-screen conversion (2026-08-30): the Employees directory never had a
// detail/edit route -- "View" opened a read-only Dialog, and the only way
// to edit a profile was to close that dialog and reopen a separate "Create
// / Update" one pre-filled by client-side state. Real Object Page on the
// kit's ObjectScreen, using the already-existing (but previously unused by
// this client) GET/PATCH /api/employees/[id].
//
// Known, pre-existing limitation (not introduced by this conversion):
// upsertEmployeeProfile() -- the ONLY write path for a profile, create or
// update -- requires a real VERIDIAN user session (compliance-tracker's
// v1/projexa/employees/[id] PATCH explicitly refuses an API-key-only
// caller). PROJEXA's shared-Bearer-key proxy has no per-user identity
// bridge to VERIDIAN (see use-org-role.ts's own header comment), so Save
// here will surface that same honest 400 until that bridge exists -- same
// class of gap as Schedule's Log Time and Journal Entry/Change Order submit.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useOrgRole } from "@/hooks/use-org-role";
import { formatDate } from "@/lib/format-date";
import { fetchJson, errorMessage } from "@/lib/fetch-json";
import { type Company } from "@/components/company-scope";

type Employee = {
  id: string; name: string; email: string; role: string; departmentId: string | null; reportingToId: string | null;
  profile: {
    employeeCode: string | null; jobTitle: string | null; employmentType: string | null; dateOfJoining: string | null;
    employmentStatus: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null; companyId: string | null;
  } | null;
};
type Department = { id: string; name: string };

const EMPLOYMENT_STATUS_VARIANT: Record<string, "needs-you" | "running" | "waiting" | "done" | "late" | "neutral"> = {
  active: "done", on_leave: "waiting", terminated: "late", resigned: "neutral",
};

export default function EmployeeObjectClient({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const { isHrAdmin } = useOrgRole();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<"display" | "edit">("display");
  const [saving, setSaving] = useState(false);

  const [employeeCode, setEmployeeCode] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("active");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [companyId, setCompanyId] = useState("__none__");

  function seedForm(e: Employee) {
    setEmployeeCode(e.profile?.employeeCode ?? "");
    setJobTitle(e.profile?.jobTitle ?? "");
    setEmploymentType(e.profile?.employmentType ?? "full_time");
    setDateOfJoining(e.profile?.dateOfJoining ? e.profile.dateOfJoining.slice(0, 10) : "");
    setEmploymentStatus(e.profile?.employmentStatus ?? "active");
    setEmergencyContactName(e.profile?.emergencyContactName ?? "");
    setEmergencyContactPhone(e.profile?.emergencyContactPhone ?? "");
    setCompanyId(e.profile?.companyId ?? "__none__");
  }

  async function load() {
    try {
      const [data, deptData, empData, coData] = await Promise.all([
        fetchJson<Employee>(`/api/employees/${employeeId}`),
        fetchJson<{ departments?: Department[] }>("/api/hr/departments").catch(() => ({ departments: [] })),
        fetchJson<{ employees?: Employee[] }>("/api/employees").catch(() => ({ employees: [] })),
        fetchJson<{ companies?: Company[] }>("/api/companies").catch(() => ({ companies: [] })),
      ]);
      setEmployee(data);
      seedForm(data);
      setDepartments(deptData.departments ?? []);
      setEmployees(empData.employees ?? []);
      setCompanies(coData.companies ?? []);
      setLoadError(null);
    } catch (err) {
      setEmployee(null);
      setLoadError(errorMessage(err, "Couldn't load this employee"));
    }
  }

  useEffect(() => { load(); }, [employeeId]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeCode: employeeCode || undefined, jobTitle: jobTitle || undefined, employmentType,
          dateOfJoining: dateOfJoining || undefined, employmentStatus,
          emergencyContactName: emergencyContactName || undefined, emergencyContactPhone: emergencyContactPhone || undefined,
          companyId: companyId === "__none__" ? undefined : companyId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save employee profile");
      toast.success("Employee profile saved");
      setMode("display");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save employee profile");
    } finally {
      setSaving(false);
    }
  }

  const departmentName = (id: string | null) => departments.find((d) => d.id === id)?.name ?? "—";
  const employeeName = (id: string | null) => employees.find((e) => e.id === id)?.name ?? "—";

  if (loadError) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-[13px] text-px-error">{loadError}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Retry</Button>
      </div>
    );
  }
  if (!employee) return <p className="p-6 text-[13px] text-ct-muted">Loading…</p>;

  return (
    <ObjectScreen
      breadcrumb="Employees / Employee"
      title={employee.name}
      subtitle={employee.email}
      mode={mode}
      hasDraft={false}
      headerStatus={employee.profile?.employmentStatus ? { tone: EMPLOYMENT_STATUS_VARIANT[employee.profile.employmentStatus] ?? "neutral", label: employee.profile.employmentStatus.replace(/_/g, " ") } : undefined}
      facets={[
        { label: "Department", value: departmentName(employee.departmentId) },
        { label: "Reports To", value: employeeName(employee.reportingToId) },
      ]}
      onEdit={isHrAdmin && mode === "display" ? () => { seedForm(employee); setMode("edit"); } : undefined}
      onSave={mode === "edit" ? handleSave : undefined}
      onCancel={mode === "edit" ? () => { seedForm(employee); setMode("display"); } : undefined}
      onBack={() => router.push("/employees")}
      saveDisabled={saving}
      saveDisabledReason={saving ? "Saving…" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        {mode === "edit" ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label>Employee Code</Label><Input value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Designation</Label><Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Site Architect" /></div>
            </div>
            <div className="grid grid-cols-2 gap-2">
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
              <div className="space-y-1.5"><Label>Date of Joining</Label><Input type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>Employment Status</Label>
              <Select value={employmentStatus} onValueChange={setEmploymentStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="on_leave">On Leave</SelectItem>
                  <SelectItem value="terminated">Terminated</SelectItem>
                  <SelectItem value="resigned">Resigned</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5"><Label>Emergency Contact Name</Label><Input value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Emergency Contact Phone</Label><Input value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} /></div>
            </div>
            {companies.length > 0 && (
              <div className="space-y-1.5">
                <Label>Company / Office</Label>
                <Select value={companyId} onValueChange={setCompanyId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unattributed</SelectItem>
                    {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.abbr ? `${c.abbr} — ` : ""}{c.companyName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <p className="text-xs text-ct-muted">Department and reporting manager are managed from user administration, not here.</p>
          </>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 text-[13px]">
              <div><dt className="text-ct-muted">Employee Code</dt><dd className="text-ct-navy">{employee.profile?.employeeCode ?? "—"}</dd></div>
              <div><dt className="text-ct-muted">Designation</dt><dd className="text-ct-navy">{employee.profile?.jobTitle ?? "—"}</dd></div>
              <div><dt className="text-ct-muted">Employment Type</dt><dd className="text-ct-navy">{employee.profile?.employmentType?.replace(/_/g, " ") ?? "—"}</dd></div>
              <div><dt className="text-ct-muted">Joined</dt><dd className="text-ct-navy">{employee.profile?.dateOfJoining ? formatDate(employee.profile.dateOfJoining) : "—"}</dd></div>
            </dl>
            <div className="border-t border-ct-border pt-3">
              <p className="mb-1 text-xs font-semibold text-ct-muted">Emergency Contact</p>
              <dl className="grid grid-cols-2 gap-3 text-[13px]">
                <div><dt className="text-ct-muted">Name</dt><dd className="text-ct-navy">{employee.profile?.emergencyContactName ?? "—"}</dd></div>
                <div><dt className="text-ct-muted">Phone</dt><dd className="text-ct-navy">{employee.profile?.emergencyContactPhone ?? "—"}</dd></div>
              </dl>
            </div>
          </>
        )}
      </div>
    </ObjectScreen>
  );
}
