"use client";

// R42 seq22: thin composition of the FORM (WorkProgressFormClient) and LIST
// (WorkProgressListClient) archetypes on one page, per this seq's own
// "WORK PROGRESS (FORM+LIST)" row. Owns only the entries/lookups both need
// -- no per-module UI logic lives here.
import { useCallback, useEffect, useState } from "react";
import WorkProgressFormClient from "./WorkProgressFormClient";
import WorkProgressListClient, { type EntryBoqLine } from "./WorkProgressListClient";

type Entry = { id: string; activityId: string; boqLineItemId: string | null; boqLine?: EntryBoqLine | null; entryDate: string; quantityDone: string; percentComplete: string; entryBasis: string; remarks: string | null };
type Activity = { id: string; name: string };

export default function WorkProgressPageClient({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  // R67 lane D22 (item D-64): the two extra round trips that used to happen
  // here -- fetch every BOQ, then fetch the whole current one -- existed only
  // to turn each entry's boq_line_item_id into words, and got it wrong for any
  // entry recorded against a different revision. VERIDIAN now joins the line
  // onto the entry, so this loads exactly what the screen shows.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [entriesRes, activitiesRes] = await Promise.all([
        fetch(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()),
        fetch(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()),
      ]);
      setEntries(entriesRes.entries ?? []);
      setActivities(activitiesRes.activities ?? []);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const activityNameById = new Map(activities.map((a) => [a.id, a.name]));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4 h-full min-h-0">
      <div className="min-h-0 border border-ct-border rounded-md overflow-hidden">
        <WorkProgressListClient entries={entries} activityNameById={activityNameById} loading={loading} />
      </div>
      <div className="min-h-0 border border-ct-border rounded-md overflow-hidden">
        <WorkProgressFormClient projectId={projectId} onLogged={load} />
      </div>
    </div>
  );
}
