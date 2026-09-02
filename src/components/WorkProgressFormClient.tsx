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
//
// R67 lane D22 (item D-64, rec R-230): the BOQ line field is no longer a flat
// native <select> of every line in the BOQ, labelled by description alone, in
// insertion order. It is a searchable picker over /api/scope/lines showing
// code, description, unit and remaining quantity, with parent lines disabled
// and the reason said out loud. See the note beside it for why this is the BOQ
// line field and not the Activity one.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FormScreen, FormSection, type ScreenColumn, type FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import BoqLinePicker from "@/components/BoqLinePicker";
import { createClient } from "@/lib/supabase/client";
import {
  enqueueWorkProgressEntry,
  listQueuedWorkProgressEntries,
  syncQueuedWorkProgressEntries,
  uploadQueuedPhoto,
  type QueuedWorkProgressEntry,
} from "@/lib/offline/work-progress-queue";

type Activity = { id: string; name: string; unit: string | null };
type Boq = { id: string; version: number; status: string; title: string };

const ENTRY_BASIS_OPTIONS = [
  { value: "DELTA", label: "Delta -- this entry adds to progress already logged" },
  { value: "SNAPSHOT", label: "Snapshot -- this entry replaces the running total" },
];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function WorkProgressFormClient({ projectId, onLogged }: { projectId: string; onLogged: () => void }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  // R47-005 (fault R46M13_TC30_01): every BOQ in the project, plus which one is
  // currently selected. Before this, the form resolved exactly ONE "current"
  // BOQ and offered no way to reach any other.
  const [boqs, setBoqs] = useState<Boq[]>([]);
  const [selectedBoqId, setSelectedBoqId] = useState<string | null>(null);
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

    // R47-005 (fault R46M13_TC30_01, reproduced live in production 2026-08-25):
    // this used to resolve ONE "current" BOQ -- approved, else submitted, else
    // highest version -- fetch only that BOQ's line items, and offer no BOQ
    // selector anywhere on the form. Every other BOQ in the project was
    // therefore unreachable for recording progress against.
    //
    // Measured on Oakwood Residence at the time: 31 BOQs carrying 79 line items
    // in the project, and the picker offered TWO ("PP1 -- Parent PP1",
    // "PP1-A -- Child A"). The winner was an unrelated leftover test BOQ,
    // "R45-B3 pct-only 1787594876935", which won on ONE property: it was the
    // only version-2 row. The project has zero approved and zero submitted
    // BOQs, so both preference branches missed and resolution fell through to
    // version DESC. A freshly created BOQ is draft/version 1 and could NEVER
    // outrank it -- so a user who had just built a weighted BOQ could not
    // select its sub-task at all. That is TC-30, unrunnable by a real user.
    //
    // The resolution order is KEPT as the DEFAULT selection (so the common
    // single-BOQ case behaves exactly as before), but the full list is now
    // retained and offered whenever the project holds more than one -- the
    // same shape projexa#94 already established for the work-progress REPORT,
    // rather than inventing a second convention for the same problem.
    fetch(`/api/scope?projectId=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((data) => {
        const all: Boq[] = data.boqs ?? [];
        if (all.length === 0) return;
        setBoqs(all);
        const current =
          all.find((b) => b.status === "approved") ??
          all.find((b) => b.status === "submitted") ??
          [...all].sort((a, b) => b.version - a.version)[0];
        setSelectedBoqId(current.id);
        // Reflect the default in the control itself, so the user can SEE which
        // BOQ they are recording against instead of having to infer it.
        setValues((v) => ({ ...v, boqId: current.id }));
      })
      .catch(() => { /* optional context -- a missing BOQ link is not a form-blocking error */ });
  }, [projectId]);

  // R67 D-64: the whole selected BOQ used to be fetched here just to populate a
  // native <select> of its lines. BoqLinePicker asks /api/scope/lines for the
  // handful of lines that match what was typed instead, so a 900-line BOQ is
  // no longer downloaded to render ten options -- and the same lookup now
  // answers the form, the chat's record step and the reports.

  const columns: ScreenColumn[] = [
    { label: "Activity", field: "activityId", control: "SELECT", type: "text", required: true, fieldStatus: "REQUIRED", options: activities.map((a) => ({ value: a.id, label: a.unit ? `${a.name} (${a.unit})` : a.name })) },
    // Shown only when the project actually holds more than one BOQ -- with a
    // single BOQ the choice is not a choice, and an extra control on a site
    // engineer's form is cost with no benefit (projexa#94's own rule).
    ...(boqs.length > 1
      ? [{
          label: "BOQ", field: "boqId", control: "SELECT", type: "text", required: false, fieldStatus: "OPTIONAL",
          options: [...boqs]
            .sort((a, b) => b.version - a.version || a.title.localeCompare(b.title))
            .map((b) => ({ value: b.id, label: `${b.title} (v${b.version}, ${b.status})` })),
        } as ScreenColumn]
      : []),
    // R67 D-64: the BOQ line is chosen in the searchable picker rendered above
    // this section, not by a SELECT column here -- the kit's FieldRenderer has
    // no combobox control and forking it for one field would be a far larger
    // change than the item asks for.
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
    if (field === "boqId") {
      // Switching BOQ invalidates the line selected from the previous one, so
      // clear it and the fields derived from it. Leaving a stale line id in
      // place would post progress against a line the user can no longer see.
      setSelectedBoqId(value as string);
      setValues((v) => ({ ...v, boqId: value, boqLineItemId: undefined, description: null, unit: null, rate: null }));
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
      {/* R67 D-64. WHY THIS IS THE BOQ LINE FIELD AND NOT "Activity": the item
          names the Daily Entry's Activity select, but the endpoint it specifies
          (/api/scope/lines) returns BOQ lines, and "parent lines disabled" is a
          BOQ-line property -- construction_activities has no hierarchy. In this
          schema activity_id is a separate NOT NULL FK to
          construction_activities, so replacing the Activity control with a
          BOQ-line picker would make every submission fail. The searchable
          picker is therefore on the BOQ line field, which is the control the
          item actually describes; the Activity select is unchanged. */}
      <div className="space-y-1.5 px-4 pt-3">
        <span className="block text-[12.5px] text-ct-muted">BOQ line item</span>
        <BoqLinePicker
          projectId={projectId}
          boqId={selectedBoqId}
          value={(values.boqLineItemId as string) ?? null}
          onChange={(lineId, line) =>
            setValues((v) => ({
              ...v,
              boqLineItemId: lineId ?? undefined,
              // The derived fields follow the chosen line, exactly as they did
              // when this was a SELECT -- inherited, never retyped.
              description: line?.description ?? null,
              unit: line?.unit ?? null,
              rate: line?.rate ?? null,
            }))
          }
        />
      </div>
      <FormSection title="Progress entry" columns={columns} values={values} mode="edit" onFieldChange={handleFieldChange} />
    </FormScreen>
  );
}
