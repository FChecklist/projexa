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
import Link from "next/link";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { PaneErrorCard } from "@/components/PaneState";
import { fetchJson, ApiError } from "@/lib/fetch-json";
import { useSubmit } from "@/lib/use-submit";
import { useOrgMoney } from "@/lib/use-org-money";
import type { CreateField } from "@/lib/create-screen";
import { getLastChoice, setLastChoice } from "@/lib/last-choice";

type Material = { id: string; name: string; spec?: string | null; unit?: string | null; isActive: boolean };
type Vendor = { id: string; vendorName: string };

/** D-80: this picker's memory is scoped per user, per project, per picker. */
const MATERIAL_PICKER = "material";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function MaterialReceiptCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [materialsError, setMaterialsError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [materialsLoading, setMaterialsLoading] = useState(true);
  const [rememberedMaterial, setRememberedMaterial] = useState<string | null>(null);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsFailed, setVendorsFailed] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({ receivedDate: todayIso() });
  const orgMoney = useOrgMoney();

  useEffect(() => {
    setRememberedMaterial(getLastChoice(MATERIAL_PICKER, projectId));
  }, [projectId]);

  // R67 D-36: the vendor list. Vendor is OPTIONAL -- site staff genuinely
  // record a delivery before the vendor is set up -- so a failed read degrades
  // this ONE field and never blocks the save. It is not added to extraMissing
  // for the same reason.
  useEffect(() => {
    let live = true;
    fetchJson<{ vendors?: Vendor[] }>("/api/vendors")
      .then((d) => {
        if (live) setVendors(d.vendors ?? []);
      })
      .catch(() => {
        if (live) setVendorsFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const loadMaterials = useCallback(async () => {
    setMaterialsError(null);
    setMaterialsLoading(true);
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
    } finally {
      setMaterialsLoading(false);
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
      // R67 D-80: typing filters the master, a one-material project is
      // preselected, and the last material received on this project is offered
      // back. The spec is the hint, so "OPC" finds "Cement OPC 53" and two
      // cements are told apart without opening anything.
      kind: "combobox",
      required: true,
      loading: materialsLoading,
      placeholder: materialsError ? "Could not be loaded" : "Type a material or spec",
      options: materials.map((m) => ({
        value: m.id,
        label: m.name,
        hint: [m.spec, m.unit].filter(Boolean).join(" · ") || undefined,
      })),
      storedValue: rememberedMaterial,
    },
    { name: "receivedDate", label: "Received Date", kind: "date", required: true },
    { name: "quantity", label: "Quantity", kind: "number", required: true, placeholder: "e.g. 120" },
    {
      name: "unitCost",
      label: "Unit Cost",
      // R67 D-39/G-05: the currency sits inside the box, beside the caret, for
      // as long as the number is being typed -- the same control the master
      // form uses, so a storekeeper does not meet two different money fields
      // one screen apart.
      kind: "money",
      placeholder: "e.g. 28.50",
      help: "Leave blank to use the master's own unit cost.",
    },
    {
      // R67 D-36 (audit R-105). Without a VENDOR a delivery cannot be matched
      // to the invoice that arrives for it a month later. Optional, because
      // site staff record deliveries before the vendor exists in the system --
      // but it now says what it is FOR instead of being silently skippable,
      // and it is not counted in the Save label.
      name: "vendorId",
      label: "Vendor",
      kind: "select",
      placeholder: vendorsFailed ? "Could not be loaded" : "Select vendor",
      options: vendors.map((v) => ({ value: v.id, label: v.vendorName })),
      help: (
        <>
          Needed to match this delivery to an invoice{" "}
          <Link href="/vendors/new" className="underline underline-offset-2">
            Add vendor…
          </Link>
        </>
      ),
    },
    {
      // R67 D-36: and without a REFERENCE -- the delivery note or PO number
      // written on the paper the driver hands over -- there is nothing to
      // match it BY. Kept as its own column rather than folded into `notes`,
      // which is prose nobody can join on.
      name: "reference",
      label: "Reference (delivery note / PO no.)",
      kind: "text",
      placeholder: "e.g. DN-4471",
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
          vendorId: values.vendorId || undefined,
          reference: values.reference || undefined,
        }),
      },
    }),
    // R67 D-36 made a receipt readable and voidable at /materials/receipts/[id],
    // so it is no longer write-once -- but the ledger is still the right place
    // to land: a storekeeper recording a delivery is recording the NEXT one
    // next, not reading back the one just saved.
    onSuccess: () => {
      // Remembered only after the server accepted it.
      setLastChoice(MATERIAL_PICKER, projectId, values.materialId);
      router.replace(moduleHref);
    },
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
      money={{ currency: orgMoney.currency, loaded: orgMoney.loaded, currencySet: orgMoney.currencySet }}
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
