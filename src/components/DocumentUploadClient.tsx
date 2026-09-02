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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const moduleHref = `/documents?projectId=${projectId}`;

  async function handleUpload() {
    if (!file) return;
    setSaving(true);
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    if ((values.name ?? "").trim()) formData.set("name", values.name.trim());
    formData.set("category", values.category || "other");
    formData.set("linkedEntityType", "project");
    formData.set("linkedEntityId", projectId);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `Request failed (HTTP ${res.status})`);
      router.replace(createdHref("/documents", data.id, values.name || file.name));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "The document could not be uploaded.");
      setSaving(false);
    }
  }

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
      error={error}
      saving={saving}
      onSubmit={handleUpload}
    />
  );
}
