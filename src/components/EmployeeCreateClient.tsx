"use client";

// Real-screen conversion (2026-08-30) -- replaces EmployeesClient.tsx's old
// combined "Create / Update Employee Profile" Dialog's CREATE half with a
// real screen (the update half is now EmployeeObjectClient's own Edit mode).
// Same known pre-existing limitation as that Object Page: upsertEmployeeProfile()
// requires a real VERIDIAN user session, which PROJEXA's shared-API-key
// proxy doesn't have -- Save will surface that honest 400 until the
// identity bridge exists.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchJson } from "@/lib/fetch-json";
import { type Company } from "@/components/company-scope";

type Employee = { id: string; name: string; email: string };

export default function EmployeeCreateClient() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [userId, setUserId] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [employmentType, setEmploymentType] = useState("full_time");
  const [dateOfJoining, setDateOfJoining] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState("active");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [companyId, setCompanyId] = useState("__none__");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchJson<{ employees?: Employee[] }>("/api/employees").then((d) => setEmployees(d.employees ?? [])).catch(() => {});
    fetchJson<{ companies?: Company[] }>("/api/companies").then((d) => setCompanies(d.companies ?? [])).catch(() => {});
  }, []);

  async function createProfile() {
    if (!userId.trim()) {
      toast.error("Select a user");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/employees", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId, employeeCode: employeeCode || undefined, jobTitle: jobTitle || undefined,
          employmentType, dateOfJoining: dateOfJoining || undefined,
          employmentStatus, emergencyContactName: emergencyContactName || undefined, emergencyContactPhone: emergencyContactPhone || undefined,
          companyId: companyId === "__none__" ? undefined : companyId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save employee profile");
      toast.success("Employee profile saved");
      router.push(`/employees/${userId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save employee profile");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Employees / Employee Profile"
      title="Create / Update Employee Profile"
      mode="create"
      hasDraft={false}
      onSave={createProfile}
      onCancel={() => router.push("/employees")}
      onBack={() => router.push("/employees")}
      saveDisabled={submitting || !userId.trim()}
      saveDisabledReason={submitting ? "Saving…" : !userId.trim() ? "Select a user" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5">
          <Label>User</Label>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger><SelectValue placeholder="Select existing user account" /></SelectTrigger>
            <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name} ({e.email})</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5"><Label>Employee Code (optional)</Label><Input value={employeeCode} onChange={(e) => setEmployeeCode(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Designation (optional)</Label><Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. Site Architect" /></div>
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
          <div className="space-y-1.5"><Label>Date of Joining (optional)</Label><Input type="date" value={dateOfJoining} onChange={(e) => setDateOfJoining(e.target.value)} /></div>
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
          <div className="space-y-1.5"><Label>Emergency Contact Name (optional)</Label><Input value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Emergency Contact Phone (optional)</Label><Input value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} /></div>
        </div>
        {companies.length > 0 && (
          <div className="space-y-1.5">
            <Label>Company / Office (optional)</Label>
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
      </div>
    </ObjectScreen>
  );
}
