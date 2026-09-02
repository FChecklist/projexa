"use client";

// R42 seq22: thin composition of the FORM (WorkProgressFormClient) and LIST
// (WorkProgressListClient) archetypes on one page, per this seq's own
// "WORK PROGRESS (FORM+LIST)" row. Owns only the entries both need
// -- no per-module UI logic lives here.
//
// R67 D-28: the BOQ fetch that used to live here is GONE. It existed to build
// a `boqLineDescriptionById` map so the list could turn an entry's
// boq_line_item_id into words -- but it resolved exactly ONE BOQ (approved,
// else submitted, else the highest version), so an entry recorded against any
// other revision fell through to printing its raw id. VERIDIAN now returns the
// activity and BOQ-line names on the entry row itself, joined from the revision
// the entry actually references, so there is nothing left to resolve here and
// the page makes two fetches instead of four.
import { useCallback, useEffect, useState } from "react";
import WorkProgressFormClient from "./WorkProgressFormClient";
import WorkProgressListClient, { type Entry } from "./WorkProgressListClient";

export default function WorkProgressPageClient({ projectId, notice }: { projectId: string; notice?: string | null }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/work-progress?projectId=${encodeURIComponent(projectId)}`).then((r) => r.json());
      setEntries(res.entries ?? []);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4 h-full min-h-0">
      <div className="min-h-0 border border-ct-border rounded-md overflow-hidden">
        <WorkProgressListClient entries={entries} loading={loading} notice={notice} />
      </div>
      <div className="min-h-0 border border-ct-border rounded-md overflow-hidden">
        <WorkProgressFormClient projectId={projectId} onLogged={load} />
      </div>
    </div>
  );
}
