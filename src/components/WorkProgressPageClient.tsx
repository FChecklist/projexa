"use client";

// R42 seq22: thin composition of the FORM (WorkProgressFormClient) and LIST
// (WorkProgressListClient) archetypes on one page. Owns only the entries and
// the activity lookup both need -- no per-module UI logic lives here.
//
// R67 F-24 (audit recommendation R-240). WHAT THIS FILE USED TO DO, AND WHY IT
// COST 7.4 s. It ran a SERIAL chain on mount: entries and activities, then
// /api/scope, then /api/scope/{id} for the resolved revision -- pulling a whole
// BOQ's line items across the wire -- and held the ENTIRE screen behind one
// `loading` flag until the last of them landed. All of that existed to
// translate one column, and it still rendered a raw id when the resolution
// missed.
//
// Now: entries and activities go out TOGETHER (allSettled -- a failing activity
// lookup must not blank the table, and a failing entries read must not be
// reported as "nothing logged yet"), the table renders the moment the entries
// arrive because the activity and BOQ-line names are already ON those rows, and
// the Activity select fills in separately behind its own placeholder. The two
// scope calls are gone from this screen entirely.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isAbortError } from "@/lib/module-list-state";
import WorkProgressFormClient from "./WorkProgressFormClient";
import WorkProgressListClient, { type Entry } from "./WorkProgressListClient";

export type Activity = { id: string; name: string; unit: string | null };

/** One lookup's three honest states, the same shape src/lib/use-lookup.ts gives
 *  a create form's dropdown (R67 F-19). */
export type ActivityLookup = { status: "loading" | "ready" | "error"; options: Activity[]; error?: string };

/** The backend's OWN sentence when it gave one -- the thrown errors below
 *  already carry a complete message, so prefixing a second context onto them
 *  (fetch-json's errorMessage) would print it twice. */
function reasonText(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

export default function WorkProgressPageClient({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [entriesLoading, setEntriesLoading] = useState(true);
  const [activities, setActivities] = useState<ActivityLookup>({ status: "loading", options: [] });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setEntriesLoading(true);
      setActivities((prev) => (prev.status === "ready" ? prev : { status: "loading", options: [] }));

      const [entriesR, activitiesR] = await Promise.allSettled([
        fetch(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`, { signal }).then(async (r) => {
          // Status before body: an error body parses perfectly well as JSON,
          // and treating it as data is how a failed read becomes an empty table.
          const body = await r.json().catch(() => null);
          if (!r.ok) throw new Error(body?.error ?? `Couldn't load progress entries (HTTP ${r.status})`);
          return body as { entries?: Entry[] };
        }),
        fetch(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`, { signal }).then(async (r) => {
          const body = await r.json().catch(() => null);
          if (!r.ok) throw new Error(body?.error ?? `Couldn't load activities (HTTP ${r.status})`);
          return body as { activities?: Activity[] };
        }),
      ]);

      // A cancelled read is not a failure and must not reach a screen the user
      // has already left.
      if (signal?.aborted) return;

      if (entriesR.status === "fulfilled") {
        setEntries(entriesR.value.entries ?? []);
        setEntriesError(null);
      } else if (!isAbortError(entriesR.reason, signal)) {
        setEntries([]);
        setEntriesError(reasonText(entriesR.reason, "Couldn't load progress entries."));
      }
      setEntriesLoading(false);

      if (activitiesR.status === "fulfilled") {
        setActivities({ status: "ready", options: activitiesR.value.activities ?? [] });
      } else if (!isAbortError(activitiesR.reason, signal)) {
        setActivities({ status: "error", options: [], error: reasonText(activitiesR.reason, "Couldn't load activities.") });
      }
    },
    [projectId]
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
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
    // F-24 renamed the page's single `loading` flag, which this effect used to
    // depend on, into per-source state. The honest dependency is the one that
    // decides when the Activity control is actually there to receive focus:
    // its own lookup status.
  }, [focusRequest, activities.status]);

  // F-24: the activityNameById / boqLineDescriptionById maps that used to be
  // built here are gone. The names now arrive ON the entry rows (the backend
  // resolves them in the same statement), so there is nothing left to translate
  // in the browser -- and nothing that can fall back to a raw id.

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4 h-full min-h-0">
      <div className="min-h-0 border border-ct-border rounded-md overflow-hidden">
        {/* R67 F-31: the list's own 8 s "taking longer than usual [Retry]"
            re-issues THIS page's read, so the retry the user is offered is the
            one that actually refills the table. */}
        <WorkProgressListClient
          entries={entries}
          loading={entriesLoading}
          loadError={entriesError}
          onRetry={() => void load()}
        />
      </div>
      {/* ref: A-04's ?focus=activity lands the cursor on the first field. */}
      <div ref={formRef} className="min-h-0 border border-ct-border rounded-md overflow-hidden">
        {/* The form no longer fetches activities of its own -- this page
            already has them, and two components asking the same endpoint on
            the same screen is one of the duplicate calls R-240 counted. */}
        <WorkProgressFormClient projectId={projectId} activities={activities} onLogged={() => load()} />
      </div>
    </div>
  );
}
