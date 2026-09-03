// R46 hydration-mismatch root-cause fix.
//
// `Date.prototype.toLocaleDateString()` / `.toLocaleString()` /
// `.toLocaleTimeString()` called with NO arguments resolve to the RUNTIME's
// own default locale *and* default time zone. On the SERVER (this app's
// Vercel/Node runtime) that default is the server's own ICU locale (UTC time
// zone); in the BROWSER it's whatever the visitor is actually configured
// for -- a different locale for any non-"en-US" visitor (this app ships a
// real "hi" locale, see SUPPORTED_LOCALES in middleware.ts/i18n/request.ts --
// Hindi's Intl digit grouping is the Indian numbering system, not the
// Western one, and its date order/separators differ too), and a different
// time zone for literally any visitor outside UTC (a date-only value near a
// day boundary can format as a DIFFERENT CALENDAR DAY once the time zone
// changes).
//
// Any component that calls one of these three methods directly inside its
// render output -- a table cell, a card, anywhere that isn't gated behind a
// post-mount effect -- produces a DIFFERENT TEXT STRING on the server's SSR
// pass than on the client's first hydration pass whenever locale or time
// zone differ. That's a real, deterministic hydration mismatch: the exact
// same defect class R45 seq4 already fixed twice elsewhere in this app's
// dependency (sessionStorage read directly in ListScreen's render body,
// `new Date().getHours()` read directly in HomeGreeting's render body -- see
// veridian-ui-kit#19) but which this specific call pattern reproduces
// dozens of times across this app's OWN client components (Invoices, GRC,
// Materials, Labour, Documents, Drawings, Employees, Expenses, Payroll,
// Accounting, Scope, Settings, Site Diary, Site Materials, Leads,
// Opportunities, Recruitment, Work Progress, MoMs, Copilot, the VERI Chat
// panel...).
//
// These helpers pin BOTH the locale and the time zone explicitly, so the
// string is byte-identical regardless of which runtime -- or which visitor
// -- produces it. "en-US" matches the convention this codebase's own
// currency formatters already use for numbers (see e.g. AccountingClient's
// `n.toLocaleString("en-US", {...})`); "UTC" matches how every timestamp
// here is actually stored and transmitted (ISO 8601, always UTC) -- there is
// no per-org/per-user time zone preference anywhere in this codebase to
// prefer instead. Existing numeric `.toLocaleString("en-US", ...)` call
// sites are unaffected by this file; they were already hydration-safe.
import { EMPTY_VALUE } from "@/lib/format-number";

const FIXED_LOCALE = "en-US";
const FIXED_TIME_ZONE = "UTC";

/** e.g. "8/25/2026" -- identical on server and client, any visitor. */
export function formatDate(value: Date | string | number): string {
  return new Date(value).toLocaleDateString(FIXED_LOCALE, { timeZone: FIXED_TIME_ZONE });
}

// R67 D-23's formatDayMonthYear USED to live here, implemented with
// toLocaleDateString("en-GB", { month: "short" }). Lane D3 independently added
// a second implementation of the same exported name lower in this file, and the
// D3/D21 merge left both -- a duplicate function implementation git auto-merged
// without flagging. The lower one is the survivor, on merit, and D-23's BOQ-list
// rationale is carried into its doc comment. Measured on this repo's Node
// (v26, CLDR): the en-GB path returns "02 Sept 2026", not the "02 Sep 2026"
// D-23's own copy is written against, and returns the literal string
// "Invalid Date" rather than the en-dash for an unparseable value. Both are
// user-visible, and both are asserted against in format-date.test.ts.

/**
 * R67 D-28: e.g. "25-08-2026" -- the numeric day-first form Work Progress uses
 * across its list, its form and its report, because the module's three surfaces
 * previously each formatted the same stored date their own way ("8/25/2026" in
 * the list, the raw ISO "2026-08-25" in the form's date control, and a third
 * reading in the report), and a site engineer comparing them cannot tell
 * whether they are looking at one entry or three.
 *
 * Deliberately NOT formatDayMonthYear()'s "25 Aug 2026": that helper is the BOQ
 * list's format (R67 D-23), and this is the format D-28 specifies for Work
 * Progress. Both are day-first and unambiguous; they are two REGISTERS of the
 * same reading, and each module uses exactly one.
 *
 * Built from Intl parts rather than a locale string, so no runtime's locale
 * data can reorder or re-separate it -- the output is byte-identical on the
 * server and in every visitor's browser, like every other helper here.
 */
