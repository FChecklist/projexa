"use client";

// R42 seq22: thin composition of the FORM (WorkProgressFormClient) and LIST
// (WorkProgressListClient) archetypes on one page, per this seq's own
// "WORK PROGRESS (FORM+LIST)" row. Owns only the entries/lookups both need
// -- no per-module UI logic lives here.
import { useCallback, useEffect, useState } from "react";
import WorkProgressFormClient from "./WorkProgressFormClient";
import WorkProgressListClient from "./WorkProgressListClient";

type Entry = { id: string; activityId: string; boqLineItemId: string | null; entryDate: string; quantityDone: string; percentComplete: string; entryBasis: string; remarks: string | null };
type Activity = { id: string; name: string };
type LineItem = { id: string; itemCode: string | null; description: string };

export default function WorkProgressPageClient({ projectId }: { projectId: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [entriesRes, activitiesRes] = await Promise.all([
        fetch(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()),
        fetch(`/api/work-progress/activities?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json()),
      ]);
      setEntries(entriesRes.entries ?? []);
      setActivities(activitiesRes.activities ?? []);

      const boqsRes = await fetch(`/api/scope?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json());
      const boqs: { id: string; version: number; status: string }[] = boqsRes.boqs ?? [];
      if (boqs.length > 0) {
        const current = boqs.find((b) => b.status === "approved") ?? boqs.find((b) => b.status === "submitted") ?? [...boqs].sort((a, b) => b.version - a.version)[0];
        const boq = await fetch(`/api/scope/${current.id}`).then((r) => r.json());
        setLineItems(boq.lineItems ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const activityNameById = new Map(activities.map((a) => [a.id, a.name]));
  const boqLineDescriptionById = new Map(lineItems.map((l) => [l.id, l.itemCode ? `${l.itemCode} -- ${l.description}` : l.description]));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4 h-full min-h-0">
      <div className="min-h-0 border border-ct-border rounded-md overflow-hidden">
        <WorkProgressListClient entries={entries} activityNameById={activityNameById} boqLineDescriptionById={boqLineDescriptionById} loading={loading} />
      </div>
      <div className="min-h-0 border border-ct-border rounded-md overflow-hidden">
        <WorkProgressFormClient projectId={projectId} onLogged={load} />
      </div>
    </div>
  );
}
