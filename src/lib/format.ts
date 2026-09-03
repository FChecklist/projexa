// R67 D-74 -- ONE date, time and money form for the whole product.
//
// WHAT R-284 MEASURED. Seven construction screens, five ways of writing the
// same value:
//
//   /moms          "28 Aug 2026, 10:00"          (formatDateTimeOrg)
//   /scope         "8/25/2026"                   (format-date.ts, en-US)
//   /schedule      "2026-09-02"                  (the raw API string)
//   /materials     "AED 21750.00"                (currencyLabel + toFixed)
//   /labour        "AED 180"                     (currencyLabel + the raw string)
//   BOQ lines      "21,750"                      (toLocaleString(undefined))
//
// and, on the MoM create form, a meeting typed at 10:30 that came back as
// 14:30, because "2026-09-02T10:30" -- a datetime-local value with NO zone --
// was sent as-is and read by the server as UTC.
//
// TWO SEPARATE FAULTS, and this file exists because they have one cause.
//
//  1. `toLocaleString(undefined, ...)` and `toLocaleDateString()` resolve to
//     the RUNTIME's locale and zone. On the server that is the deployment's;
//     in the browser it is the visitor's. Different strings on the two
//     passes is a hydration mismatch -- the exact defect format-date.ts's
//     header documents at length -- and neither of the two strings is the
//     ORGANISATION's, which is the only one that is correct.
//  2. A local wall-clock has no meaning without a zone. Attaching the org's
//     offset at the moment it is captured is the only point at which the
//     user's intent ("half past ten, here") is still known.
//
// WHAT THIS FILE IS. The org-facing formatters, in ONE module with no "use
// client" directive -- so a Server Component, a route handler and a client
// table all import the same function. src/lib/currency.ts cannot be that
// module: it is "use client" (it owns a hook), which is exactly why every
// screen ended up writing its own money formatter beside it.
//
// WHAT IT IS NOT. It does not replace format-date.ts's original
// formatDate/formatDateTime/formatTime: those are pinned to en-US/UTC for
// hydration safety, ~30 files depend on their exact output, and their tests
// stay green. This is the form a SCREEN should use; that one is what the
// audit found on the screens.
//
// ─── WHERE THE ORG SETTINGS ACTUALLY COME FROM ───────────────────────────
//
// D-74 says these read "locale, currency and timezone from the shell org
// context". Two of the three do not exist as data yet: GET /api/organization
// returns id, name, slug, created_at and country -- there is no locale,
// timeZone or dateFormat column (the org date-format column ships with
// C03-24, another lane). So they are PARAMETERS with the demo org's real
// settings as defaults, which is deterministic in exactly the way the fixed
// constants were, and a caller that has them can pass them today without
// this file changing again. Currency is different: it IS real, from
// /api/currencies, and is therefore never defaulted -- see formatMoney.

// ─── ONE MONEY MODULE, NOT TWO ───────────────────────────────────────────
//
// This file briefly carried its own formatMoney(value, currency?, options?)
// with a different rule (whole amounts to 0 decimals, "AED 7,500"). r67(G)
// shipped src/lib/format-money.ts to main with the opposite rule -- two
// decimals always, so a column lines up on the point -- which is also D-39's
// own stated acceptance ("formatMoney(21750, aedCurrencies) === 'AED
// 21,750.00'"). Two modules exporting the same name with contradictory output
// IS the "one value type rendered three ways on one module" defect this
// programme exists to remove, so there is now exactly one implementation and
// this file re-exports it. Its `fractionDigits` covers the whole-unit case a
// headline KPI wants; nothing needs a second formatter.
import { DEFAULT_ORG_DATE_FORMAT, DEFAULT_ORG_TIME_ZONE, formatOrgDate } from "@/lib/format-date";
import { EMPTY_VALUE } from "@/lib/format-money";

export { DEFAULT_ORG_DATE_FORMAT, DEFAULT_ORG_TIME_ZONE };
export {
  formatMoney,
  formatQty,
  formatSignedMoney,
  currencyUnitSuffix,
  MONEY_CELL_CLASS,
  type MoneyFormat,
} from "@/lib/format-money";

/** The org's number grouping. "en-GB" groups 7500 as "7,500". */
export const DEFAULT_ORG_LOCALE = "en-GB";

