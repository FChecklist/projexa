"use client";

// Real-screen conversion (2026-08-30): replaces LabourClient.tsx's old "Add
// Worker" Dialog popup with a real create screen.
//
// R67 D-67: this screen is the one the audit picked out as the MODEL
// (correction C-11: "the good create-form pattern in PROJEXA is
// /labour/new's 'Save (Name, Daily Rate)' disabled-with-reason button"), so
// it is the one that most needs to be built from the shared archetype
// rather than beside it -- otherwise the model and the thing modelled on it
// are two separate implementations that can drift apart.
//
// Two real gains beyond the shared frame. The vendor read's failure was
// `.catch(() => {})`: the Company select silently had no options, and a
// site manager could not tell an empty subcontractor list from a failed
// one. And a refused save was a toast, so the worker's details vanished
// with the notification; the refusal is now in place with every value kept.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { PaneErrorCard } from "@/components/PaneState";
import { createdHref } from "@/components/CreatedReceipt";
import { fetchJson, errorMessage, ApiError } from "@/lib/fetch-json";
import type { CreateField } from "@/lib/create-screen";

type Vendor = { id: string; vendorName: string };

export default function RosterCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsError, setVendorsError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadVendors = useCallback(async () => {
    setVendorsError(null);
    try {
      const d = await fetchJson<{ vendors?: Vendor[] }>("/api/vendors");
      setVendors(d.vendors ?? []);
    } catch (err) {
      setVendors([]);
      setVendorsError({
        status: err instanceof ApiError ? err.status : null,
        message: err instanceof Error && err.message ? err.message : null,
      });
    }
  }, []);

  useEffect(() => {
    void loadVendors();
  }, [loadVendors]);

  const moduleHref = `/labour?projectId=${projectId}`;

  const fields: CreateField[] = [
    { name: "employeeCode", label: "ID", kind: "text", placeholder: "e.g. EMP-001" },
    { name: "name", label: "Name", kind: "text", required: true, placeholder: "e.g. Ramesh Kumar" },
    { name: "trade", label: "Trade", kind: "text", placeholder: "e.g. Mason, Electrician" },
    {
      name: "vendorId",
      label: "Company",
      kind: "select",
      placeholder: vendorsError ? "Could not be loaded" : "Select subcontractor",
      options: vendors.map((v) => ({ value: v.id, label: v.vendorName })),
      help: "Leave blank for a directly employed worker.",
    },
    { name: "dailyRate", label: "Daily Rate", kind: "number", required: true, placeholder: "e.g. 180" },
  ];

  async function createRoster() {
    setSaving(true);
    setError(null);
    try {
      const entry = await fetchJson<{ id: string }>("/api/labour-roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: values.name,
          employeeCode: values.employeeCode || undefined,
          trade: values.trade || undefined,
          vendorId: values.vendorId || undefined,
          dailyRate: Number(values.dailyRate),
        }),
      });
      router.replace(createdHref("/labour", entry.id, values.name));
    } catch (err) {
      setError(errorMessage(err, "The worker could not be added."));
      setSaving(false);
    }
  }

  return (
    <CreateScreen
      module="Labour"
      moduleHref={moduleHref}
      objectLabel="Worker"
      title="Add Worker to Roster"
      fields={fields}
      values={values}
      onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
      // Company is OPTIONAL, so a failed vendor read must not block the save
      // -- it is stated, and the form still works for a direct employee.
      banner={
        vendorsError ? (
          <PaneErrorCard entity="the subcontractor list" error={vendorsError} onRetry={() => void loadVendors()} />
        ) : undefined
      }
      error={error}
      saving={saving}
      onSubmit={createRoster}
    />
  );
}
