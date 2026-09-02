"use client";

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
import { useCallback, useEffect, useState } from "react";
import WorkProgressFormClient from "./WorkProgressFormClient";
import WorkProgressListClient from "./WorkProgressListClient";
import {
  readWorkProgress,
  type ProgressActivity,
  type ProgressEntry,
  type ProgressLineItem,
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
  const [lineItems, setLineItems] = useState<ProgressLineItem[]>([]);
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
    setLineItems(result.lineItems);

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

  const activityNameById = new Map(activities.map((a) => [a.id, a.name]));
  const boqLineDescriptionById = new Map(
    lineItems.map((l) => [l.id, l.itemCode ? `${l.itemCode} -- ${l.description}` : l.description])
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4 h-full min-h-0">
      <div className="min-h-0 border border-ct-border rounded-md overflow-hidden">
        <WorkProgressListClient
          projectId={projectId}
          projectName={projectName}
          entries={entries}
          activityNameById={activityNameById}
          boqLineDescriptionById={boqLineDescriptionById}
          status={status}
          error={error}
          onRetry={() => void load()}
          loadedAt={loadedAt}
          startedAt={startedAt}
        />
      </div>
      <div className="min-h-0 border border-ct-border rounded-md overflow-hidden">
        <WorkProgressFormClient projectId={projectId} onLogged={() => void load()} />
      </div>
    </div>
  );
}
