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
// R67 D-55 / D-65 -- THE THREE SWALLOWED READS. This form's Activity select
// is REQUIRED, and its options came from
//
//     fetch(`/api/work-progress/activities?...`).then((r) => r.json())
//       .then((data) => setActivities(data.activities ?? []))
//       .catch(() => toast.error("Couldn't load activities"));
//
// so a failed read left the dropdown empty and "Log Entry" disabled with
// the reason "1 required field" -- the form blaming the site engineer for a
// backend failure they cannot act on. The BOQ read swallowed its failure
// entirely (`catch(() => {})`) and the line-item read silently set []. Same
// defect, and the same fix, as D-46 applied to ScheduleLogTimeClient: the
// failure is stated in words, it carries a Retry, and the disabled reason
// names the real cause.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FormScreen, FormSection, type ScreenColumn, type FieldMessage } from "@fchecklist/veridian-ui-kit/screens";
import { PaneErrorCard } from "@/components/PaneState";
import { fetchJson, ApiError } from "@/lib/fetch-json";
import { pickCurrentBoq } from "@/lib/work-progress-reads";
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
type Boq = { id: string; version: number; status: string; title: string };
type ReadError = { status: number | null; message: string | null } | null;

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
  // R67 D-55: what the two supporting reads said when they failed. Held, not
  // toasted -- a notification that fades cannot explain a control that is
  // still empty two minutes later.
  const [activitiesError, setActivitiesError] = useState<ReadError>(null);
  const [boqError, setBoqError] = useState<ReadError>(null);
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

  const loadActivities = useCallback(async () => {
    setActivitiesError(null);
    try {
      const data = await fetchJson<{ activities?: Activity[] }>(
        `/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`
      );
      setActivities(data.activities ?? []);
    } catch (err) {
      setActivities([]);
      setActivitiesError({
        status: err instanceof ApiError ? err.status : null,
        message: err instanceof Error ? err.message : null,
      });
    }
  }, [projectId]);

  useEffect(() => {
    void loadActivities();
  }, [loadActivities]);

  useEffect(() => {
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
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJson<{ boqs?: Boq[] }>(`/api/scope?projectId=${encodeURIComponent(projectId)}`);
        if (cancelled) return;
        const all: Boq[] = data.boqs ?? [];
        setBoqError(null);
        if (all.length === 0) return;
        setBoqs(all);
        // R67 D-55: the approved > submitted > highest-version rule was
        // written out here for the third time in this module. It is
        // pickCurrentBoq() now, tested once, so the form and the two list
        // screens cannot disagree about which revision a line belongs to.
        const current = pickCurrentBoq(all);
        if (!current) return;
        setSelectedBoqId(current.id);
        // Reflect the default in the control itself, so the user can SEE which
        // BOQ they are recording against instead of having to infer it.
        setValues((v) => ({ ...v, boqId: current.id }));
      } catch (err) {
        // The BOQ link is genuinely optional -- an entry can be logged
        // against an activity alone -- so this does not block the form. But
        // it is no longer SILENT: a QS who cannot find their line needs to
        // know the list failed to load rather than concluding the BOQ is
        // missing from the project.
        if (cancelled) return;
        setBoqError({
          status: err instanceof ApiError ? err.status : null,
          message: err instanceof Error ? err.message : null,
        });
      }
    })();
    return () => { cancelled = true; };
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
    (async () => {
      try {
        const boq = await fetchJson<{ lineItems?: BoqLineItem[] }>(`/api/scope/${encodeURIComponent(selectedBoqId)}`);
        if (!cancelled) {
          setLineItems(boq.lineItems ?? []);
          setBoqError(null);
        }
      } catch (err) {
        // Same rule as the BOQ list above: the picker empties, and the user
        // is told why rather than being left to read an empty dropdown as
        // "this BOQ has no lines".
        if (cancelled) return;
        setLineItems([]);
        setBoqError({
          status: err instanceof ApiError ? err.status : null,
          message: err instanceof Error ? err.message : null,
        });
      }
    })();
    return () => { cancelled = true; };
  }, [selectedBoqId]);

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

  // R67 D-55 (the rule D-46 wrote for ScheduleLogTimeClient): when the
  // Activity list failed to load, Activity is unfillable, and telling the
  // user they have "1 required field" left is blaming them for a backend
  // failure. Name the real cause instead.
  const submitDisabledReason = activitiesError
    ? "Activities could not be loaded"
    : missingCount > 0
      ? `${missingCount} required field${missingCount === 1 ? "" : "s"}`
      : undefined;

  const banner = (
    <>
      {activitiesError && (
        <div className="mx-4 mt-3">
          <PaneErrorCard
            entity="this project's activities"
            error={activitiesError}
            onRetry={() => void loadActivities()}
          />
        </div>
      )}
      {boqError && (
        <div className="mx-4 mt-3">
          <PaneErrorCard entity="this project's BOQ lines" error={boqError} />
        </div>
      )}
      {queued.length > 0 && (
        <div className="mx-4 mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          {queued.length} {queued.length === 1 ? "entry" : "entries"} queued on this device, will sync automatically.
        </div>
      )}
    </>
  );

  return (
    <FormScreen
      breadcrumb="Work Progress / Log entry"
      title="Log Work Progress"
      onSubmit={handleSubmit}
      submitLabel="Log Entry"
      submitting={submitting}
      submitDisabled={missingCount > 0 || Boolean(activitiesError)}
      submitDisabledReason={submitDisabledReason}
      messages={messages}
      banner={activitiesError || boqError || queued.length > 0 ? banner : undefined}
    >
      <FormSection title="Progress entry" columns={columns} values={values} mode="edit" onFieldChange={handleFieldChange} />
    </FormScreen>
  );
}
