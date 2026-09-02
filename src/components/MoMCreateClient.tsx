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
import { fetchJson } from "@/lib/fetch-json";
import type { CreateField } from "@/lib/create-screen";

const FIELDS: CreateField[] = [
  { name: "title", label: "Title", kind: "text", required: true, placeholder: "e.g. Weekly site review", wide: true },
  { name: "scheduledAt", label: "Date & time", kind: "datetime-local", required: true },
];

export default function MoMCreateClient({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const meeting = await fetchJson<{ id: string }>("/api/moms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: (values.title ?? "").trim(),
          scheduledAt: values.scheduledAt,
          projectId,
        }),
      });
      router.replace(createdHref("/moms", meeting.id, (values.title ?? "").trim()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request did not complete.");
      setSaving(false);
    }
  }

  return (
    <CreateScreen
      module="Minutes of Meeting"
      moduleHref={`/moms?projectId=${encodeURIComponent(projectId)}`}
      objectLabel="Meeting"
      fields={FIELDS}
      values={values}
      onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
      error={error}
      saving={saving}
      onSubmit={() => void save()}
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
