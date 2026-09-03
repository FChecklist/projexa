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
import { useSubmit } from "@/lib/use-submit";
import { pickCurrentBoq } from "@/lib/work-progress-reads";
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

// R67 F-24: the page may hand this list down (see the `activities` prop), and
// the shared ProgressActivity leaves `unit` optional, so this does too. A row
// without one simply renders the bare name.
type Activity = { id: string; name: string; unit?: string | null };
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


export default function WorkProgressFormClient({
  projectId,
  onLogged,
  activities: providedActivities,
}: {
  projectId: string;
  onLogged: () => void;
  /**
   * R67 F-24: the activity list the PAGE already read. Optional -- the form
   * still fetches for itself when it is mounted without one.
   */
  activities?: Activity[];
}) {
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

  // R67 MERGE (lane F2's F-24). This form used to fetch
  // /api/work-progress/activities while WorkProgressPageClient fetched exactly
  // the same list alongside it -- two requests, one screen, one answer. When
  // the page hands its list down, the form uses it and asks for nothing; the
  // fetch above still runs for the case the page cannot cover (a Retry beside
  // the field, and any future mounting of this form on its own).
  const suppliedActivities = providedActivities ?? null;
  useEffect(() => {
    if (suppliedActivities) {
      setActivities(suppliedActivities);
      setActivitiesError(null);
      return;
    }
    void loadActivities();
  }, [suppliedActivities, loadActivities]);

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

  /** What this form is about to send, from the values as they stand. */
  function currentPayload() {
    return {
      projectId,
      activityId: values.activityId as string,
      boqLineItemId: (values.boqLineItemId as string) || undefined,
      entryDate: values.entryDate as string,
      quantityDone: Number(values.quantityDone),
      percentComplete: Number(values.percentComplete),
      entryBasis: values.entryBasis as "DELTA" | "SNAPSHOT",
      remarks: (values.remarks as string) || undefined,
    };
  }

  function currentPhoto(): File | null {
    return values.photo instanceof File ? values.photo : null;
  }

  function resetForm() {
    setValues({ entryDate: todayIso(), entryBasis: "DELTA" });
    onLogged();
  }

  /** Puts the entry on this device and clears the form, as if it had landed. */
  async function queueOnDevice(reason: string): Promise<boolean> {
    if (!scope) {
      setMessages([{ level: "error", text: "Still verifying your session -- try again in a moment" }]);
      return false;
    }
    const photo = currentPhoto();
    await enqueueWorkProgressEntry(scope, {
      ...currentPayload(),
      photo: photo ? { blob: photo, name: photo.name, type: photo.type } : null,
    });
    setMessages([{ level: "info", text: reason }]);
    resetForm();
    refreshQueued();
    return true;
  }

  // R67 D-72: the online write goes through the one submit -- so it carries a
  // ten-second ceiling (it had none), and a refusal stays on the screen
  // instead of being a toast that faded while the site engineer was looking
  // at the entry they had just typed.
  const submit = useSubmit<{ id?: string }>({
    objectLabel: "progress entry",
    buildRequest: () => ({
      input: "/api/work-progress",
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(currentPayload()),
      },
    }),
    onSuccess: async (created) => {
      const photo = currentPhoto();
      // R42 seq22 fix: the online path never uploaded a photo before this --
      // see uploadQueuedPhoto()'s own comment for the full finding.
      if (photo && created?.id) {
        await uploadQueuedPhoto(created.id, { blob: photo, name: photo.name, type: photo.type }).catch(() => {
          setMessages([
            { level: "warning", text: "Progress logged, but the photo failed to upload" },
          ]);
        });
      }
      resetForm();
    },
    // A dropped connection is not a failure on this form: the entry is kept
    // on the device and synced when the radio comes back. That is a real
    // second outcome, which is why the hook asks rather than assuming.
    onTransportError: async (err) =>
      err instanceof TypeError
        ? queueOnDevice("Network unavailable -- progress saved on this device, will sync automatically")
        : false,
  });

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

    if (typeof navigator !== "undefined" && !navigator.onLine) {
      await queueOnDevice("You're offline -- progress saved on this device, will sync automatically");
      return;
    }

    // R67 D-72: the write itself, its ten-second ceiling, its offline
    // fallback and its refusal all live in useSubmit -- including WS-B's rule
    // that a coded refusal is rendered through the shared dictionary
    // ("Pick a BOQ line", never "boqLineItemId"), which is applied there so
    // every create form obeys it rather than this one screen.
    submit.submit();
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
      // R67 B-09 (DE-22): the button NAMES what is still needed rather than
      // counting it -- "2 required fields missing" makes the user hunt.
      submitLabel={submitLabelFor(missingRequired)}
      submitting={submit.saving}
      submitDisabled={missingCount > 0 || Boolean(activitiesError) || submit.saving}
      submitDisabledReason={submitDisabledReason}
      // The failure is a MESSAGE on the screen, not a notification: the kit's
      // message area persists until the next submit, which is the whole point
      // of moving off toast.error().
      messages={
        submit.failure ? [...messages, { level: "error" as const, text: submit.failure.message }] : messages
      }
      banner={activitiesError || boqError || queued.length > 0 ? banner : undefined}
    >
      <FormSection title="Progress entry" columns={columns} values={values} mode="edit" onFieldChange={handleFieldChange} />
    </FormScreen>
  );
}
