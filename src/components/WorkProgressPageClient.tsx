"use client";

// R67 MERGE (lane D0 x lane F2, item F-24 / audit R-240). WHAT THIS SCREEN
// USED TO DO, AND WHY IT COST 7.4 s. Its read ran a SERIAL chain: entries and
// activities, then /api/scope, then /api/scope/{id} for the resolved revision
// -- pulling a whole BOQ's line items across the wire -- and only then could
// the BOQ column be translated. All four calls existed to fill ONE column, and
// it still rendered a raw id like "e5eibnze72n8u2y3aoeok" when the resolution
// missed. VERIDIAN now LEFT JOINs both names into the progress query
// (compliance-tracker #1579) and sends activityName / boqItemCode /
// boqDescription with each entry, so the two scope calls and the two id->label
// maps are gone from this screen and the cell can never fall back to an id.
//
// Everything lane D0 built here is untouched: the read still comes from the
// tested src/lib/work-progress-reads.ts, the pane still branches on an OUTCOME
// rather than a boolean, and PaneState still owns what the screen says.

// R42 seq22: thin composition of the FORM (WorkProgressFormClient) and LIST
// (WorkProgressListClient) archetypes on one page, per this seq's own
// "WORK PROGRESS (FORM+LIST)" row. Owns only the entries/lookups both need
// -- no per-module UI logic lives here.
//
// R67 D-55 / D-65 -- WHAT CHANGED AND WHY. The load() here was:
//
//     const [entriesRes, activitiesRes] = await Promise.all([
//       fetch(`/api/work-progress?…`).then((r) => r.json()),
//       fetch(`/api/work-progress/activities?…`).then((r) => r.json()),
//     ]);
//     setEntries(entriesRes.entries ?? []);
//
// with a `finally` that cleared `loading` and NO catch. Two faults in five
// lines. A 500 answers `{ error: "…" }`, so `.entries` was undefined and
// `?? []` turned a failed read into an empty one -- the list then printed
// "No progress entries logged yet." with nothing on screen to contradict it.
// And a THROWN fetch (a dropped connection, an abort) rejected the whole
// batch, so `setLoading(false)` did run but nothing was ever set and no
// error was captured -- leaving a pane that had failed looking exactly like
// a project with no entries.
//
// The reads now live in src/lib/work-progress-reads.ts, where they are
// tested, and this file holds only the outcome the list branches on.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import WorkProgressFormClient from "./WorkProgressFormClient";
import WorkProgressListClient from "./WorkProgressListClient";
import {
  readWorkProgress,
  type ProgressActivity,
  type ProgressEntry,
} from "@/lib/work-progress-reads";
import type { PaneStatus } from "@/lib/pane-state";

export default function WorkProgressPageClient({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName?: string | null;
}) {
  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  const [activities, setActivities] = useState<ProgressActivity[]>([]);
  const [status, setStatus] = useState<PaneStatus>("loading");
  const [error, setError] = useState<{ status: number | null; message: string | null } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setStartedAt(Date.now());
    setError(null);

    const result = await readWorkProgress(projectId);
    setActivities(result.activities);

    if (result.entries.status === "error") {
      // The rows already on screen are NOT thrown away -- PaneState labels
      // them "as of 14:32" under the failure, which is more use than a blank
      // pane and is never mistaken for a fresh answer.
      setError({ status: result.entries.httpStatus, message: result.entries.message });
      setStatus("error");
      return;
    }
    setEntries(result.entries.status === "ready" ? result.entries.rows : []);
    setLoadedAt(new Date());
    setStatus("ready");
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

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
  // R67 D-55 replaced this pane's `loading` boolean with a real outcome, so
  // the focus effect re-runs when the read SETTLES rather than when a flag
  // flips -- which is the moment the Activity select actually exists.
  }, [focusRequest, status]);

  // F-24: kept ONLY as the fallback for an entry whose row carries no
  // activityName -- an older backend, or an activity deleted since. The list
  // no longer depends on it, and there is no BOQ map at all any more.
  const activityNameById = new Map(activities.map((a) => [a.id, a.name]));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4 h-full min-h-0">
      <div className="min-h-0 border border-ct-border rounded-md overflow-hidden">
        <WorkProgressListClient
          projectId={projectId}
          projectName={projectName}
          entries={entries}
          activityNameById={activityNameById}
          status={status}
          error={error}
          onRetry={() => void load()}
          loadedAt={loadedAt}
          startedAt={startedAt}
        />
      </div>
      <div ref={formRef} className="min-h-0 border border-ct-border rounded-md overflow-hidden">
        {/* F-24: the page already read this list; handing it down is one
            request saved on a screen that made the same call twice. */}
        <WorkProgressFormClient
          projectId={projectId}
          activities={activities}
          onLogged={() => void load()}
        />
      </div>
    </div>
  );
}
