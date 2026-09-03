// R67 F-25 (audit recommendation R-241) -- what the Attendance tab actually
// asks for.
//
// PROJEXA's Manpower screen used to fetch a project's ENTIRE attendance log,
// undated, on every landing -- for a tab it opens closed. A site with 40
// workers produces 40 rows a day, so that payload grows without bound and the
// one day a foreman actually wants, today, is buried in it.
//
// The question is dated, so the query is: one day by default, or the week
// behind it when the user asks for earlier days. Kept out of the component so
// the date arithmetic -- the part that is easy to get wrong by a day and
// impossible to see in a screenshot -- is testable directly.

/** How far back "Show earlier days" reaches, INCLUSIVE of the chosen day. */
export const EARLIER_DAYS = 7;

/**
 * A plain YYYY-MM-DD in the READER'S OWN timezone.
 *
 * Deliberately not toISOString().slice(0, 10), which converts to UTC first: at
 * 01:00 in Dubai (UTC+4) that returns YESTERDAY, so a foreman marking the
 * morning's attendance would be shown the previous day's rows and told there
 * are none. attendance_date is a plain date column with no timezone of its own,
 * so the reader's local calendar day is the correct reading of "today".
 */
export function localDay(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** `day` moved by `offsetDays`, still as a local YYYY-MM-DD. Parsed at local
 *  midnight (the `T00:00:00` matters: a bare "2026-09-02" is parsed as UTC). */
export function shiftDay(day: string, offsetDays: number): string {
  const parsed = new Date(`${day}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return day;
  parsed.setDate(parsed.getDate() + offsetDays);
  return localDay(parsed);
}

/**
 * The attendance read for one day, or for the `EARLIER_DAYS` window ending on
 * it. `?date=` is an equality upstream (it can use the
 * (project_id, attendance_date) index directly); `?from=`/`?to=` is an
 * inclusive range.
 */
export function attendanceQuery(projectId: string, day: string, showEarlier: boolean): string {
  const params = new URLSearchParams({ projectId });
  if (showEarlier) {
    params.set("from", shiftDay(day, -(EARLIER_DAYS - 1)));
    params.set("to", day);
  } else {
    params.set("date", day);
  }
  return `/api/attendance?${params.toString()}`;
}
