"use client";

// R42 seq21: full-page lift of PermitsClient.tsx's existing create dialog
// (Wave 143, unchanged POST /api/permits contract) -- moved out of a modal
// onto its own route so "+ New" in PermitsListClient has somewhere to
// navigate to.
//
// ─── R67 D-67: onto the one create archetype ─────────────────────────────
//
// WHAT THIS SCREEN USED TO DO DIFFERENTLY FROM /labour/new, which R-257 and
// correction C-11 name as the model:
//
//   * the primary said "Create", and the missing fields were counted in a
//     SEPARATE sentence beside it ("2 required fields still needed — permit
//     name, permit PDF"). Two places to look for one fact.
//   * only `name` and the file were required in the UI, while the module's
//     own definition of a permit is name + issue date + end date + PDF --
//     the expiry countdown on the list screen reads endDate, so a permit
//     saved without one shows a blank "Days left" forever.
//   * a failure was a toast.error() and the form stayed as it was, but the
//     REASON faded after four seconds; and a success was a toast plus a
//     push, with no lasting confirmation on the page it landed on.
//
// All three are now the archetype's job. What is NOT changed: the POST
// contract (multipart FormData to /api/permits) and the fields it carries.
//
// R67 D-72: and the submit itself is now the shared one. What this screen's
// own handler could not do: give up on a hung upstream (it called fetch with
// no signal at all), or distinguish a refusal from a request that never left
// the device -- both arrived as the same sentence.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { createdHref } from "@/components/CreatedReceipt";
import { useSubmit } from "@/lib/use-submit";
import type { CreateField } from "@/lib/create-screen";

const FIELDS: CreateField[] = [
  {
    name: "name",
    label: "Permit name",
    kind: "text",
    required: true,
    placeholder: "e.g. Building Permit — Tower A",
  },
  { name: "permitAuthority", label: "Issuing authority", kind: "text", placeholder: "e.g. Dubai Municipality" },
  { name: "permitNumber", label: "Permit number", kind: "text", placeholder: "e.g. BP-2026-0142" },
  { name: "issueDate", label: "Issue date", kind: "date", required: true },
  {
    name: "endDate",
    label: "End date",
    kind: "date",
    required: true,
    help: "The permits list counts the days left from this date.",
  },
  {
    name: "file",
    label: "Permit PDF",
    kind: "file",
    required: true,
    accept: "application/pdf",
    wide: true,
  },
];

export default function PermitCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});

  const submit = useSubmit<{ id?: unknown }>({
    objectLabel: "Permit",
    buildRequest: () => {
      const body = new FormData();
      for (const field of FIELDS) {
        if (field.kind === "file") {
          const file = files[field.name];
          if (file) body.set(field.name, file);
          continue;
        }
        const value = (values[field.name] ?? "").trim();
        if (value) body.set(field.name, value);
      }
      body.set("projectId", projectId);
      return { input: "/api/permits", init: { method: "POST", body } };
    },
    onSuccess: (data) => {
      const id = typeof data?.id === "string" ? data.id : "";
      if (!id) throw new Error("The server did not confirm a saved permit");
      // Display mode with a lasting receipt -- never back to an empty form.
      router.replace(createdHref("/permits", id, values.permitNumber || values.name));
    },
  });

  return (
    <CreateScreen
      module="Permits"
      moduleHref="/permits"
      objectLabel="Permit"
      fields={FIELDS}
      values={values}
      // Every value and the chosen File stay exactly where they were: nothing
      // here is reset on a failure.
      onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
      files={files}
      onFileChange={(name, file) => setFiles((prev) => ({ ...prev, [name]: file }))}
      failure={submit.failure}
      onRetry={submit.submit}
      saving={submit.saving}
      saved={submit.saved}
      onSubmit={submit.submit}
      onCancel={() => router.push("/permits")}
    />
  );
}