export function formatDayMonthYearNumeric(value: Date | string | number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: FIXED_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("day")}-${part("month")}-${part("year")}`;
}

/** e.g. "8/25/2026, 2:30 PM" -- identical on server and client, any visitor. */
export function formatDateTime(value: Date | string | number): string {
  return new Date(value).toLocaleString(FIXED_LOCALE, { timeZone: FIXED_TIME_ZONE });
}

/** e.g. "2:30:45 PM" -- identical on server and client, any visitor. */
export function formatTime(value: Date | string | number): string {
  return new Date(value).toLocaleTimeString(FIXED_LOCALE, { timeZone: FIXED_TIME_ZONE });
}

// R67 MERGE (D-11, lane E2's E-30 x lane F-01's own doc comment). F-01 asked
// for an "Updated HH:MM" line and named this function formatHourMinute() with
// NO `hour12` option (12-hour, "02:30 PM") -- but no call site of that name
// ever shipped (grepped clean on main and on this lane both), so there was
// nothing to collide with in practice, only in the name. E2's E-30 (R-263)
// needs the SAME name for a REAL, live call site (WorkProgressReportClient's
// run stamp, "Ran in 2.7 s at 14:02") and specifically needs `hour12: false`:
// a report timestamp read day-first elsewhere on the same screen and 12-hour
// here would be its own small inconsistency. Two functions cannot share one
// export, and the one with an actual reader wins the name; F-01's un-called
// 12-hour form is dropped rather than kept under a second name nobody would
// ever import.
//
// MERGE NOTE (integration train, lane D22). Lane D22 added a SECOND
// formatDayMonthYear() here, built on en-GB Intl, for D-63's WhatsApp summary
// sentence. It is dropped rather than kept beside the one already exported
// below: that one is the version an earlier merge already chose on merit,
// because en-GB Intl spells September "Sept" where this product's copy says
// "Sep", and it returns the en-dash rather than the literal string "Invalid
// Date". D-63's call sites take the surviving helper, which has the same
// signature and the day-first form the item asked for.

/**
 * e.g. "14:02" -- the clock time alone, 24-hour, zero-padded.
 *
 * R67 E-30 (R-263). The run stamp reads "Ran in 2.7 s at 14:02", and
 * formatTime() gives "2:30:00 PM" -- seconds nobody needs and a meridiem the
 * sentence did not ask for. Pinned to the same locale and time zone as every
 * other helper here for the same hydration reason; `hour12: false` is stated
 * explicitly because en-US would otherwise ignore the 2-digit hour and print
 * "2:02 PM".
 */
export function formatHourMinute(value: Date | string | number): string {
  return new Date(value).toLocaleTimeString(FIXED_LOCALE, {
    timeZone: FIXED_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * e.g. "01-09-2026" -- day-month-year, zero-padded, hyphen separated.
 *
 * R67 E-34 / E-31 (R-266 / R-264). The sentences these items specify quote the
 * date in words: "No progress was recorded between 01-09-2026 and 02-09-2026".
 * formatDate() gives "9/1/2026", which is the en-US month-first order -- in a
 * sentence about a range, a reader who reads dates day-first sees a different
 * range, and there is nothing in "9/1/2026" that says which convention is in
 * play. Zero-padded day-first with hyphens is unambiguous to both.
 *
 * Built from pinned parts, and from the SAME locale and time zone as every
 * helper here, for the same hydration reason: a date-only value near a day
 * boundary formats as a different calendar day once the time zone moves.
 */
export function formatDateDMY(value: Date | string | number): string {
  const date = new Date(value);
  const day = date.toLocaleDateString(FIXED_LOCALE, { timeZone: FIXED_TIME_ZONE, day: "2-digit" });
  const month = date.toLocaleDateString(FIXED_LOCALE, { timeZone: FIXED_TIME_ZONE, month: "2-digit" });
  const year = date.toLocaleDateString(FIXED_LOCALE, { timeZone: FIXED_TIME_ZONE, year: "numeric" });
  return `${day}-${month}-${year}`;
}

/**
 * e.g. "25 Aug" -- the short day-and-month form a chart caption uses, where a
 * full "8/25/2026" is more precision than the sentence needs.
 *
 * R67 E-25 (R-211). Built from two pinned parts rather than one
 * `{ day, month }` option object because that produces "Aug 25" in en-US, and
 * the caption reads "Only one day logged (25 Aug)". Both parts pin the same
 * locale and time zone as every other helper here, for the same hydration
 * reason.
 */
export function formatDayMonth(value: Date | string | number): string {
  const date = new Date(value);
  const day = date.toLocaleDateString(FIXED_LOCALE, { timeZone: FIXED_TIME_ZONE, day: "numeric" });
  const month = date.toLocaleDateString(FIXED_LOCALE, { timeZone: FIXED_TIME_ZONE, month: "short" });
  return `${day} ${month}`;
}
/**
 * e.g. "03-09-2026 14:02" -- the "as of" stamp every project-dashboard tile
 * carries.
 *
 * R67 E-39 (R-293). Built from the two helpers above rather than from a fresh
 * toLocaleString call, so the date half cannot read month-first while
 * formatDateDMY reads day-first two lines away, and the clock half is the same
 * 24-hour form the report stamps already use. formatDateTime() gives
 * "9/3/2026, 2:02 PM", which is a third convention on the same screen.
 */
export function formatDateTimeDMY(value: Date | string | number): string {
  return `${formatDateDMY(value)} ${formatHourMinute(value)}`;
}

/**
 * e.g. "Sep 2, 2026, 2:30 PM" -- the meeting/MoM shape.
 *
 * R67 G-05 (R-260): MeetingsClient and MeetingObjectClient each carried their
 * own private copy of this, written as
 * `toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })`.
 * Pinning the locale but NOT the time zone fixes half the bug and leaves the
 * worse half: the SSR pass renders in the server's zone (UTC) and the browser
 * in the visitor's, so a meeting at 23:30 UTC is stamped with a different
 * clock time -- and, near a day boundary, a different DATE -- on the two
 * passes. Both now call this, which pins both.
 */
export function formatDateTimeMedium(value: Date | string | number): string {
  return new Date(value).toLocaleString(FIXED_LOCALE, {
    timeZone: FIXED_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ─── R67 D-16: the ORG's date, not the server's ──────────────────────────
//
// The three helpers above are pinned to en-US/UTC for one reason only: they
// must produce the same bytes on the server's SSR pass and in the visitor's
// browser. That fixed the hydration mismatch and is not being changed --
// their constants and their tests stay exactly as they are.
//
// What it did NOT fix is the SECOND defect the same call sites carry: a UAE
// construction org reading "8/25/2026, 2:30:00 PM" -- an American date order,
// a 12-hour clock and a seconds field nobody scheduled a meeting to. The fix
// is not "unpin the locale" (that reintroduces the mismatch); it is to pin it
// to the ORGANISATION's locale and time zone instead of the runtime's, which
// is just as deterministic because both are explicit arguments.
//
// The defaults are the demo org's own settings. They are parameters rather
// than constants because the org-level locale/timeZone/dateFormat columns do
// not exist yet -- they ship with the org date-format work in another lane --
// and a caller that has them (from /api/organization) can pass them today
// without this file changing again.
export const DEFAULT_ORG_LOCALE = "en-GB";
export const DEFAULT_ORG_TIME_ZONE = "Asia/Dubai";

/**
 * e.g. "28 Aug 2026, 10:00" -- the org's date order and a 24-hour clock,
 * with NO seconds. Deterministic for a given (locale, timeZone) pair, so it
 * is hydration-safe exactly the way formatDateTime is.
 *
 * An unparseable or empty value renders an en-dash rather than "Invalid
 * Date": a cell that cannot say when something is scheduled must not claim
 * a date, and "Invalid Date" is a developer's string, not a user's.
 */
export function formatDateTimeOrg(
  value: Date | string | number | null | undefined,
  locale: string = DEFAULT_ORG_LOCALE,
  timeZone: string = DEFAULT_ORG_TIME_ZONE
): string {
  const date = toValidDate(value);
  if (!date) return EMPTY_VALUE;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** e.g. "28 Aug 2026" -- the date half of {@link formatDateTimeOrg}. */
export function formatDateOrg(
  value: Date | string | number | null | undefined,
  locale: string = DEFAULT_ORG_LOCALE,
  timeZone: string = DEFAULT_ORG_TIME_ZONE
): string {
  const date = toValidDate(value);
  if (!date) return EMPTY_VALUE;
  return new Intl.DateTimeFormat(locale, { timeZone, day: "2-digit", month: "short", year: "numeric" }).format(date);
}

// ─── R67 D-46: the ORG's date PATTERN ────────────────────────────────────
//
// formatDateOrg above takes a locale; this takes a pattern, because that is
// what the org-level setting actually is ("dd-MM-yyyy" for the UAE and
// Indian orgs this product serves). The Schedule module used two date forms
// on one screen -- the Gantt grid's en-US strings beside date inputs the
// browser renders in its own locale -- and neither was the org's.
//
// Only three tokens are supported, and an unrecognised pattern falls back to
// the default rather than printing the pattern itself. Inventing a general
// date-pattern engine here would be a second Intl, badly.
export const DEFAULT_ORG_DATE_FORMAT = "dd-MM-yyyy";

const SUPPORTED_ORG_DATE_FORMATS = new Set(["dd-MM-yyyy", "dd/MM/yyyy", "yyyy-MM-dd", "MM/dd/yyyy"]);

/**
 * e.g. formatOrgDate("2026-10-15", "dd-MM-yyyy") === "15-10-2026".
 *
 * The calendar day is resolved in the org's time zone, so a stored timestamp
 * and a date-only value agree about which day they are on.
 */
export function formatOrgDate(
  value: Date | string | number | null | undefined,
  dateFormat: string = DEFAULT_ORG_DATE_FORMAT,
  timeZone: string = DEFAULT_ORG_TIME_ZONE
): string {
  const date = toValidDate(value);
  if (!date) return EMPTY_VALUE;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const pattern = SUPPORTED_ORG_DATE_FORMATS.has(dateFormat) ? dateFormat : DEFAULT_ORG_DATE_FORMAT;
  // One pass, so a substituted value can never be re-matched by a later token.
  return pattern.replace(/yyyy|MM|dd/g, (token) =>
    token === "yyyy" ? get("year") : token === "MM" ? get("month") : get("day")
  );
}

function toValidDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// R67: the date form the product's own sentences use -- "Attendance for
// 02 Sep 2026 saved", "No attendance marked for 02 Sep 2026". Built from a
// fixed month table rather than Intl because EVERY locale Intl offers spells
// September differently in its short form (en-GB gives "Sept", en-US gives
// "Sep"), and the copy these strings appear in is written once, in English,
// with the three-letter form. Same UTC-pinned, hydration-safe posture as the
// three helpers above.
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * e.g. "02 Sep 2026". Returns the en-dash for an unparseable value, never
 * "Invalid Date".
 *
 * R67 D-23 (folded in by the D3 x D21 merge): this is ALSO the BOQ list's
 * format. "8/25/2026" reads as 8 May to half of this product's users (a UAE
 * contractor's site team) and as 25 August to the other half, so the BOQ list,
 * the schedule baselines, the attendance sentences and the roster's attendance
 * history all speak this one day-first form. Nine call sites across both lanes.
 */
export function formatDayMonthYear(value: Date | string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return `${String(date.getUTCDate()).padStart(2, "0")} ${SHORT_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// R67: the all-numeric day-first form ("28-08-2026") the product's own
// breadcrumbs and identifiers use. formatDate() above is en-US month-first
// ("8/28/2026"), which an AED/INR organisation reads as the wrong day for
// the first twelve days of every month. This is the day-first counterpart;
// making the choice org-configurable is R67 item D-39's own job, and this
// helper is where that switch will land.
//
// KNOWN DUPLICATION, named rather than silently collapsed (decision D-11).
// formatDayMonthYearNumeric() above is lane D21's independently-written
// equivalent: same "28-08-2026" output, same UTC pinning, built from Intl
// parts instead of a manual pad. Both survive this merge because each has its
// own call sites (this one: Materials, the Labour daily summary, schedule
// baselines; that one: Work Progress) and its own passing assertions, and
// rewriting one lane's call sites during a catch-up merge would risk more than
// the duplication costs. Collapsing them onto one name is a follow-up, and
// D-39's org-configurable switch is the natural moment to do it.
export function formatDateNumeric(value: Date | string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getUTCFullYear()}`;
}
