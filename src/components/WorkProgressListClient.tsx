"use client";

// R42 seq22 (M28 LIST archetype, S3 module 3/3): registry-driven Work
// Progress history on the kit's ListScreen -- same pattern as
// PermitsListClient.tsx (seq21). Activity/BOQ-line names are resolved
// client-side against the same lookups the form already fetches, passed in
// as props rather than re-fetched here.
//
// R67 lane D22 (item D-64, rec R-230): the "BOQ line" column used to print a
// 25-character cuid. It printed one because nothing joined the entry to the
// line it names -- this screen's own fallback was a client-side lookup against
// whichever BOQ the FORM beside it happened to have loaded, so an entry
// recorded against any other revision fell through to `?? e.boqLineItemId` and
// rendered the raw id. VERIDIAN now joins the line server-side
// (listProgressEntries -> attachBoqLines), so the cell reads
// "R60SK-A — R60 skiphop sub" and links to the line on its own BOQ page.
import Link from "next/link";
import { ListScreen, ScreenFrame, StatusBadge, type ScreenColumn, type StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { boqLineHref, boqLineLabel } from "@/lib/boq-line-options";

export type EntryBoqLine = {
  boqLineId: string;
  code: string | null;
  description: string;
  unit: string;
  qtyTotal: number;
  qtyDone: number;
  boqId: string;
};

type Entry = {
  id: string;
  activityId: string;
  boqLineItemId: string | null;
  boqLine?: EntryBoqLine | null;
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
  loading,
}: {
  entries: Entry[];
  activityNameById: Map<string, string>;
  loading: boolean;
}) {
  const rows = entries.map((e) => ({
    ...e,
    activityName: activityNameById.get(e.activityId) ?? e.activityId,
    // No `?? e.boqLineItemId` fallback any more, deliberately: an unresolvable
    // line renders as the en-dash the kit uses for every empty value. A cell
    // that quietly falls back to an id is how the id got here in the first
    // place.
    boqLineDescription: e.boqLine ? boqLineLabel(e.boqLine) : null,
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
      {loading ? (
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
            // The line is a link to itself on its own BOQ page -- the question
            // "which line is this and how much of it is left" is one click away
            // instead of a copy-paste of an id into a search box.
            boqLineDescription: (row) => {
              const line = (row as unknown as Entry).boqLine;
              if (!line) return <span className="text-ct-muted">–</span>;
              return (
                <Link href={boqLineHref(line.boqId, line.boqLineId)} className="underline underline-offset-2">
                  {boqLineLabel(line)}
                </Link>
              );
            },
          }}
        />
      )}
    </ScreenFrame>
  );
}
