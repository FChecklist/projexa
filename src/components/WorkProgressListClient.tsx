"use client";

// R42 seq22 (M28 LIST archetype, S3 module 3/3): registry-driven Work
// Progress history on the kit's ListScreen -- same pattern as
// PermitsListClient.tsx (seq21). Activity/BOQ-line names are resolved
// client-side against the same lookups the form already fetches, passed in
// as props rather than re-fetched here.
//
// R67 D-29 (audit R-070/R-080). Two things were wrong with this list's states.
// The loading state was the bare word "Loading…", which says nothing about what
// is coming and moves every control when the table arrives; and there was no
// error state at all, because neither caller had a catch -- a failed read left
// the word "Loading…" on screen for the rest of the session.
//
// It now takes a SourceStatus rather than a boolean, so it can render the three
// answers a read actually has: still running (a skeleton carrying the real
// column headers, plus the elapsed seconds once it passes 5 s), failed (the
// backend's own words and a Retry, inside this card), or done.
//
// `framed` exists because this component is reused wholesale as the table half
// of WorkProgressAnalyticalClient's AnalyticalScreen (ANALYTICAL.GLOBAL: "if it
// diverges, the same data renders two ways and users will notice"), and that
// screen draws its OWN Filter | Export header. Two frames meant two Filter
// buttons and two Export buttons on one screen, both disabled, saying the same
// thing twice.
import { ListScreen, ScreenFrame, StatusBadge, type ScreenColumn, type StatusTone } from "@fchecklist/veridian-ui-kit/screens";
import { ELAPSED_LOAD_BUDGET_MS, slowLoadNotice, useElapsedMs } from "@/lib/slow-load";
import type { SourceStatus } from "@/lib/source-status";

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

/** The skeleton, carrying the REAL headers so nothing moves when the rows arrive. */
function LoadingRows({ notice }: { notice: string | null }) {
  return (
    <div aria-busy="true" className="px-4 py-3">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-ct-border text-left text-ct-muted">
            {COLUMNS.map((c) => <th key={c.field} className="py-1.5 pr-4 font-medium">{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {[0, 1, 2].map((row) => (
            <tr key={row} className="border-b border-ct-border">
              {COLUMNS.map((c) => (
                <td key={c.field} className="py-2 pr-4">
                  <span className="block h-3 w-20 animate-pulse rounded bg-ct-cloud" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {notice && <p className="pt-3 text-[12.5px] text-ct-muted">{notice}</p>}
    </div>
  );
}

export default function WorkProgressListClient({
  entries,
  activityNameById,
  boqLineDescriptionById,
  status,
  onRetry,
  framed = true,
}: {
  entries: Entry[];
  activityNameById: Map<string, string>;
  boqLineDescriptionById: Map<string, string>;
  /** R67 D-29: the entries read's own state -- loading, ok, or the reason it failed. */
  status: SourceStatus;
  onRetry?: () => void;
  /** False when this list is the table half of AnalyticalScreen, which draws the header itself. */
  framed?: boolean;
}) {
  const elapsedMs = useElapsedMs(status.state === "loading");
  const notice =
    status.state === "loading"
      ? slowLoadNotice("Still loading progress entries…", elapsedMs, {
          afterMs: ELAPSED_LOAD_BUDGET_MS,
          withElapsed: true,
        })
      : null;

  const rows = entries.map((e) => ({
    ...e,
    activityName: activityNameById.get(e.activityId) ?? e.activityId,
    boqLineDescription: e.boqLineItemId ? (boqLineDescriptionById.get(e.boqLineItemId) ?? e.boqLineItemId) : null,
  }));

  const body =
    status.state === "loading" ? (
      <LoadingRows notice={notice} />
    ) : status.state === "error" ? (
      // Inside the entries card, not a toast and not a silent spinner: the read
      // has failed twice upstream (veridian-client retries once on a timeout) and
      // the only thing left to offer is the reason and a way to try again.
      <div role="alert" className="m-4 space-y-2 rounded-md border border-px-error-border bg-px-error-light p-4 text-[13px] text-px-error">
        <p className="font-medium">Could not load live data</p>
        <p>{status.text}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="underline underline-offset-2">
            Retry
          </button>
        )}
      </div>
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
      exportAction={{ label: "Export", disabledReason: "Not yet available" }}
      filterAction={{ label: "Filter", disabledReason: "Not yet available" }}
      messages={[]}
    >
      {body}
    </ScreenFrame>
  );
}
