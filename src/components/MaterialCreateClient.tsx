"use client";

// Real-screen conversion (2026-08-30): replaces MaterialsClient.tsx's old
// "Add Material" Dialog popup with a real create screen.
//
// R67 D-67: onto the shared archetype. Three things change that the
// hand-rolled version could not do. The primary now READS "Save (Name,
// Unit)" instead of saying "Save" with the field names hidden in a tooltip
// nobody hovers. A refused save renders in place, above the buttons, with
// every value still typed in -- it was a toast, so a user who looked away
// saw a form that had simply not saved and no reason why. And a successful
// save lands on the object page with a persistent "Created material Cement
// OPC 43" rather than a four-second notification.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { createdHref } from "@/components/CreatedReceipt";
import { useSubmit } from "@/lib/use-submit";
import type { CreateField } from "@/lib/create-screen";

const FIELDS: CreateField[] = [
  { name: "name", label: "Name", kind: "text", required: true, placeholder: "e.g. Cement OPC 43" },
  { name: "spec", label: "Spec", kind: "text", placeholder: "e.g. 43-grade OPC" },
  {
    name: "unit",
    label: "Unit",
    kind: "text",
    required: true,
    placeholder: "e.g. bag, cum, kg",
    help: "Use the same word every time — 'bag' and 'Bag' are two different units in the cost report.",
  },
  { name: "unitCost", label: "Unit Cost", kind: "number", placeholder: "e.g. 28.50" },
];

export default function MaterialCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});

  const moduleHref = `/materials?projectId=${projectId}`;

  // Never a toast, and never a reset: the values stay on the form behind the
  // refusal so a rejected save costs a correction, not a retype.
  const submit = useSubmit<{ id?: unknown }>({
    objectLabel: "Material",
    buildRequest: () => ({
      input: "/api/materials/master",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: values.name,
          spec: values.spec || undefined,
          unit: values.unit,
          unitCost: values.unitCost ? Number(values.unitCost) : undefined,
        }),
      },
    }),
    onSuccess: (material) => {
      const id = typeof material?.id === "string" ? material.id : "";
      if (!id) throw new Error("The server did not confirm a saved material");
      router.replace(createdHref("/materials", id, values.name));
    },
  });

  return (
    <CreateScreen
      module="Materials"
      moduleHref={moduleHref}
      objectLabel="Material"
      title="Add Material"
      fields={FIELDS}
      values={values}
      onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
      failure={submit.failure}
      onRetry={submit.submit}
      saving={submit.saving}
      saved={submit.saved}
      onSubmit={submit.submit}
    />
  );
}
