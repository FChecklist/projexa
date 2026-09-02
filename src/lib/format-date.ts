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
  if (!date) return "—";
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
  if (!date) return "—";
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
  if (!date) return "—";
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
