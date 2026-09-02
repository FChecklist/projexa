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

/** e.g. "8/25/2026, 2:30 PM" -- identical on server and client, any visitor. */
export function formatDateTime(value: Date | string | number): string {
  return new Date(value).toLocaleString(FIXED_LOCALE, { timeZone: FIXED_TIME_ZONE });
}

/** e.g. "2:30 PM" -- identical on server and client, any visitor. */
export function formatTime(value: Date | string | number): string {
  return new Date(value).toLocaleTimeString(FIXED_LOCALE, { timeZone: FIXED_TIME_ZONE });
}

// R67: the date form the product's own sentences use -- "Attendance for
// 02 Sep 2026 saved", "No attendance marked for 02 Sep 2026". Built from a
// fixed month table rather than Intl because EVERY locale Intl offers spells
// September differently in its short form (en-GB gives "Sept", en-US gives
// "Sep"), and the copy these strings appear in is written once, in English,
// with the three-letter form. Same UTC-pinned, hydration-safe posture as the
// three helpers above.
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** e.g. "02 Sep 2026". Returns the en-dash for an unparseable value, never "Invalid Date". */
export function formatDayMonthYear(value: Date | string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${String(date.getUTCDate()).padStart(2, "0")} ${SHORT_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// R67: the all-numeric day-first form ("28-08-2026") the product's own
// breadcrumbs and identifiers use. formatDate() above is en-US month-first
// ("8/28/2026"), which an AED/INR organisation reads as the wrong day for
// the first twelve days of every month. This is the day-first counterpart;
// making the choice org-configurable is R67 item D-39's own job, and this
// helper is where that switch will land.
export function formatDateNumeric(value: Date | string | number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${date.getUTCFullYear()}`;
}
