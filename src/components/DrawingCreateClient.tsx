"use client";

// Real-screen conversion (2026-08-30) -- replaces DrawingsClient.tsx's old
// "Add Drawing" Dialog popup with a real create screen, same fields
// (kind, discipline, file-or-external-link for 3D walkthroughs).
//
// R67 D-67: onto the shared archetype. This form had the worst version of
// the fail-after-click problem in the module. Its Save was enabled with
// only a name typed, and the file check ran INSIDE the submit handler --
// so a user picked "3D Walkthrough", typed a name, pressed Save, and only
// then was told "A file is required" by a toast that faded. The required
// set now depends on the mode the user actually chose, it is named in the
// button before the click, and a chosen file survives a refused save with
// its name still echoed on screen (a file input cannot be repopulated
// programmatically, so saying nothing would look like the file was lost).
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { createdHref } from "@/components/CreatedReceipt";
import { useSubmit } from "@/lib/use-submit";
import type { CreateField } from "@/lib/create-screen";

export default function DrawingCreateClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({ kind: "dwg" });
  const [file, setFile] = useState<File | null>(null);

  const kind = values.kind || "dwg";
  // A walkthrough may be a hosted link instead of an upload; a DWG never is.
  const usingLink = kind === "3d_walkthrough" && values.source === "link";

  const moduleHref = `/drawings?projectId=${projectId}`;

  const fields: CreateField[] = [
    {
      name: "kind",
      label: "Kind",
      kind: "select",
      required: true,
      options: [
        { value: "dwg", label: "DWG Drawing" },
        { value: "3d_walkthrough", label: "3D Walkthrough" },
      ],
    },
    { name: "name", label: "Name", kind: "text", required: true, placeholder: "e.g. GF-101 Ground floor plan" },
    { name: "discipline", label: "Discipline", kind: "text", placeholder: "Architectural, Structural, MEP..." },
    ...(kind === "3d_walkthrough"
      ? ([
          {
            name: "source",
            label: "Source",
            kind: "select",
            required: true,
            options: [
              { value: "file", label: "Upload a file" },
              { value: "link", label: "Use an external link" },
            ],
            help: "A walkthrough can be hosted elsewhere; a DWG must be uploaded.",
          },
        ] as CreateField[])
      : []),
    ...(usingLink
      ? ([
          {
            name: "externalUrl",
            label: "Walkthrough URL",
            kind: "text",
            required: true,
            placeholder: "https://...",
            wide: true,
            validate: (value) =>
              !value.trim() || /^https?:\/\//i.test(value.trim()) ? null : "Start the address with http:// or https://",
          },
        ] as CreateField[])
      : ([
          {
            name: "file",
            label: kind === "dwg" ? "File (DWG)" : "File",
            kind: "file",
            required: true,
            accept: kind === "dwg" ? ".dwg,.dxf,.pdf" : undefined,
            wide: true,
          },
        ] as CreateField[])),
  ];

  const submit = useSubmit<{ id?: unknown }>({
    objectLabel: "Drawing",
    buildRequest: () => {
      const formData = new FormData();
      formData.set("projectId", projectId);
      formData.set("kind", kind);
      formData.set("name", (values.name ?? "").trim());
      if ((values.discipline ?? "").trim()) formData.set("discipline", values.discipline.trim());
      if (usingLink) formData.set("externalUrl", (values.externalUrl ?? "").trim());
      else if (file) formData.set("file", file);
      return { input: "/api/drawings", init: { method: "POST", body: formData } };
    },
    onSuccess: (data) => {
      const id = typeof data?.id === "string" ? data.id : "";
      if (!id) throw new Error("The server did not confirm a saved drawing");
      router.replace(`${createdHref("/drawings", id, values.name)}&projectId=${encodeURIComponent(projectId)}`);
    },
  });

  return (
    <CreateScreen
      module="Drawings & 3D"
      moduleHref={moduleHref}
      objectLabel="Drawing"
      title="Add Drawing / 3D Walkthrough"
      fields={fields}
      values={values}
      onChange={(name, value) =>
        setValues((v) => {
          const next = { ...v, [name]: value };
          // Switching away from a walkthrough retires the link choice, so a
          // DWG can never be saved with a leftover external URL.
          if (name === "kind" && value !== "3d_walkthrough") {
            delete next.source;
            delete next.externalUrl;
          }
          return next;
        })
      }
      // The File object is held in state, not in the input, so it survives a
      // refusal -- CreateScreen echoes its name so the user can see that.
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
