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
// PermitsListClient.tsx (seq21).
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
// R67 D-28 (R-069/R-071): the Activity and BOQ-line names are not resolved on
// this side at all. They used to come from a `boqLineDescriptionById` map
// built by WorkProgressPageClient out of ONE BOQ -- whichever its own "current
// BOQ" preference picked -- so an entry recorded against any other revision
// had no name to find and the cell printed a raw cuid. VERIDIAN now LEFT-JOINs
// the activity and the BOQ line of whatever revision the entry actually
// references and returns activityName / boqItemCode / boqDescription / unit on
// the row itself. A missing name is an em-dash, never an id.
//
// R67 INTEGRATION: the join itself is NOT written here any more. F-24's inline
// copy and D-28's pure one were the same rule twice, so this file delegates to
// the pure module's boqLineLabel() -- the one place the list cell, the object
// page's facet and its subtitle all read.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListScreen, ScreenFrame, StatusBadge, type ScreenColumn, type StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import PaneState from "@/components/PaneState";
import { recordCountLabel, type PaneStatus } from "@/lib/pane-state";
import { formatDate } from "@/lib/format";
import { boqLineLabel } from "@/lib/work-progress-report";

export type Entry = {
  id: string;
  activityId: string;
  boqLineItemId: string | null;
  entryDate: string;
  quantityDone: string;
  percentComplete: string;
  entryBasis: string;
  remarks: string | null;
  // Resolved server-side and sent with the row (F-24 / D-28). Optional
  // because an older backend answers without them, which is exactly when the
  // activityNameById fallback below earns its keep.
  activityName?: string | null;
  boqItemCode?: string | null;
  boqDescription?: string | null;
  unit?: string | null;
};

const COLUMNS: ScreenColumn[] = [
  { label: "Date", field: "entryDate", type: "date", importance: "High" },
  { label: "Activity", field: "activityName", type: "text", importance: "High" },
  { label: "BOQ line", field: "boqLineDescription", type: "text", importance: "High" },
  { label: "Qty done", field: "quantityDone", type: "number", importance: "High" },
  // R67 D-28: a quantity with no unit beside it is not a measurement. The unit
  // is the BOQ line's when the entry names one, else the activity's -- resolved
  // server-side so this column can never disagree with the report.
  { label: "Unit", field: "unit", type: "text", importance: "High" },
  { label: "% complete", field: "percentComplete", type: "number", importance: "High" },
  { label: "Basis", field: "entryBasis", type: "text", importance: "Medium" },
  { label: "Remarks", field: "remarks", type: "text", importance: "Low" },
];

function progressTone(pct: number): StatusTone {
  if (pct >= 100) return "done";
  if (pct >= 50) return "running";
  return "waiting";
}

// R67 D-28 x D-67, reconciled by the integration train: a row opens the entry
// at /work-progress/[id]. D-67's note that the destination "has to carry the
// project, because there is no per-entry endpoint in either repo" no longer
// holds -- this lane ships that endpoint (compliance-tracker
// /api/v1/construction/progress/[id]) and the object page resolves the entry
// on its own, so `projectId` is no longer required to make a row clickable and
// a bookmarked /work-progress/{id} works with no query string at all.
export default function WorkProgressListClient({
  entries,
  notice = null,
  activityNameById,
  status,
  error,
  onRetry,
  loadedAt,
  startedAt,
  projectId,
  projectName,
}: {
  entries: Entry[];
  /**
   * R67 D-28: the receipt for a delete that happened on the entry's own page,
   * carried here in the URL because that page unmounts with the navigation.
   * It shows in the persistent message band -- never a toast that has already
   * gone by the time the list finishes loading.
   */
  notice?: string | null;
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
}) {
  const router = useRouter();
  const rows = entries.map((e) => ({
    ...e,
    activityName: e.activityName ?? activityNameById.get(e.activityId) ?? e.activityId,
    // "R60SK — R60 skiphop root", or just the description when the line
    // carries no item code. NEVER the id -- an entry whose BOQ line was
    // deleted has no name to show, and an em-dash is the honest answer;
    // showing the raw id instead was the defect R-240 reported. The rule
    // itself lives in work-progress-report.ts, so this cell and the object
    // page cannot render the same entry two ways.
    boqLineDescription: e.boqLineItemId ? boqLineLabel(e.boqItemCode, e.boqDescription) : null,
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
      // R67 E-18 (R-178): the reason, in words, naming where the capability
      // really is -- never a bare "(Not yet available)".
      exportAction={{ label: "Export", disabledReason: "Export from the Report tab — PDF, XLSX and CSV of these entries against the BOQ" }}
      filterAction={{ label: "Filter", disabledReason: "Filter by period and category on the Report tab" }}
      // R67 D-28: a deletion happens on the entry's own page, which unmounts
      // with the navigation, so its confirmation is carried here in the URL and
      // shown in the persistent band -- never as a toast that has already gone
      // by the time the list finishes loading.
      messages={notice ? [{ level: "info", text: notice }] : []}
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
            // R67 D-67 x D-28: a Daily Entry row used to do nothing at all
            // when clicked. It now opens the entry, where the site photo
            // lives. The project no longer has to travel with it -- the object
            // page reads the entry from its own endpoint -- but it is still
            // passed when known, so Back on that page returns to this list
            // scoped to the project the user was actually in.
            onRowClick={(row) =>
              router.push(
                projectId
                  ? `/work-progress/${row.id as string}?projectId=${encodeURIComponent(projectId)}`
                  : `/work-progress/${row.id as string}`
              )
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
              //
              // R67 D-28: the cell is additionally a REAL anchor, so a row can
              // be middle-clicked or opened in a new tab like every other link
              // in this product -- the kit's own row handler gives Enter/Space
              // and a focus ring, but not that.
              entryDate: (row) => (
                <Link
                  href={
                    projectId
                      ? `/work-progress/${row.id as string}?projectId=${encodeURIComponent(projectId)}`
                      : `/work-progress/${row.id as string}`
                  }
                  prefetch
                  onClick={(e) => e.stopPropagation()}
                  className="underline underline-offset-2 decoration-ct-border hover:decoration-ct-navy"
                >
                  {formatDate((row as unknown as Entry).entryDate)}
                </Link>
              ),
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
