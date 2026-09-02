"use client";

// Real-screen conversion (2026-08-30) -- replaces DocumentsClient.tsx's old
// "Upload Document" Dialog popup with a real create screen, same fields.
//
// R67 D-67: onto the shared archetype. This form tracked the chosen file as
// a NAME STRING beside a ref to the input, which meant a refused upload left
// the disabled reason satisfied ("a file is required" was false -- the name
// was still set) while the input itself had been re-rendered empty. Holding
// the File object is what makes "Try again" actually resend the same file.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { createdHref } from "@/components/CreatedReceipt";
import { useSubmit } from "@/lib/use-submit";
import type { CreateField } from "@/lib/create-screen";

const CATEGORIES = ["permit", "drawing", "contract", "certificate", "license", "site_photo", "other"];

const FIELDS: CreateField[] = [
  {
    name: "name",
    label: "Name",
    kind: "text",
    placeholder: "e.g. Structural NOC",
    help: "Leave blank to use the file's own name.",
  },
  {
    name: "category",
    label: "Category",
    kind: "select",
    required: true,
    options: CATEGORIES.map((c) => ({ value: c, label: c.replace(/_/g, " ") })),
  },
  { name: "file", label: "File (PDF, email, etc.)", kind: "file", required: true, wide: true },
];

export default function DocumentUploadClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({ category: "other" });
  const [file, setFile] = useState<File | null>(null);

  const moduleHref = `/documents?projectId=${projectId}`;

  const submit = useSubmit<{ id?: unknown }>({
    objectLabel: "Document",
    // R67 D-72: the old handler opened `if (!file) return;` -- a click that
    // produced no request, no message and no change on screen. Returning null
    // makes the same guard SPEAK: "Nothing was sent — try again".
    buildRequest: () => {
      if (!file) return null;
      const formData = new FormData();
      formData.set("file", file);
      if ((values.name ?? "").trim()) formData.set("name", values.name.trim());
      formData.set("category", values.category || "other");
      formData.set("linkedEntityType", "project");
      formData.set("linkedEntityId", projectId);
      return { input: "/api/documents", init: { method: "POST", body: formData } };
    },
    onSuccess: (data) => {
      const id = typeof data?.id === "string" ? data.id : "";
      if (!id) throw new Error("The server did not confirm a saved document");
      router.replace(createdHref("/documents", id, values.name || file?.name));
    },
  });

  return (
    <CreateScreen
      module="Documents"
      moduleHref={moduleHref}
      objectLabel="Document"
      title="Upload Document"
      fields={FIELDS}
      values={values}
      onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
      files={{ file }}
      onFileChange={(_, chosen) => setFile(chosen)}
      failure={submit.failure}
      onRetry={submit.submit}
      saving={submit.saving}
      saved={submit.saved}
      onSubmit={submit.submit}
    />
  );
}
