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
const FIXED_LOCALE = "en-US";
const FIXED_TIME_ZONE = "UTC";

/** e.g. "8/25/2026" -- identical on server and client, any visitor. */
export function formatDate(value: Date | string | number): string {
  return new Date(value).toLocaleDateString(FIXED_LOCALE, { timeZone: FIXED_TIME_ZONE });
}

/**
 * R67 D-23: e.g. "28 Aug 2026" -- the unambiguous day-month-year form the BOQ
 * list uses, because "8/25/2026" reads as 8 May to half of this product's
 * users (a UAE contractor's site team) and as 25 August to the other half.
 * Same pinned locale/time zone as every other helper here, so it is equally
 * hydration-safe.
 */
export function formatDayMonthYear(value: Date | string | number): string {
  // "en-GB", not the FIXED_LOCALE above, is deliberate and is the ONE
  // exception in this file: en-US orders these parts month-first ("Aug 28,
  // 2026"), and the required reading is day-first. It is still a HARDCODED
  // locale -- pinned exactly like the others, so the string is byte-identical
  // on the server and in every visitor's browser. It is never the runtime
  // default.
  return new Date(value).toLocaleDateString("en-GB", {
    timeZone: FIXED_TIME_ZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

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

/** e.g. "2:30 PM" -- identical on server and client, any visitor. */
export function formatTime(value: Date | string | number): string {
  return new Date(value).toLocaleTimeString(FIXED_LOCALE, { timeZone: FIXED_TIME_ZONE });
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
