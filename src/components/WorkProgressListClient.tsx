"use client";

// R42 seq22 (M28 LIST archetype, S3 module 3/3): registry-driven Work
// Progress history on the kit's ListScreen -- same pattern as
// PermitsListClient.tsx (seq21). Activity/BOQ-line names are resolved
// client-side against the same lookups the form already fetches, passed in
// as props rather than re-fetched here.
import { ListScreen, ScreenFrame, StatusBadge, type ScreenColumn, type StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { TableLoadingRows } from "@/components/TableLoadingRows";
import DataLoadError from "@/components/DataLoadError";
import type { WorkProgressEntry } from "./WorkProgressDataProvider";

// R67 F-05: the activity name and the BOQ line now arrive ON the entry,
// joined server-side. This component used to receive two Map props built by
// its parent from a separate /api/scope + /api/scope/{id} round trip, which is
// exactly the chain that made this screen 7.4 s to network idle.
type Entry = WorkProgressEntry;

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

export default function WorkProgressListClient({
  entries,
  loading,
  loadError,
  onRetry,
}: {
  entries: Entry[];
  loading: boolean;
  loadError?: string | null;
  onRetry?: () => void;
}) {
  const rows = entries.map((e) => ({
    ...e,
    // A missing name is shown as an em dash, not as the raw uuid the id would
    // print -- an id in a "Activity" column reads as data, and it is not.
    activityName: e.activityName ?? "—",
    boqLineDescription: e.boqItemCode
      ? `${e.boqItemCode} -- ${e.boqLineDescription ?? ""}`.trim().replace(/ --$/, "")
      : e.boqLineDescription,
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
      messages={[]}
    >
      {/* R67 F-05: the real column headers while loading, not the word
          "Loading…" over an empty pane. */}
      {loading ? (
        <TableLoadingRows headers={COLUMNS.map((c) => c.label)} rows={4} caption="Loading progress entries..." />
      ) : loadError ? (
        <DataLoadError messages={[loadError]} onRetry={onRetry ?? (() => {})} />
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
