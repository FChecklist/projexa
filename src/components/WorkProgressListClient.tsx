"use client";

// R42 seq22 (M28 LIST archetype, S3 module 3/3): registry-driven Work
// Progress history on the kit's ListScreen -- same pattern as
// PermitsListClient.tsx (seq21). Activity/BOQ-line names are resolved
// client-side against the same lookups the form already fetches, passed in
// as props rather than re-fetched here.
//
// R67 D-55 / D-65: this pane used to take a bare `loading: boolean` and an
// entries array, and its parent handed it `entriesRes.entries ?? []` from a
// body whose status was never read. On a 500 the kit's ListScreen printed
// its own emptyStateLabel -- "No progress entries logged yet." -- for a
// project with a hundred entries, and there was no error anywhere on the
// screen to contradict it. The pane now takes the read's OUTCOME, and the
// kit's ListScreen is only mounted when there are actually rows to show
// (D-09: the kit is not changed, so it is never handed rows: [] and never
// gets the chance to make that claim on our behalf).
import { useRouter } from "next/navigation";
import { ListScreen, ScreenFrame, StatusBadge, type ScreenColumn, type StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import PaneState from "@/components/PaneState";
import { recordCountLabel, type PaneStatus } from "@/lib/pane-state";

type Entry = {
  id: string;
  activityId: string;
  boqLineItemId: string | null;
  entryDate: string;
  quantityDone: string;
  percentComplete: string;
  entryBasis: string;
  remarks: string | null;
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

// R67 D-67: `projectId` is what makes a row clickable. /work-progress/[id]
// selects the entry out of the project's own list (there is no per-entry
// endpoint in either repo), so the destination has to carry the project --
// which is also what makes the object page bookmarkable.
export default function WorkProgressListClient({
  entries,
  activityNameById,
  boqLineDescriptionById,
  status,
  error,
  onRetry,
  loadedAt,
  startedAt,
  projectId,
  projectName,
}: {
  entries: Entry[];
  activityNameById: Map<string, string>;
  boqLineDescriptionById: Map<string, string>;
  /** The read's own state. There is no boolean here on purpose. */
  status: PaneStatus;
  error?: { status?: number | null; message?: string | null } | null;
  onRetry?: () => void;
  loadedAt?: Date | null;
  startedAt?: number | null;
  projectId?: string;
  projectName?: string | null;
}) {
  const router = useRouter();
  const rows = entries.map((e) => ({
    ...e,
    activityName: activityNameById.get(e.activityId) ?? e.activityId,
    boqLineDescription: e.boqLineItemId ? (boqLineDescriptionById.get(e.boqLineItemId) ?? e.boqLineItemId) : null,
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
      <div className="px-4 py-3">
        {/* The count is an en-dash until a read has actually established it --
            "0 records" over a failure is a claim nobody made. */}
        <p className="pb-2 text-[12px] text-px-muted">{recordCountLabel(status, rows.length)}</p>
        <PaneState
          status={status}
          entity="progress entries"
          projectName={projectName}
          startedAt={startedAt}
          error={error}
          rowCount={rows.length}
          skeletonColumns={COLUMNS.map((c) => c.label)}
          emptyMessage="No progress entries logged yet."
          lastLoadedAt={loadedAt}
          onRetry={onRetry}
        >
          <ListScreen
            functionId="work-progress.list"
            columns={COLUMNS}
            rows={rows as unknown as Record<string, unknown>[]}
            getRowId={(row) => row.id as string}
            // R67 D-67: a Daily Entry row used to do nothing at all when
            // clicked. It now opens the entry, where the site photo lives.
            onRowClick={
              projectId
                ? (row) =>
                    router.push(
                      `/work-progress/${row.id as string}?projectId=${encodeURIComponent(projectId)}`
                    )
                : undefined
            }
            // Unreachable by construction -- PaneState only renders these
            // children when rowCount > 0 -- but the kit requires the prop,
            // and a sentence that can never be shown is safer than one that
            // could be shown over a failure.
            emptyStateLabel="No progress entries logged yet."
            renderCell={{
              percentComplete: (row) => {
                const pct = Number((row as unknown as Entry).percentComplete);
                return <StatusBadge tone={progressTone(pct)} label={`${pct}%`} />;
              },
            }}
          />
        </PaneState>
      </div>
    </ScreenFrame>
  );
}
