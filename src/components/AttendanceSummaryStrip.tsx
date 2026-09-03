// R67 F-30 (audit recommendation R-274) -- "how did today go", above the tabs.
//
// The Manpower screen used to make a foreman open the Attendance tab and read
// a table to answer the one question they open the screen for: who turned up
// today. This states it, in its own <Suspense> boundary, from the SAME upstream
// call that fetches the roster (see getLabourLanding) -- so it costs no extra
// request and streams independently of the table below it.
//
// A server component: it renders a figure the server already has and needs no
// interactivity of its own. The day is shown explicitly rather than implied by
// the word "today", because a summary is only useful if you can see which day
// it is about.
import { formatDate } from "@/lib/format-date";
// R67 D-61 (swept at the merge): this strip's labour-cost figure was the last
// hand-rolled money format on the screen. formatMoney() puts the currency code
// in front for the same reason and pins the locale, which the inline
// toLocaleString did not.
import { formatMoney } from "@/lib/format-money";
import type { LabourAttendanceSummary } from "@/lib/module-list-source";

function Figure({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-sm font-medium tabular-nums text-px-ink">{value}</span>
      <span className="text-xs text-px-muted">{label}</span>
    </span>
  );
}

export function AttendanceSummaryStrip({
  summary,
  errorMessage,
  currencyCode,
}: {
  summary: LabourAttendanceSummary | null;
  /** The backend's own words when the landing could not be read. */
  errorMessage?: string | null;
  currencyCode?: string;
}) {
  if (errorMessage) {
    return (
      <div
        role="alert"
        data-state="error"
        className="rounded-md border border-px-error-border bg-px-error-light px-4 py-2 text-sm text-px-error"
      >
        {errorMessage}
      </div>
    );
  }

  if (!summary) return null;

  // Zero recorded is an ANSWER, not an absence: "nobody has marked attendance
  // for this day yet" is exactly what a foreman needs to know at 9 a.m., and
  // hiding the strip would leave them unable to tell that from a failed read.
  return (
    <div
      data-state={summary.recorded === 0 ? "empty" : "ready"}
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border px-4 py-2.5"
      style={{ borderColor: "var(--color-ct-border)" }}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-px-muted">
        Attendance on {formatDate(summary.date)}
      </span>
      {summary.recorded === 0 ? (
        <span className="text-sm text-px-muted">Nothing marked yet.</span>
      ) : (
        <>
          <Figure label="present" value={summary.present} />
          <Figure label="half day" value={summary.halfDay} />
          <Figure label="absent" value={summary.absent} />
          <Figure
            label="labour cost"
            value={formatMoney(summary.totalCost, { currency: currencyCode ?? null })}
          />
        </>
      )}
    </div>
  );
}

/** The strip's own skeleton, for its <Suspense> fallback. */
export function AttendanceSummaryStripSkeleton() {
  return (
    <div
      data-state="loading"
      aria-busy="true"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border px-4 py-2.5"
      style={{ borderColor: "var(--color-ct-border)" }}
    >
      <span className="text-xs font-medium uppercase tracking-wide text-px-muted">Attendance</span>
      <span className="h-4 w-16 animate-pulse rounded bg-px-cloud" />
      <span className="h-4 w-16 animate-pulse rounded bg-px-cloud" />
      <span className="h-4 w-16 animate-pulse rounded bg-px-cloud" />
      <span className="h-4 w-24 animate-pulse rounded bg-px-cloud" />
    </div>
  );
}

export default AttendanceSummaryStrip;
