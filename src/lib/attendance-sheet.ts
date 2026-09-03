// R67 D-30 (Daily Attendance Sheet) -- the pure half of the sheet, kept out
// of the component so the arithmetic the foot of the table shows (trade
// subtotals, the day total) and the sentences a failure produces are unit
// tested rather than eyeballed on a screenshot.
//
// NOT "use client": imported by the client sheet, by the Manpower list and by
// tests alike.
import { ApiError } from "./fetch-json";

export const ATTENDANCE_STATUSES = ["present", "half_day", "absent"] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** What the three states are called on screen. One place, so the sheet, the list and the summary agree. */
export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  half_day: "Half day",
  absent: "Absent",
};

/** Single-key marks for a keyboard-driven sheet: P / H / A. */
export const ATTENDANCE_STATUS_KEY: Record<string, AttendanceStatus> = {
  p: "present",
  h: "half_day",
  a: "absent",
};

// Mirrors compliance-tracker's ATTENDANCE_COST_MULTIPLIER. The server is
// authoritative -- it recomputes every cost from the roster's own dailyRate on
// save -- but the sheet has to show a running day total BEFORE it saves, so
// the same rule exists here. A drift between the two would show as the footer
// total changing after a save, which is why the saved total is taken from the
// server's response and not from this.
const COST_MULTIPLIER: Record<AttendanceStatus, number> = { present: 1, half_day: 0.5, absent: 0 };

export function attendanceMultiplier(status: AttendanceStatus): number {
  return COST_MULTIPLIER[status];
}

/** The money one marked row is worth. `dailyRate` arrives as the numeric column's string form. */
export function rowCost(dailyRate: string | number | null | undefined, status: AttendanceStatus | null): number | null {
  if (!status) return null; // unmarked is not zero -- see the sheet's own "—" rendering
  const rate = Number(dailyRate);
  if (!Number.isFinite(rate)) return 0;
  return Math.round(rate * COST_MULTIPLIER[status] * 100) / 100;
}

/**
 * R67 D-53: the three states as a glyph AND the word, never colour alone.
 * The glyph is the shape, the word is the meaning; a colour-blind or
 * monochrome-printed sheet still reads correctly.
 */
export const ATTENDANCE_STATUS_GLYPH: Record<AttendanceStatus, string> = {
  present: "●",
  half_day: "◐",
  absent: "○",
};

/**
 * R67 D-53: the previous / next day for the summary tab's day navigation.
 *
 * Pinned to UTC for the same reason format-date.ts pins its own formatters: a
 * `new Date("2026-09-02")` is midnight UTC, and adding a day through local-time
 * getters lands on the WRONG DATE for every visitor west of Greenwich for part
 * of the year. An unparseable input is returned unchanged rather than becoming
 * "NaN-NaN-NaN" in the URL.
 */
export function shiftIsoDate(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A worker with no trade recorded is grouped under this, not under a blank heading. */
export const UNSPECIFIED_TRADE = "Unspecified";

export type SheetRowForTotals = {
  trade?: string | null;
  dailyRate: string | number | null | undefined;
  status: AttendanceStatus | null;
};

export type TradeSubtotal = {
  trade: string;
  marked: number;
  present: number;
  halfDay: number;
  absent: number;
  cost: number;
};

export type SheetTotals = {
  trades: TradeSubtotal[];
  markedCount: number;
  totalCost: number;
};

/**
 * Trade subtotals plus the day total, computed over MARKED rows only -- an
 * unmarked worker contributes to nothing, which is the whole reason unmarked
 * and Absent must look different on screen.
 *
 * Trades come back in alphabetical order with "Unspecified" always last, so
 * the foot of the table does not reorder itself as rows are marked.
 */
export function summariseByTrade(rows: readonly SheetRowForTotals[]): SheetTotals {
  const byTrade = new Map<string, TradeSubtotal>();
  let markedCount = 0;
  let totalCost = 0;

  for (const row of rows) {
    if (!row.status) continue;
    markedCount++;
    const trade = row.trade?.trim() || UNSPECIFIED_TRADE;
    const entry = byTrade.get(trade) ?? { trade, marked: 0, present: 0, halfDay: 0, absent: 0, cost: 0 };
    entry.marked++;
    if (row.status === "present") entry.present++;
    else if (row.status === "half_day") entry.halfDay++;
    else entry.absent++;
    const cost = rowCost(row.dailyRate, row.status) ?? 0;
    entry.cost = Math.round((entry.cost + cost) * 100) / 100;
    totalCost = Math.round((totalCost + cost) * 100) / 100;
    byTrade.set(trade, entry);
  }

  const trades = [...byTrade.values()].sort((a, b) => {
    if (a.trade === UNSPECIFIED_TRADE) return 1;
    if (b.trade === UNSPECIFIED_TRADE) return -1;
    return a.trade.localeCompare(b.trade);
  });

  return { trades, markedCount, totalCost };
}

// R67 D-03 vocabulary. The sheet must never print a raw backend string: those
// carry row ids ("Roster entry not found on this project: roster-abc123") and,
// on an upstream failure, whatever the proxy happened to say. Each of these
// sentences names what happened, whether anything was saved, and what to do
// next -- and the caller pairs them with a Retry.
export function saveFailureSentence(error: unknown): string {
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 400) return "That sheet could not be saved — check the marked rows and try again. Nothing was saved.";
  if (status === 403) return "You do not have permission to save attendance on this project. Nothing was saved.";
  if (status === 404) return "One of these workers is no longer on this project's roster — reload the sheet. Nothing was saved.";
  if (status === 409) return "This sheet changed while you were marking it — reload the sheet. Nothing was saved.";
  return "The construction data service didn't answer — nothing was saved.";
}

/** `subject` is what the user was trying to see, e.g. "roster" or "attendance for this date". */
export function loadFailureSentence(error: unknown, subject: string): string {
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 403) return `You do not have permission to view the ${subject} on this project.`;
  if (status === 404) return `This project's ${subject} could not be found.`;
  return `The construction data service didn't answer — the ${subject} could not be loaded.`;
}
