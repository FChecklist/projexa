"use client";

// R42 seq22 (M28 LIST archetype, S3 module 3/3): registry-driven Work
// Progress history on the kit's ListScreen -- same pattern as
// PermitsListClient.tsx (seq21).
//
// R67 D-28 (R-069/R-071): the Activity and BOQ-line names are no longer
// resolved on this side at all. They used to come from a
// `boqLineDescriptionById` map built by WorkProgressPageClient out of ONE
// BOQ -- whichever its own "current BOQ" preference picked -- so an entry
// recorded against any other revision had no name to find and the cell
// printed a raw cuid. VERIDIAN now LEFT-JOINs the activity and the BOQ line of
// whatever revision the entry actually references and returns activityName /
// boqItemCode / boqLineDescription / unit on the row itself. A missing name is
// now an em-dash, never an id.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListScreen, ScreenFrame, StatusBadge, type ScreenColumn, type StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { formatDayMonthYearNumeric } from "@/lib/format-date";
import { boqLineLabel } from "@/components/WorkProgressObjectClient";

export type Entry = {
  id: string;
  activityId: string;
  boqLineItemId: string | null;
  entryDate: string;
  quantityDone: string;
  percentComplete: string;
  entryBasis: string;
  remarks: string | null;
  activityName: string | null;
  boqItemCode: string | null;
  boqLineDescription: string | null;
  unit: string | null;
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

export default function WorkProgressListClient({
  entries,
  loading,
  notice,
}: {
  entries: Entry[];
  loading: boolean;
  notice?: string | null;
}) {
  const router = useRouter();
  const rows = entries.map((e) => ({
    ...e,
    activityName: e.activityName ?? "–",
    boqLineDescription: boqLineLabel(e.boqItemCode, e.boqLineDescription),
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
      // R67 D-28: a deletion happens on the entry's own page, which unmounts
      // with the navigation, so its confirmation is carried here in the URL and
      // shown in the persistent band -- never as a toast that has already gone
      // by the time the list finishes loading.
      messages={notice ? [{ level: "info", text: notice }] : []}
    >
      {loading ? (
        <p className="px-4 py-6 text-[13px] text-ct-muted">Loading…</p>
      ) : (
        <ListScreen
          functionId="work-progress.list"
          columns={COLUMNS}
          rows={rows as unknown as Record<string, unknown>[]}
          getRowId={(row) => row.id as string}
          // R67 D-28: rows open the entry. The kit's own row handler already
          // gives Enter/Space and a focus ring; the Date cell is additionally a
          // REAL anchor so the row can be middle-clicked or opened in a new tab
          // like any other link in this product.
          onRowClick={(row) => router.push(`/work-progress/${row.id as string}`)}
          emptyStateLabel="No progress entries logged yet."
          renderCell={{
            entryDate: (row) => (
              <Link
                href={`/work-progress/${row.id as string}`}
                prefetch
                onClick={(e) => e.stopPropagation()}
                className="underline underline-offset-2 decoration-ct-border hover:decoration-ct-navy"
              >
                {formatDayMonthYearNumeric(String(row.entryDate))}
              </Link>
            ),
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
