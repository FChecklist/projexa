"use client";

// Real-screen conversion (2026-08-30) -- replaces EmployeesClient.tsx's old
// "New Department" Dialog popup with a real create screen. No Object Page:
// hr-department creation has no update/delete backend at all (create-only),
// an honest scope cut rather than a half-working edit form.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ObjectScreen } from "@fchecklist/veridian-ui-kit/screens";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function DepartmentCreateClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function createDepartment() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/hr/departments", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to create department");
      toast.success("Department created");
      router.push("/employees?tab=departments");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create department");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ObjectScreen
      breadcrumb="Employees / New Department"
      title="New Department"
      mode="create"
      hasDraft={false}
      onSave={createDepartment}
      onCancel={() => router.push("/employees?tab=departments")}
      onBack={() => router.push("/employees?tab=departments")}
      saveDisabled={submitting || !name.trim()}
      saveDisabledReason={submitting ? "Creating…" : !name.trim() ? "Name is required" : undefined}
      messages={[]}
    >
      <div className="space-y-3 px-4 py-3">
        <div className="space-y-1.5"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="space-y-1.5"><Label>Description (optional)</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      </div>
    </ObjectScreen>
  );
}
