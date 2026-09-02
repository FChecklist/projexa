// R67 G-01 (R-017). "How long has this permit got?" answered in words.
//
// THE DEFECT. The permits list rendered daysToExpiry as a bare signed number
// in a coloured chip: "-3", "12", "214". Three separate problems in one cell:
//   1. A SIGN IS NOT A SENTENCE. "-3" is three days past expiry, but the
//      reader has to know that the minus means "ago" and not "three days of
//      grace". On a site permit that ambiguity is the difference between a
//      stop-work notice and a shrug.
//   2. COLOUR CARRIED THE MEANING. Rose vs clay vs sage was the only thing
//      separating expired from expiring from fine. ~8% of men cannot read
//      that distinction, and nobody can read it in a printout.
//   3. IT EXISTED ONLY AT ITEM LEVEL. To learn "two of these are expired" you
//      had to scan every row.
//
// This module is the pure half of the fix: no React, no fetch, so the four
// branches and the header sentence are unit-testable exactly as R-017's
// acceptance asks. PermitsListClient.tsx renders what it returns.

import type { StatusTone } from "@/components/ui/status-pill";

/** Which of the four states a permit's remaining life is in. */
export type PermitStatusKind = "unknown" | "expired" | "today" | "expiring" | "valid";

export type PermitStatus = {
  kind: PermitStatusKind;
  /** The words shown in the cell. Never a bare number, never a bare sign. */
  label: string;
  /**
   * Which glyph the chip draws. A stable key rather than a character, so the
   * glyph itself lives in exactly one place (status-pill.tsx's TONE_STYLE)
   * and this module stays renderer-agnostic.
   */
  glyphKey: string;
  /** The colour token the chip paints in -- always PAIRED with the label. */
  tone: StatusTone;
};

/** The window R-017 and the dashboard KPI both treat as "expiring soon". */
export const EXPIRING_WITHIN_DAYS = 30;

/**
 * The list route accepts ?withinDays=N, so N is not always 30. Every function
 * below takes the window as an argument rather than closing over the constant:
 * a page opened with withinDays=60 must not say "expiring within 30 days" over
 * a 60-day list, and the row chips must use the same N as the header sentence
 * or the two disagree on the same screen.
 *
 * A missing, non-numeric, zero or negative parameter falls back to the
 * constant -- "within -5 days" is not a window, and refusing to guess here
 * would mean refusing to render the list at all.
 */
export function parseWithinDays(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return EXPIRING_WITHIN_DAYS;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : EXPIRING_WITHIN_DAYS;
}

