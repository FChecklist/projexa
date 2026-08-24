"use client";

// R42 seq22 (M28 FORM archetype, S3 module 3/3): registry-driven Work
// Progress entry form on the kit's FormScreen/FormSection/FieldRenderer --
// zero bespoke UI widgets. Replaces the hand-rolled Dialog in the old
// WorkProgressClient.tsx (kept alongside until this is live-verified, then
// deleted in the same PR pattern seq21 established).
//
// Derived fields (line item description/unit/rate, "inherited... and NEVER
// retyped" per this seq's own row): DERIVED-control columns, populated by
// this file's own onFieldChange when boqLineItemId changes -- not a bespoke
// component, the same wiring-vs-component distinction PermitObjectClient
// established in seq21 (FieldRenderer already renders DERIVED read-only;
// only the *lookup* is module-specific code, same as any other field).
//
// Photo: uses the FILE control (new in this seq) + the now-exported
// uploadQueuedPhoto() from the offline queue -- see that function's own
// updated comment for the real online-path gap this closes.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FormScreen, FormSection, type ScreenColumn, type FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { createClient } from "@/lib/supabase/client";
import {
  enqueueWorkProgressEntry,
  listQueuedWorkProgressEntries,
  syncQueuedWorkProgressEntries,
  uploadQueuedPhoto,
  type QueuedWorkProgressEntry,
} from "@/lib/offline/work-progress-queue";

type Activity = { id: string; name: string; unit: string | null };
type BoqLineItem = { id: string; itemCode: string | null; description: string; unit: string; rate: string };
type Boq = { id: string; version: number; status: string };

