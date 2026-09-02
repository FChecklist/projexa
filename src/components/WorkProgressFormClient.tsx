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
import { messageFor } from "@/lib/task-errors";
// R67 B-09 (DE-22): the required-field rule and the Save button's own words
// live beside the server's rule, not inside this component -- see that
// module's header for why.
import { missingFieldNames, missingProgressFields, submitLabelFor } from "@/lib/work-progress-form-fields";
import {
  enqueueWorkProgressEntry,
  listQueuedWorkProgressEntries,
  syncQueuedWorkProgressEntries,
  uploadQueuedPhoto,
  type QueuedWorkProgressEntry,
} from "@/lib/offline/work-progress-queue";

type Activity = { id: string; name: string; unit: string | null };
type BoqLineItem = { id: string; itemCode: string | null; description: string; unit: string; rate: string };
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
  const [lineItems, setLineItems] = useState<BoqLineItem[]>([]);
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

  // Loads the selected BOQ's line items. Split out of the effect above so
  // changing the BOQ re-populates the picker, which is the whole point of the
  // selector. Org and project scoping are unchanged: this only ever fetches a
  // BOQ id that /api/scope?projectId= already returned for this project, and
  // that route is org-scoped server-side -- so widening the CHOICE here does
  // not widen ACCESS.
  useEffect(() => {
    if (!selectedBoqId) return;
    let cancelled = false;
    fetch(`/api/scope/${selectedBoqId}`)
      .then((r) => r.json())
      .then((boq) => { if (!cancelled) setLineItems(boq.lineItems ?? []); })
      .catch(() => { if (!cancelled) setLineItems([]); });
    return () => { cancelled = true; };
  }, [selectedBoqId]);

  // R67 B-09: whether THIS project is measured against a BOQ at all. The
  // /api/scope fetch below already answers it, so this needs no extra call.
  const projectHasBoq = boqs.length > 0;
  const missingRequired = missingProgressFields(values, projectHasBoq);

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
    // R67 B-09: REQUIRED whenever the project actually has a BOQ, matching
    // the one rule the API route now enforces for both callers
    // (construction-progress-service.createEntry). An entry with no line on a
    // project measured against a BOQ cannot be rolled up, cannot be valued,
    // and vanishes from the Work Progress Report -- so the form must ask for
    // it up front rather than let the server refuse after the click. On a
    // project with NO BOQ there is nothing to link to and the field stays
    // optional (and its picker empty), which is why this is derived from
    // `projectHasBoq` rather than hard-coded either way.
    { label: "BOQ line", field: "boqLineItemId", control: "SELECT", type: "text", required: projectHasBoq, fieldStatus: projectHasBoq ? "REQUIRED" : "OPTIONAL", options: lineItems.map((l) => ({ value: l.id, label: l.itemCode ? `${l.itemCode} -- ${l.description}` : l.description })) },
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
    if (field === "boqLineItemId") {
      const line = lineItems.find((l) => l.id === value);
      setValues((v) => ({ ...v, boqLineItemId: value, description: line?.description ?? null, unit: line?.unit ?? null, rate: line?.rate ?? null }));
      return;
    }
    setValues((v) => ({ ...v, [field]: value }));
  }

  async function handleSubmit() {
    const missing = missingRequired;
    if (missing.length > 0) {
      // R67 B-09 (DE-22): NAME the fields, do not count them. "2 required
      // fields missing" makes the user hunt; "Activity, BOQ line" does not.
      setMessages([{ level: "error", text: `Still needed: ${missingFieldNames(missing)}` }]);
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
        // R67 B-09 (D-03): the route answers a rule violation with a CODE.
        // Rendering it through the SAME dictionary the composer uses is what
        // makes both paths produce the same words -- "Pick a BOQ line", never
        // "itemCode" and never "boqLineItemId".
        if (typeof err.code === "string") {
          setMessages([{ field: "boqLineItemId", level: "error", text: messageFor(err.code) }]);
          setSubmitting(false);
          return;
        }
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
  //
  // R67 B-09: `boqLineItemId` joins the list whenever the project has a BOQ,
  // which is exactly the rule the API route enforces -- so the button is
  // disabled for the same reason the server would have refused, instead of
  // the user finding out after the click.
  const missingCount = missingRequired.length;

  return (
    <FormScreen
      breadcrumb="Work Progress / Log entry"
      title="Log Work Progress"
      onSubmit={handleSubmit}
      submitLabel={submitLabelFor(missingRequired)}
      submitting={submitting}
      submitDisabled={missingCount > 0}
      submitDisabledReason={missingCount > 0 ? missingFieldNames(missingRequired) : undefined}
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
