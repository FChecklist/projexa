"use client";

// R42 seq22: thin composition of the FORM (WorkProgressFormClient) and LIST
// (WorkProgressListClient) archetypes on one page, per this seq's own
// "WORK PROGRESS (FORM+LIST)" row. Owns only the entries/lookups both need
// -- no per-module UI logic lives here.
//
// R67 D-29 (audit R-070). Every read here was `fetch(...).then(r => r.json())`
// with no status check and no catch: an HTTP error parsed cleanly as JSON,
// `?? []` turned it into an empty list, and the one try/finally around it only
// ever cleared the spinner. So a failed load produced a confident "No progress
// entries logged yet." -- the exact defect src/lib/fetch-json.ts was written
// for -- or, when the /api/scope chain rejected, an unhandled rejection and a
// list stuck on its loading state.
//
// Each source now carries its own status, so the screen can say which one
// failed while still showing what it really has.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import WorkProgressFormClient from "./WorkProgressFormClient";
import WorkProgressListClient from "./WorkProgressListClient";
import { fetchJson } from "@/lib/fetch-json";
import { SOURCE_LOADING, SOURCE_OK, sourceError, type SourceStatus } from "@/lib/source-status";

type Entry = { id: string; activityId: string; boqLineItemId: string | null; entryDate: string; quantityDone: string; percentComplete: string; entryBasis: string; remarks: string | null };
type Activity = { id: string; name: string };
type LineItem = { id: string; itemCode: string | null; description: string };
type Boq = { id: string; version: number; status: string };

/**
 * Which BOQ a project's line items should be read from: the approved one, else
 * the submitted one, else the highest version. Exported so the two screens that
 * make this choice cannot drift (Analytics makes it too).
 */
export function currentBoq<T extends Boq>(boqs: T[]): T | null {
  if (boqs.length === 0) return null;
  return boqs.find((b) => b.status === "approved") ?? boqs.find((b) => b.status === "submitted") ?? [...boqs].sort((a, b) => b.version - a.version)[0];
}

export default function WorkProgressPageClient({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [entriesStatus, setEntriesStatus] = useState<SourceStatus>(SOURCE_LOADING);
  const [activitiesStatus, setActivitiesStatus] = useState<SourceStatus>(SOURCE_LOADING);
  const [boqStatus, setBoqStatus] = useState<SourceStatus>(SOURCE_LOADING);

  const load = useCallback(async () => {
    setEntriesStatus(SOURCE_LOADING);
    setActivitiesStatus(SOURCE_LOADING);
    setBoqStatus(SOURCE_LOADING);

    // Independent sources, settled independently: an activities outage must not
    // withhold the entries, and neither must withhold the other's error.
    const [entriesRes, activitiesRes] = await Promise.allSettled([
      fetchJson<{ entries?: Entry[] }>(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`),
      fetchJson<{ activities?: Activity[] }>(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`),
    ]);

    if (entriesRes.status === "fulfilled") {
      setEntries(entriesRes.value.entries ?? []);
      setEntriesStatus(SOURCE_OK);
    } else {
      // Never an empty list where an error belongs.
      setEntries([]);
      setEntriesStatus(sourceError(entriesRes.reason, "Could not load progress entries"));
    }

    if (activitiesRes.status === "fulfilled") {
      setActivities(activitiesRes.value.activities ?? []);
      setActivitiesStatus(SOURCE_OK);
    } else {
      setActivities([]);
      setActivitiesStatus(sourceError(activitiesRes.reason, "Could not load activities"));
    }

    try {
      const boqsRes = await fetchJson<{ boqs?: Boq[] }>(`/api/scope?projectId=${encodeURIComponent(projectId)}`);
      const current = currentBoq(boqsRes.boqs ?? []);
      if (current) {
        const boq = await fetchJson<{ lineItems?: LineItem[] }>(`/api/scope/${current.id}`);
        setLineItems(boq.lineItems ?? []);
      } else {
        setLineItems([]);
      }
      setBoqStatus(SOURCE_OK);
    } catch (err) {
      // The BOQ only supplies the "BOQ line" column's LABELS. Losing it must
      // cost the labels and say so -- never the entries themselves, which is
      // what an uncaught rejection here used to do.
      setLineItems([]);
      setBoqStatus(sourceError(err, "Could not load the BOQ line names"));
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  // R67 A-04. The composer's "Record progress" card is a verb, so it must put
  // the cursor where the work starts -- the form's first field, Activity --
  // rather than dropping the user on the screen to find it. The card navigates
  // here with ?focus=activity and this puts focus on the control.
  //
  // WHY querySelector AND NOT AN id: the form is the kit's FormScreen, whose
  // FieldRenderer generates every control id with React's useId(), so there is
  // no stable id to target from outside. The Activity column is declared first
  // in WorkProgressFormClient's own columns array and is a SELECT, so the
  // first <select> inside the form column IS Activity. If that ever stops
  // being true the focus simply lands elsewhere -- it cannot break the page.
  const formRef = useRef<HTMLDivElement>(null);
  const focusRequest = useSearchParams().get("focus");
  useEffect(() => {
    if (focusRequest !== "activity") return;
    const control = formRef.current?.querySelector<HTMLSelectElement>("select");
    control?.focus();
    control?.scrollIntoView({ block: "center" });
  }, [focusRequest, loading]);

  const activityNameById = new Map(activities.map((a) => [a.id, a.name]));
  const boqLineDescriptionById = new Map(lineItems.map((l) => [l.id, l.itemCode ? `${l.itemCode} -- ${l.description}` : l.description]));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4 h-full min-h-0">
      <div className="min-h-0 border border-ct-border rounded-md overflow-hidden">
        <WorkProgressListClient
          entries={entries}
          activityNameById={activityNameById}
          boqLineDescriptionById={boqLineDescriptionById}
          status={entriesStatus}
          onRetry={() => void load()}
        />
        {/* A source that failed WITHOUT taking the table down still has to say
            so -- a silently missing lookup is how a BOQ line ends up rendering
            as a raw id. */}
        {(activitiesStatus.state === "error" || boqStatus.state === "error") && (
          <p role="status" className="border-t border-ct-border px-4 py-2 text-[12.5px] text-px-error">
            {[activitiesStatus, boqStatus]
              .filter((s): s is { state: "error"; text: string } => s.state === "error")
              .map((s) => s.text)
              .join(" ")}{" "}
            Names may show as ids below.
          </p>
        )}
      </div>
      <div ref={formRef} className="min-h-0 border border-ct-border rounded-md overflow-hidden">
        <WorkProgressFormClient projectId={projectId} onLogged={load} />
      </div>
    </div>
  );
}
