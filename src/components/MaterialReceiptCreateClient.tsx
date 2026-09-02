"use client";

// Real-screen conversion (2026-08-30): replaces MaterialsClient.tsx's old
// "Record Receipt" Dialog popup with a real create screen. No Object Page
// -- a write-once inbound-receipt transaction, same class as Attendance.
//
// R67 D-67: onto the shared archetype, and with the material-master read
// fixed. That read's failure was a toast, so the Material select simply had
// no options and the primary sat disabled naming "Material" as missing --
// the form blaming a storekeeper for a backend failure. It now says what
// happened, offers Retry, and the disabled reason names the real cause.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { PaneErrorCard } from "@/components/PaneState";
import { fetchJson, ApiError } from "@/lib/fetch-json";
import { useSubmit } from "@/lib/use-submit";
import type { CreateField } from "@/lib/create-screen";

type Material = { id: string; name: string; isActive: boolean };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function MaterialReceiptCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialsError, setMaterialsError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({ receivedDate: todayIso() });

  const loadMaterials = useCallback(async () => {
    setMaterialsError(null);
    try {
      const d = await fetchJson<{ materials?: Material[] }>(
        `/api/materials/master?projectId=${encodeURIComponent(projectId)}`
      );
      setMaterials((d.materials ?? []).filter((m) => m.isActive));
    } catch (err) {
      setMaterials([]);
      setMaterialsError({
        status: err instanceof ApiError ? err.status : null,
        message: err instanceof Error && err.message ? err.message : null,
      });
    }
  }, [projectId]);

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials]);

  const moduleHref = `/materials?projectId=${projectId}&tab=receipts`;

  const fields: CreateField[] = [
    {
      name: "materialId",
      label: "Material",
      kind: "select",
      required: true,
      placeholder: materialsError ? "Could not be loaded" : "Select material",
      options: materials.map((m) => ({ value: m.id, label: m.name })),
    },
    { name: "receivedDate", label: "Received Date", kind: "date", required: true },
    { name: "quantity", label: "Quantity", kind: "number", required: true, placeholder: "e.g. 120" },
    {
      name: "unitCost",
      label: "Unit Cost",
      kind: "number",
      placeholder: "e.g. 28.50",
      help: "Leave blank to use the master's own unit cost.",
    },
  ];

  const submit = useSubmit({
    objectLabel: "Receipt",
    buildRequest: () => ({
      input: "/api/materials",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          materialId: values.materialId,
          receivedDate: values.receivedDate,
          quantity: Number(values.quantity),
          unitCost: values.unitCost ? Number(values.unitCost) : undefined,
        }),
      },
    }),
    // A receipt has no object page -- it is a write-once movement -- so the
    // destination is the ledger it was just added to, on its own tab.
    onSuccess: () => router.replace(moduleHref),
  });

  return (
    <CreateScreen
      module="Materials"
      moduleHref={moduleHref}
      objectLabel="Receipt"
      title="Record Inbound Receipt"
      fields={fields}
      values={values}
      onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
      // A material that cannot be chosen is not the user's omission. Naming
      // it as "missing" would be the form blaming them for a failed read.
      extraMissing={materialsError ? ["the material list could not be loaded"] : []}
      banner={
        materialsError ? (
          <PaneErrorCard entity="the material master" error={materialsError} onRetry={() => void loadMaterials()} />
        ) : undefined
      }
      failure={submit.failure}
      onRetry={submit.submit}
      saving={submit.saving}
      saved={submit.saved}
      onSubmit={submit.submit}
    />
  );
}