const ENTRY_BASIS_OPTIONS = [
  { value: "DELTA", label: "Delta -- this entry adds to progress already logged" },
  { value: "SNAPSHOT", label: "Snapshot -- this entry replaces the running total" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function WorkProgressFormClient({ projectId, onLogged }: { projectId: string; onLogged: () => void }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [lineItems, setLineItems] = useState<BoqLineItem[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({ entryDate: todayIso(), entryBasis: "DELTA" });
  const [messages, setMessages] = useState<FieldMessage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [scope, setScope] = useState<string | null>(null);
  const [queued, setQueued] = useState<QueuedWorkProgressEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    createClient().auth.getUser().then(({ data }) => { if (!cancelled) setScope(data.user?.id ?? null); });
    return () => { cancelled = true; };
  }, []);

  const refreshQueued = useCallback(async () => {
    if (!scope) return;
    setQueued(await listQueuedWorkProgressEntries(scope));
  }, [scope]);

  useEffect(() => { refreshQueued(); }, [refreshQueued]);

  useEffect(() => {
    fetch(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((data) => setActivities(data.activities ?? []))
      .catch(() => toast.error("Couldn't load activities"));

    // Resolve "the current BOQ" the same way ScopeClient shows it: prefer
    // approved, then submitted, then the highest version -- a BOQ line link
    // is optional (createProgressEntry's own contract), so no BOQ existing
    // yet just means the picker is empty, never an error.
    fetch(`/api/scope?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then(async (data) => {
        const boqs: Boq[] = data.boqs ?? [];
        if (boqs.length === 0) return;
        const current =
          boqs.find((b) => b.status === "approved") ??
          boqs.find((b) => b.status === "submitted") ??
          [...boqs].sort((a, b) => b.version - a.version)[0];
        const boqRes = await fetch(`/api/scope/${current.id}`);
        const boq = await boqRes.json();
        setLineItems(boq.lineItems ?? []);
      })
      .catch(() => { /* optional context -- a missing BOQ link is not a form-blocking error */ });
  }, [projectId]);

  const columns: ScreenColumn[] = [
    { label: "Activity", field: "activityId", control: "SELECT", type: "text", required: true, fieldStatus: "REQUIRED", options: activities.map((a) => ({ value: a.id, label: a.unit ? `${a.name} (${a.unit})` : a.name })) },
    { label: "BOQ line item", field: "boqLineItemId", control: "SELECT", type: "text", required: false, fieldStatus: "OPTIONAL", options: lineItems.map((l) => ({ value: l.id, label: l.itemCode ? `${l.itemCode} -- ${l.description}` : l.description })) },
    { label: "Line item description", field: "description", control: "DERIVED", type: "text", fieldStatus: "OPTIONAL" },
    { label: "Unit", field: "unit", control: "DERIVED", type: "text", fieldStatus: "OPTIONAL" },
    { label: "Rate", field: "rate", control: "DERIVED", type: "number", fieldStatus: "OPTIONAL" },
    { label: "Date", field: "entryDate", control: "DATE", type: "date", required: true, fieldStatus: "REQUIRED" },
    { label: "Quantity done", field: "quantityDone", control: "NUMBER", type: "number", required: true, fieldStatus: "REQUIRED" },
    { label: "% complete", field: "percentComplete", control: "NUMBER", type: "number", required: true, fieldStatus: "REQUIRED" },
    { label: "Entry basis", field: "entryBasis", control: "RADIO", type: "text", required: true, fieldStatus: "REQUIRED", options: ENTRY_BASIS_OPTIONS },
    { label: "Remarks", field: "remarks", control: "TEXT", type: "text", fieldStatus: "OPTIONAL", required: false },
    { label: "Site photo", field: "photo", control: "FILE", type: "file", fieldStatus: "OPTIONAL", required: false },
  ];

  function handleFieldChange(field: string, value: unknown) {
    if (field === "boqLineItemId") {
      const line = lineItems.find((l) => l.id === value);
      setValues((v) => ({ ...v, boqLineItemId: value, description: line?.description ?? null, unit: line?.unit ?? null, rate: line?.rate ?? null }));
      return;
    }
    setValues((v) => ({ ...v, [field]: value }));
  }

  async function handleSubmit() {
    const required = ["activityId", "entryDate", "quantityDone", "percentComplete", "entryBasis"];
    const missing = required.filter((f) => values[f] === undefined || values[f] === null || values[f] === "");
    if (missing.length > 0) {
      setMessages([{ level: "error", text: `${missing.length} required field${missing.length === 1 ? "" : "s"} missing` }]);
      return;
    }
    const pct = Number(values.percentComplete);
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      setMessages([{ field: "percentComplete", level: "error", text: "% complete must be between 0 and 100" }]);
      return;
    }
    setMessages([]);
    setSubmitting(true);

    const payload = {
      projectId,
      activityId: values.activityId as string,
      boqLineItemId: (values.boqLineItemId as string) || undefined,
      entryDate: values.entryDate as string,
      quantityDone: Number(values.quantityDone),
      percentComplete: pct,
      entryBasis: values.entryBasis as "DELTA" | "SNAPSHOT",
      remarks: (values.remarks as string) || undefined,
    };
    const photo = values.photo instanceof File ? values.photo : null;
    const photoField = photo ? { blob: photo, name: photo.name, type: photo.type } : null;

    async function reset() {
      setValues({ entryDate: todayIso(), entryBasis: "DELTA" });
      onLogged();
    }

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      if (!scope) { setMessages([{ level: "error", text: "Still verifying your session -- try again in a moment" }]); setSubmitting(false); return; }
      await enqueueWorkProgressEntry(scope, { ...payload, photo: photoField });
      toast.info("You're offline -- progress saved on this device, will sync automatically");
      await reset(); refreshQueued(); setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/work-progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to log progress");
      }
      const created = await res.json();
      // R42 seq22 fix: the online path never uploaded a photo before this --
      // see uploadQueuedPhoto()'s own comment for the full finding.
      if (photo) {
        await uploadQueuedPhoto(created.id, { blob: photo, name: photo.name, type: photo.type }).catch(() => {
          toast.error("Progress logged, but the photo failed to upload");
        });
      }
      toast.success("Progress logged");
      await reset();
    } catch (err) {
      if (err instanceof TypeError) {
        if (!scope) { setMessages([{ level: "error", text: "Still verifying your session -- try again in a moment" }]); }
        else {
          await enqueueWorkProgressEntry(scope, { ...payload, photo: photoField });
          toast.info("Network unavailable -- progress saved on this device, will sync automatically");
          await reset(); refreshQueued();
        }
      } else {
        setMessages([{ level: "error", text: err instanceof Error ? err.message : "Couldn't log progress" }]);
      }
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!scope) return;
    const run = () => { if (typeof navigator !== "undefined" && navigator.onLine) syncQueuedWorkProgressEntries(scope).then(({ synced }) => { if (synced > 0) { toast.success(`Synced ${synced} queued ${synced === 1 ? "entry" : "entries"}`); onLogged(); } refreshQueued(); }); };
    run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, [scope]);

  // R42 seq23 live-user finding: same fail-after-click gap caught on
  // Permits' Save applies here too -- Log Entry was clickable with required
  // fields still empty. See PermitObjectClient.tsx's own comment for the
  // GLOBAL rule this violated.
  const requiredFields = ["activityId", "entryDate", "quantityDone", "percentComplete", "entryBasis"];
  const missingCount = requiredFields.filter((f) => values[f] === undefined || values[f] === null || values[f] === "").length;

  return (
    <FormScreen
      breadcrumb="Work Progress / Log entry"
      title="Log Work Progress"
      onSubmit={handleSubmit}
      submitLabel="Log Entry"
      submitting={submitting}
      submitDisabled={missingCount > 0}
      submitDisabledReason={missingCount > 0 ? `${missingCount} required field${missingCount === 1 ? "" : "s"}` : undefined}
      messages={messages}
      banner={queued.length > 0 ? (
        <div className="mx-4 mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          {queued.length} {queued.length === 1 ? "entry" : "entries"} queued on this device, will sync automatically.
        </div>
      ) : undefined}
    >
      <FormSection title="Progress entry" columns={columns} values={values} mode="edit" onFieldChange={handleFieldChange} />
    </FormScreen>
  );
}
