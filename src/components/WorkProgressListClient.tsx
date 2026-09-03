"use client";

// R42 seq22 (M28 LIST archetype, S3 module 3/3): registry-driven Work
// Progress history on the kit's ListScreen -- same pattern as
// PermitsListClient.tsx (seq21). Activity/BOQ-line names are resolved
// client-side against the same lookups the form already fetches, passed in
// as props rather than re-fetched here.
import { ListScreen, ScreenFrame, StatusBadge, type ScreenColumn, type StatusTone } from "@fchecklist/veridian-ui-kit/screens";

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

export default function WorkProgressListClient({
  entries,
  activityNameById,
  boqLineDescriptionById,
  loading,
  frameless = false,
  boqLoading = false,
}: {
  entries: Entry[];
  activityNameById: Map<string, string>;
  boqLineDescriptionById: Map<string, string>;
  loading: boolean;
  /**
   * R67 E-24 (R-210): render WITHOUT this component's own ScreenFrame.
   *
   * This list is mounted in two places. On /work-progress it is the screen,
   * and it owns its breadcrumb and its Filter/Export header actions. Inside
   * AnalyticalScreen it is the table SLOT, and AnalyticalScreen already
   * renders a frame with its own Filter and Export -- so the nesting put TWO
   * controls labelled "Filter (Not yet available)" and two labelled "Export"
   * on one screen. Frameless is how the slot case stops doing that; the
   * enclosing screen's own actions are the real ones.
   */
  frameless?: boolean;
  /**
   * R67 E-24: the BOQ line descriptions arrive on a slower second round trip.
   * True while they are still in flight, so the cell can show the line
   * REFERENCE in grey rather than pretending the line has no description.
   */
  boqLoading?: boolean;
}) {
  const rows = entries.map((e) => ({
    ...e,
    activityName: activityNameById.get(e.activityId) ?? e.activityId,
    boqLineDescription: e.boqLineItemId ? (boqLineDescriptionById.get(e.boqLineItemId) ?? e.boqLineItemId) : null,
  }));

  const list = loading ? (
    <p className="px-4 py-6 text-[13px] text-ct-muted">Loading…</p>
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
        boqLineDescription: (row) => {
          const entry = row as unknown as Entry;
          if (!entry.boqLineItemId) return <span className="text-ct-muted">—</span>;
          const description = boqLineDescriptionById.get(entry.boqLineItemId);
          if (description) return <span>{description}</span>;
          // R67 E-24: the reference, in grey, while the BOQ read is still in
          // flight -- the table renders on the first round trip instead of
          // waiting for the slowest one, and a grey reference says "still
          // resolving" rather than "this line has no description".
          return (
            <span className="text-ct-muted" title={boqLoading ? "Loading the BOQ line description…" : undefined}>
              {entry.boqLineItemId}
            </span>
          );
        },
      }}
    />
  );

  if (frameless) return list;

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
      {list}
    </ScreenFrame>
  );
}