/**
 * What a cell shows when the value is genuinely unset. Never "Invalid Date".
 * The SAME glyph the money and number formatters use -- a screen must not
 * show two different "no value" marks depending on which helper wrote the
 * cell, which is why this is an alias rather than its own constant.
 */
export const EMPTY_CELL = EMPTY_VALUE;

export type DateFormatOptions = {
  /** IANA zone. The calendar day is resolved in it, so a timestamp and a
   *  date-only value agree about which day they are on. */
  tz?: string;
  /** "dd-MM-yyyy" | "dd/MM/yyyy" | "yyyy-MM-dd" | "MM/dd/yyyy". */
  dateFormat?: string;
};

/**
 * The org's date. `formatDate("2026-09-02T00:00:00Z", { tz: "Asia/Dubai" })`
 * is "02-09-2026".
 */
export function formatDate(
  value: Date | string | number | null | undefined,
  options: DateFormatOptions = {}
): string {
  return formatOrgDate(value, options.dateFormat ?? DEFAULT_ORG_DATE_FORMAT, options.tz ?? DEFAULT_ORG_TIME_ZONE);
}

/**
 * The org's date and 24-hour clock, with NO seconds -- "02-09-2026 10:30".
 * Nobody schedules a site meeting to the second, and a seconds field on a
 * list is six characters of noise per row.
 */
export function formatDateTime(
  value: Date | string | number | null | undefined,
  options: DateFormatOptions = {}
): string {
  const date = toValidDate(value);
  if (!date) return EMPTY_CELL;
  const tz = options.tz ?? DEFAULT_ORG_TIME_ZONE;
  return `${formatDate(date, options)} ${formatClock(date, tz)}`;
}

/** "10:30" in the org's zone, 24-hour, no seconds. */
export function formatClock(value: Date | string | number | null | undefined, tz: string = DEFAULT_ORG_TIME_ZONE): string {
  const date = toValidDate(value);
  if (!date) return EMPTY_CELL;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    // hourCycle rather than hour12:false -- the latter renders midnight as
    // "24:00" in some ICU builds, which is a time that does not exist.
    hourCycle: "h23",
  }).format(date);
}

/**
 * Turns a `<input type="datetime-local">` value -- "2026-09-02T10:30", which
 * carries NO zone -- into the instant the user meant, by attaching the org's
 * own offset at that moment.
 *
 * THE BUG THIS FIXES. The MoM create form posted the raw string. A server
 * running in UTC read it as 10:30 UTC, stored that, and every render in
 * Asia/Dubai then showed 14:30 for a meeting the user had scheduled at half
 * past ten. Returned as an ISO instant, so nothing downstream has to know
 * the zone to store or compare it.
 *
 * The offset is resolved TWICE on purpose: the first pass uses the naive
 * instant, which lands on the wrong side of a DST boundary for a zone that
 * has one, and the second pass re-resolves it at the corrected instant.
 * Asia/Dubai has no DST, but this helper must not be wrong for the next org.
 */
export function toOrgInstant(
  localDateTime: string | null | undefined,
  timeZone: string = DEFAULT_ORG_TIME_ZONE
): string | undefined {
  const local = (localDateTime ?? "").trim();
  if (!local) return undefined;
  // A value that already carries a zone (an ISO string with Z or an offset)
  // is already an instant and must not be shifted again.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(local)) {
    const asIs = toValidDate(local);
    return asIs ? asIs.toISOString() : undefined;
  }
  const naive = Date.parse(`${local.length === 16 ? `${local}:00` : local}Z`);
  if (Number.isNaN(naive)) return undefined;

  let utc = naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60_000;
  utc = naive - zoneOffsetMinutes(new Date(utc), timeZone) * 60_000;
  return new Date(utc).toISOString();
}

/**
 * How far ahead of UTC `timeZone` is at `instant`, in minutes. +240 for
 * Asia/Dubai. Computed by formatting the instant in the zone and reading the
 * result back as if it were UTC -- the standard trick, and the only one that
 * works without a time-zone database in the bundle.
 */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  // Seconds are compared, not milliseconds: formatToParts has no ms field.
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/**
 * The value a `<input type="datetime-local">` should hold for an instant, in
 * the org's zone -- the inverse of {@link toOrgInstant}, so an edit form
 * opens showing the same wall clock the list shows.
 */
export function toLocalInputValue(
  value: Date | string | number | null | undefined,
  timeZone: string = DEFAULT_ORG_TIME_ZONE
): string {
  const date = toValidDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function toValidDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
