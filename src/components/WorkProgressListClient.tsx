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
//
// R67 MERGE (lane D1, folded onto that canonical data layer). Lane D1 rewrote
// this same pane against its own `SourceStatus` per-source state (D-29). Under
// decision D-11 main's data layer is canonical and D-29's THREE substantive
// complaints are already answered by it, better than lane D1 answered them:
//
//   * "the loading state is the bare word 'Loading…'" -- PaneState renders a
//     skeleton carrying the real column headers (skeletonColumns below), so
//     lane D1's own LoadingRows table is a second copy of a component that
//     already exists and is dropped rather than duplicated (D-09).
//   * "no error state at all, a failed read leaves 'Loading…' forever" --
//     PaneState's error branch, with the shared dictionary's words and Retry.
//   * "nothing tells you it is still going" -- PaneState's loadingCaption()
//     counts the elapsed seconds off `startedAt`, which is the same 5 s
//     threshold lane D1's slowLoadNotice() used.
//
// What lane D1 had that main does NOT, and which therefore survives here:
// `framed`. This component is reused wholesale as the table half of
// WorkProgressAnalyticalClient's AnalyticalScreen (ANALYTICAL.GLOBAL: "if it
// diverges, the same data renders two ways and users will notice"), and that
// screen draws its OWN Filter | Export header. Without `framed` the analytics
// tab shows TWO disabled Filter buttons and TWO disabled Export buttons, one
// pair from AnalyticalScreen and one from the ScreenFrame below, both saying
// the same thing. It defaults to true, so WorkProgressPageClient -- which
// wants the frame -- passes nothing and is unaffected.
import { useRouter } from "next/navigation";
import { ListScreen, ScreenFrame, StatusBadge, type ScreenColumn, type StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import PaneState from "@/components/PaneState";
import { recordCountLabel, type PaneStatus } from "@/lib/pane-state";
import { formatDate } from "@/lib/format";

/**
 * "R60SK -- R60 skiphop root", or just the description when the line carries
 * no item code, or null when neither came back. Exported so the rule is
 * asserted where it lives rather than through a rendered table.
 */
export function boqLineLabel(entry: {
  boqLineItemId: string | null;
  boqItemCode?: string | null;
  boqDescription?: string | null;
}): string | null {
  if (!entry.boqLineItemId) return null;
  const code = entry.boqItemCode?.trim();
  const description = entry.boqDescription?.trim();
  if (code && description) return `${code} — ${description}`;
  return description || code || null;
}

type Entry = {
  activityName?: string | null;
  boqItemCode?: string | null;
  boqDescription?: string | null;

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
  status,
  error,
  onRetry,
  loadedAt,
  startedAt,
  projectId,
  projectName,
  framed = true,
}: {
  entries: Entry[];
  /** F-24: only a FALLBACK now, for a row whose activityName did not come
   *  back (an older backend, or an activity deleted since). */
  activityNameById: Map<string, string>;
  /** The read's own state. There is no boolean here on purpose. */
  status: PaneStatus;
  error?: { status?: number | null; message?: string | null } | null;
  onRetry?: () => void;
  loadedAt?: Date | null;
  startedAt?: number | null;
  projectId?: string;
  projectName?: string | null;
  /**
   * R67 D-29. False when this list is the table half of AnalyticalScreen,
   * which draws the Filter | Export header itself. See the merge note at the
   * top of the file.
   */
  framed?: boolean;
}) {
  const router = useRouter();
  const rows = entries.map((e) => ({
    ...e,
    activityName: e.activityName ?? activityNameById.get(e.activityId) ?? e.activityId,
    // F-24: "R60SK -- R60 skiphop root", or just the description when the line
    // carries no item code. NEVER the id -- an entry whose BOQ line was
    // deleted has no name to show, and an em-dash is the honest answer;
    // showing the raw id instead was the defect R-240 reported.
    boqLineDescription: e.boqLineItemId ? boqLineLabel(e) : null,
  }));

  const body = (
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
            // R67 D-74: the kit's ListScreen formats a `type: "date"` column
            // with `d.toLocaleDateString()` and NO arguments -- the runtime's
            // own locale, which is the deployment's on the server pass and
            // the visitor's in the browser. Per D-09 the kit is not changed;
            // renderCell is its own supported way for the app to say what a
            // cell shows, and the column's raw ISO value is left in the row
            // so the kit's sort still orders by date rather than by "02-".
            entryDate: (row) => <>{formatDate((row as unknown as Entry).entryDate)}</>,
            percentComplete: (row) => {
              const pct = Number((row as unknown as Entry).percentComplete);
              return <StatusBadge tone={progressTone(pct)} label={`${pct}%`} />;
            },
          }}
        />
      </PaneState>
    </div>
  );

  if (!framed) return body;

  return (
    // R42 seq23 live-user finding: same GLOBAL rule as PermitsListClient's
    // own fix -- Filter/Export shown disabled-with-reason rather than
    // omitted (never HIDDEN) or faked as live. +New is intentionally
    // omitted here, not hidden-by-oversight: this LIST is already paired
    // directly with the FORM (WorkProgressPageClient's other column), so a
    // separate "+ New" would just duplicate what's already on screen.
    <ScreenFrame
      breadcrumb="Work Progress"
      exportAction={{ label: "Export", disabledReason: "Exporting progress entries is not built yet" }}
      filterAction={{ label: "Filter", disabledReason: "Filtering progress entries is not built yet" }}
      messages={[]}
    >
      {body}
    </ScreenFrame>
  );
}
