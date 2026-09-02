"use client";

// R42 seq22 (M28 LIST archetype, S3 module 3/3): registry-driven Work
// Progress history on the kit's ListScreen -- same pattern as
// PermitsListClient.tsx (seq21).
//
// R67 F-24 (audit recommendation R-240): the Activity and BOQ-line names are
// no longer resolved on the client at all. They used to come from lookups the
// page fetched separately -- entries, then activities, then /api/scope, then
// one /api/scope/{id} per revision -- and when that chain missed, the BOQ cell
// rendered a raw id like "e5eibnze72n8u2y3aoeok". VERIDIAN now LEFT JOINs both
// and sends activityName / boqItemCode / boqDescription with each entry, so the
// cell reads "R60SK — R60 skiphop root" and can never fall back to an id.
import { EMPTY_VALUE_DISPLAY, ListScreen, ScreenFrame, StatusBadge, type ScreenColumn, type StatusTone } from "@fchecklist/veridian-ui-kit/screens";

export type Entry = {
  id: string;
  activityId: string;
  boqLineItemId: string | null;
  entryDate: string;
  quantityDone: string;
  percentComplete: string;
  entryBasis: string;
  remarks: string | null;
  // R67 F-24: resolved server-side. activityName is null only when the
  // activity row is gone; the BOQ pair is null when the entry has no BOQ link
  // (boq_line_item_id is nullable and ON DELETE SET NULL).
  activityName?: string | null;
  boqItemCode?: string | null;
  boqDescription?: string | null;
};

const COLUMNS: ScreenColumn[] = [
  { label: "Date", field: "entryDate", type: "date", importance: "High" },
  { label: "Activity", field: "activityName", type: "text", importance: "High" },
  { label: "BOQ line", field: "boqLineDescription", type: "text", importance: "High" },
  { label: "Qty done", field: "quantityDone", type: "number", importance: "High" },
  { label: "% complete", field: "percentComplete", type: "number", importance: "High" },
  { label: "Basis", field: "entryBasis", type: "text", importance: "Medium" },
  { label: "Remarks", field: "remarks", type: "text", importance: "Low" },
];

function progressTone(pct: number): StatusTone {
  if (pct >= 100) return "done";
  if (pct >= 50) return "running";
  return "waiting";
}

/**
 * "R60SK — R60 skiphop root", or just the description when the line carries no
 * item code. NEVER the id: an entry whose BOQ line was deleted has no name to
 * show, and an em-dash is the honest answer -- showing the raw id instead was
 * the defect R-240 reported.
 */
export function boqLineLabel(entry: Entry): string | null {
  if (!entry.boqLineItemId) return null;
  const code = entry.boqItemCode?.trim();
  const description = entry.boqDescription?.trim();
  if (code && description) return `${code} — ${description}`;
  return description || code || null;
}

export default function WorkProgressListClient({
  entries,
  loading,
  loadError,
}: {
  entries: Entry[];
  loading: boolean;
  /** The backend's own words when the entries could not be read. Never an
   *  empty table over a failed read. */
  loadError?: string | null;
}) {
  const rows = entries.map((e) => ({
    ...e,
    // The kit's own GLOBAL rule: an empty value renders as the en-dash, never
    // blank -- and, here, never as the underlying id either.
    activityName: e.activityName ?? EMPTY_VALUE_DISPLAY,
    boqLineDescription: boqLineLabel(e) ?? EMPTY_VALUE_DISPLAY,
  }));

  return (
    // R42 seq23 live-user finding: same GLOBAL rule as PermitsListClient's
    // own fix -- Filter/Export shown disabled-with-reason rather than
    // omitted (never HIDDEN) or faked as live. +New is intentionally
    // omitted here, not hidden-by-oversight: this LIST is already paired
    // directly with the FORM (WorkProgressPageClient's other column), so a
    // separate "+ New" would just duplicate what's already on screen.
    <ScreenFrame
      breadcrumb="Work Progress"
      exportAction={{ label: "Export", disabledReason: "Not yet available" }}
      filterAction={{ label: "Filter", disabledReason: "Not yet available" }}
      messages={loadError ? [{ level: "error", text: loadError }] : []}
    >
      {loadError ? null : loading ? (
        <p className="px-4 py-6 text-[13px] text-ct-muted">Loading progress entries…</p>
      ) : (
        <ListScreen
          functionId="work-progress.list"
          columns={COLUMNS}
          rows={rows as unknown as Record<string, unknown>[]}
          getRowId={(row) => row.id as string}
          emptyStateLabel="No progress entries logged yet."
          renderCell={{
            percentComplete: (row) => {
              const pct = Number((row as unknown as Entry).percentComplete);
              return <StatusBadge tone={progressTone(pct)} label={`${pct}%`} />;
            },
          }}
        />
      )}
    </ScreenFrame>
  );
}
