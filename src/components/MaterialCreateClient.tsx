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
//
// R67 D-37 (audit R-096): the title said "Add Material" while its own
// breadcrumb said "New Material" and the button that opens it says
// "+ New Material" -- three names for one screen. It is "New Material"
// everywhere now. D-37's other two points are answered by the archetype
// itself: the required fields are marked, and the primary counts them
// ("Save (Name, Unit)"). Its "Unit is required - e.g. bag" blur message is
// deliberately NOT carried over -- see the note below, a closed vocabulary
// means there is no wrong unit left to type.
//
// R67 G-05 (R-260), merged in from main rather than reverted: Unit is a
// SELECT over the closed vocabulary in src/lib/material-units.ts, and Unit
// Cost is a money box carrying the org's currency code as a fixed prefix.
// The archetype's earlier free-text Unit field asked the user to solve by
// discipline ("use the same word every time") a defect that is solved
// structurally by not offering the wrong word -- "bag" and "Bag" split the
// materials cost report into two rows for one material, and no total is
// right afterwards.
import { useRouter } from "next/navigation";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { createdHref } from "@/components/CreatedReceipt";
import { useSubmit } from "@/lib/use-submit";
import { MATERIAL_UNITS } from "@/lib/material-units";
import { useOrgMoney } from "@/lib/use-org-money";
import type { CreateField } from "@/lib/create-screen";
import { DraftRestoredNote } from "@/components/DraftRestoredNote";
import { fault, notANumber, useCheckedSubmit, useFormDraft } from "@/lib/guided-form";

const FIELDS: CreateField[] = [
  { name: "name", label: "Name", kind: "text", required: true, placeholder: "e.g. Cement OPC 43" },
  { name: "spec", label: "Spec", kind: "text", placeholder: "e.g. 43-grade OPC" },
  {
    name: "unit",
    label: "Unit",
    kind: "select",
    required: true,
    placeholder: "Pick a unit",
    options: MATERIAL_UNITS,
  },
  { name: "unitCost", label: "Unit Cost", kind: "money", placeholder: "e.g. 28.50" },
  {
    // R67 D-40: the threshold the master flags "▲ Low" against. Optional, and
    // deliberately three-valued: blank means "no threshold", 0 means "flag me
    // the moment it runs out", and those are different instructions.
    name: "reorderLevel",
    label: "Reorder level",
    kind: "number",
    placeholder: "e.g. 50",
    help: "Leave blank for no threshold. 0 flags this material the moment it runs out.",
  },
];

export default function MaterialCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  // G3 guided errors: what was typed survives a "Fix it now" detour, a reload and a sign-in that ran out; cleared after a successful save.
  const draft = useFormDraft(`material-new:${projectId}`);
  const values = draft.values;
  const orgMoney = useOrgMoney();

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
          // D-40: "" and "0" are different instructions, so an empty string
          // must not become 0 and 0 must not become undefined.
          reorderLevel: values.reorderLevel === "" || values.reorderLevel === undefined ? undefined : Number(values.reorderLevel),
        }),
      },
    }),
    onSuccess: (material) => {
      const id = typeof material?.id === "string" ? material.id : "";
      if (!id) throw new Error("The server did not confirm a saved material");
      draft.clear();
      router.replace(createdHref("/materials", id, values.name));
    },
  });

  // The form's own checks run BEFORE anything is sent; each names the exact input so "Fix it now" highlights it.
  const checked = useCheckedSubmit(submit, () => {
    const cost = (values.unitCost ?? "").trim();
    if (cost !== "" && (notANumber(cost) || Number(cost) < 0)) {
      return fault("BAD_UNIT_COST", "unitCost", `The unit cost "${cost}" is not a valid amount. Type digits only, zero or more, for example 28.50.`);
    }
    const reorder = (values.reorderLevel ?? "").trim();
    if (reorder !== "" && (notANumber(reorder) || Number(reorder) < 0)) {
      return fault("REORDER_NEGATIVE", "reorderLevel", `The reorder level "${reorder}" is not valid. Type a number of zero or more, or leave it blank for no threshold.`);
    }
    return null;
  });

  return (
    <CreateScreen
      module="Materials"
      moduleHref={moduleHref}
      objectLabel="Material"
      title="New Material"
      banner={<DraftRestoredNote draft={draft} />}
      fields={FIELDS}
      values={values}
      onChange={(name, value) => {
        checked.clearFault();
        draft.onChange(name, value);
      }}
      money={{ currency: orgMoney.currency, loaded: orgMoney.loaded, currencySet: orgMoney.currencySet }}
      failure={checked.failure}
      onRetry={checked.onRetry}
      saving={submit.saving}
      saved={submit.saved}
      onSubmit={checked.onSubmit}
    />
  );
}
