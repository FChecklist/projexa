"use client";

// Real-screen conversion (2026-08-30): replaces MoMsClient.tsx's old "New
// Meeting" Dialog popup with a real create screen.
//
// R67 D-20: `projectName` is required, not decorative -- the screen states
// which project it is about to write into, so a user can never save minutes
// into a project they did not knowingly pick. The route above this refuses to
// render the form at all without one.
//
// R67 D-67: onto the one create archetype. What changes: the breadcrumb now
// names the project (it read "Minutes of Meeting / New Meeting" with no
// project in it, on the one screen D-20 exists because of), the required
// fields are named in the primary's own label rather than only in a hover
// reason, and a save that lands leaves a receipt on the meeting page instead
// of a toast that fades. The POST contract is unchanged.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CreateScreen } from "@/components/screens/CreateScreen";
import { createdHref } from "@/components/CreatedReceipt";
import { useSubmit } from "@/lib/use-submit";
import type { CreateField } from "@/lib/create-screen";

const FIELDS: CreateField[] = [
  { name: "title", label: "Title", kind: "text", required: true, placeholder: "e.g. Weekly site review", wide: true },
  { name: "scheduledAt", label: "Date & time", kind: "datetime-local", required: true },
];

export default function MoMCreateClient({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});

  const submit = useSubmit<{ id?: unknown }>({
    objectLabel: "Meeting",
    buildRequest: () => ({
      input: "/api/moms",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: (values.title ?? "").trim(),
          scheduledAt: values.scheduledAt,
          projectId,
        }),
      },
    }),
    onSuccess: (meeting) => {
      const id = typeof meeting?.id === "string" ? meeting.id : "";
      if (!id) throw new Error("The server did not confirm a saved meeting");
      router.replace(createdHref("/moms", id, (values.title ?? "").trim()));
    },
  });

  return (
    <CreateScreen
      module="Minutes of Meeting"
      moduleHref={`/moms?projectId=${encodeURIComponent(projectId)}`}
      objectLabel="Meeting"
      fields={FIELDS}
      values={values}
      onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
      failure={submit.failure}
      onRetry={submit.submit}
      saving={submit.saving}
      saved={submit.saved}
      onSubmit={submit.submit}
      onCancel={() => router.push(`/moms?projectId=${encodeURIComponent(projectId)}`)}
      banner={
        // The one fact this screen exists to keep in front of the user: which
        // project the minutes are about to be written into.
        <p className="text-[12px] text-px-muted">
          Project: <span style={{ color: "var(--color-veri-status-context)" }}>{projectName}</span>
        </p>
      }
    />
  );
}