function days(n: number): string {
  // "expired 1 day ago", not "expired 1 days ago". The plural is the only
  // thing that varies; the sentence shape does not.
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/**
 * The one place a permit's remaining life becomes words.
 *
 * @param daysToExpiry days from today to the permit's end date; negative when
 *   the date has passed, null when the permit has no end date at all.
 * @param withinDays the "expiring soon" window, so a list opened at
 *   ?withinDays=60 draws its rows against the same 60 its header names.
 */
export function permitStatus(daysToExpiry: number | null, withinDays: number = EXPIRING_WITHIN_DAYS): PermitStatus {
  if (daysToExpiry === null) {
    // No end date on the record. Not "fine" and not "expired" -- unknown, and
    // said so. The neutral tone is the one tone that claims nothing.
    return { kind: "unknown", label: "-", glyphKey: "neutral", tone: "neutral" };
  }
  if (daysToExpiry < 0) {
    return {
      kind: "expired",
      label: `expired ${days(-daysToExpiry)} ago`,
      glyphKey: "late",
      tone: "late",
    };
  }
  if (daysToExpiry === 0) {
    return { kind: "today", label: "expires today", glyphKey: "needs-you", tone: "needs-you" };
  }
  if (daysToExpiry <= withinDays) {
    return {
      kind: "expiring",
      label: `expires in ${days(daysToExpiry)}`,
      glyphKey: "needs-you",
      tone: "needs-you",
    };
  }
  return { kind: "valid", label: `valid, ${days(daysToExpiry)} left`, glyphKey: "done", tone: "done" };
}

/** Just the words, for callers that do not draw a chip. */
export function permitStatusLabel(daysToExpiry: number | null, withinDays: number = EXPIRING_WITHIN_DAYS): string {
  return permitStatus(daysToExpiry, withinDays).label;
}

export type PermitStatusCounts = { expired: number; expiring: number; valid: number; unknown: number };

/**
 * Header-level counts, computed from the rows that are actually on screen --
 * never fetched separately, so the header and the list can never disagree.
 * "expires today" counts as expiring: it is the last day you can act.
 */
export function permitStatusCounts(
  rows: { daysToExpiry: number | null }[],
  withinDays: number = EXPIRING_WITHIN_DAYS
): PermitStatusCounts {
  const counts: PermitStatusCounts = { expired: 0, expiring: 0, valid: 0, unknown: 0 };
  for (const row of rows) {
    const kind = permitStatus(row.daysToExpiry, withinDays).kind;
    if (kind === "expired") counts.expired += 1;
    else if (kind === "expiring" || kind === "today") counts.expiring += 1;
    else if (kind === "valid") counts.valid += 1;
    else counts.unknown += 1;
  }
  return counts;
}

/** One clause of the header band, with its own glyph, so each is chip-able. */
export type PermitHeaderPart = { key: PermitStatusKind; text: string; glyphKey: string; tone: StatusTone };

/**
 * The header band, as R-017 words it: "2 expired - 1 expiring within 30 days
 * - 5 valid", each clause carrying the same glyph its rows carry.
 *
 * A clause with a zero count is dropped rather than shown as "0 expired":
 * "0 expired" is noise on a list where nothing is expired, and the absence of
 * the rose clause is itself the signal.
 */
export function permitHeaderParts(
  counts: PermitStatusCounts,
  withinDays: number = EXPIRING_WITHIN_DAYS
): PermitHeaderPart[] {
  const parts: PermitHeaderPart[] = [];
  if (counts.expired > 0) parts.push({ key: "expired", text: `${counts.expired} expired`, glyphKey: "late", tone: "late" });
  if (counts.expiring > 0)
    parts.push({
      key: "expiring",
      text: `${counts.expiring} expiring within ${withinDays} days`,
      glyphKey: "needs-you",
      tone: "needs-you",
    });
  if (counts.valid > 0) parts.push({ key: "valid", text: `${counts.valid} valid`, glyphKey: "done", tone: "done" });
  if (counts.unknown > 0)
    parts.push({ key: "unknown", text: `${counts.unknown} with no expiry date`, glyphKey: "neutral", tone: "neutral" });
  return parts;
}

/** The same header band flattened to one string, for tests and for aria. */
export function permitHeaderSentence(
  counts: PermitStatusCounts,
  withinDays: number = EXPIRING_WITHIN_DAYS
): string {
  return permitHeaderParts(counts, withinDays)
    .map((p) => p.text)
    .join(" - ");
}

/**
 * Most urgent first. R-017: the list defaults to endDate ascending, so the
 * permit that is furthest past its date is the first thing on the screen.
 *
 * Sorting on daysToExpiry rather than on the date string keeps rows with no
 * end date OUT of the urgent end (they sort last) instead of letting a null
 * date masquerade as the oldest one. Ties fall back to the name so the order
 * is stable across reloads.
 */
export function sortByExpiryAscending<T extends { daysToExpiry: number | null; endDate: string | null; name: string }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    const aNull = a.daysToExpiry === null;
    const bNull = b.daysToExpiry === null;
    if (aNull !== bNull) return aNull ? 1 : -1;
    if (!aNull && !bNull && a.daysToExpiry !== b.daysToExpiry) {
      return (a.daysToExpiry as number) - (b.daysToExpiry as number);
    }
    return a.name.localeCompare(b.name);
  });
}
