"use client";

// R42 seq22: thin composition of the FORM (WorkProgressFormClient) and LIST
// (WorkProgressListClient) archetypes on one page, per this seq's own
// "WORK PROGRESS (FORM+LIST)" row. No per-module UI logic lives here.
//
// R67 F-05 (R-075) -- WHAT CHANGED AND WHY IT MATTERED. This component used to
// fetch the entries and activities, and THEN, serially, GET /api/scope (the
// whole BOQ list with every line item of every revision, measured at
// 1.5-4.4 s) and GET /api/scope/{id} -- purely to turn each entry's
// boqLineItemId into a readable "A-102 -- 230mm blockwork". The Analytics tab
// repeated the identical three-hop chain on switch. 15 requests, 7.4 s to
// network idle, on a screen whose backend answers /work-progress in
// 400-831 ms.
//
// Both scope hops are gone: compliance-tracker's listProgressEntries() now
// joins activityName / boqItemCode / boqLineDescription / unit onto every
// entry inside the transaction it already holds. The entries themselves come
// from WorkProgressDataProvider, which the Analytics tab shares, so switching
// tabs costs nothing. The list renders the moment the entries resolve --
// activities are the form select's business and never gate it.
import WorkProgressFormClient from "./WorkProgressFormClient";
import WorkProgressListClient from "./WorkProgressListClient";
import { useWorkProgressData } from "./WorkProgressDataProvider";

export default function WorkProgressPageClient({ projectId }: { projectId: string }) {
  const { entries, entriesLoading, entriesError, reload } = useWorkProgressData();

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4 h-full min-h-0">
      <div className="min-h-0 border border-ct-border rounded-md overflow-hidden">
        <WorkProgressListClient entries={entries} loading={entriesLoading} loadError={entriesError} onRetry={reload} />
      </div>
      <div className="min-h-0 border border-ct-border rounded-md overflow-hidden">
        <WorkProgressFormClient projectId={projectId} onLogged={reload} />
      </div>
    </div>
  );
}
