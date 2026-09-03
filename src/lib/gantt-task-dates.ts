// R67 D-74: was format-date.ts's en-US/UTC formatDate, so the Timeline grid
// read "10/15/2026" beside a date input the browser rendered in its own
// locale -- two date forms on one screen, neither the organisation's.
import { formatDate } from "@/lib/format";

// R52 -- fault F_018 ("Timeline view shows fabricated Start/Due dates").
//
// THE DEFECT, and the exact mechanism.
//
// ScheduleGanttClient mapped every task for SVAR like this:
//
//     start:    t.startDate ? new Date(t.startDate) : new Date(),
//     end:      t.dueDate   ? new Date(t.dueDate)   : new Date(),
//     duration: t.startDate && t.dueDate ? undefined : 1,
//
// Two separate lies, and they compound:
//
//   1. A NULL startDate became `new Date()` -- TODAY. "Not scheduled yet"
//      was rendered as "starts today". Nothing in the data said that.
//
//   2. Because startDate was null, `duration: 1` was sent alongside a
//      perfectly real dueDate. SVAR's own normaliser then DISCARDED the
//      real end date: see node_modules/@svar-ui/gantt-store/dist/index.js,
//      function Oe --
//
//          e[i] ? (e[c] ? e[o] = Ee(a,n)(e[i], e[c]) : ...)
//               // i = "start", o = "end", c = "duration"
//               // given start AND duration, END := start + duration
//
//      So a task whose real due date was 2026-10-15 rendered as due
//      TOMORROW. That is the "Start = today / Due = tomorrow on every task"
//      the fault recorded, reproduced exactly, from the data it recorded
//      (startDate null, dueDate ~7 weeks out).
//
// THE RULE: never send SVAR a date the data does not contain, and never
// send `duration` next to a real `end` -- duration silently wins.
//
// A task with no start cannot be positioned on a timeline at all, so it is
// marked `unscheduled`, which SVAR's normaliser skips entirely (`z()`:
// `e.unscheduled || Oe(...)`) -- it keeps the real end date and invents no
// start. What the user sees in the grid does not depend on any of that
// either way: the Start/Due columns are rendered from the ORIGINAL API
// values via displayScheduleDate() below, so an unset date is an em-dash,
// never a plausible-looking guess.

export type GanttDateFields = {
  start?: Date;
  end?: Date;
  duration?: number;
  unscheduled?: boolean;
};

/**
 * Maps a task's real (nullable) schedule dates onto the fields SVAR's Gantt
 * accepts, without inventing any value the API did not supply.
 */
export function toGanttDateFields(startDate: string | null, dueDate: string | null): GanttDateFields {
  const hasStart = Boolean(startDate);
  const hasEnd = Boolean(dueDate);

  // Both real: hand over both and NO duration. Sending duration here is what
  // let SVAR overwrite the end date.
  if (hasStart && hasEnd) return { start: new Date(startDate!), end: new Date(dueDate!) };

  // A real start, no end: this is the one case where duration is the honest
  // answer -- there is no end date to contradict, and SVAR needs some span
  // to draw. One day is a minimum-width bar, not a claim about the deadline.
  if (hasStart) return { start: new Date(startDate!), duration: 1 };

  // A real end, no start: keep the end, refuse to invent a start.
  // `unscheduled` makes SVAR skip date normalisation, so the real end
  // survives instead of being recomputed from a fabricated start.
  if (hasEnd) return { end: new Date(dueDate!), unscheduled: true };

  // Neither: nothing is known. Say so.
  return { unscheduled: true };
}

/** The em-dash the outputs oracle calls for when a value is genuinely unset. */
export const EMPTY_DATE_CELL = "—";

/**
 * What a Start/Due grid cell shows. Reads the ORIGINAL API value, so it is
 * unaffected by whatever the chart library does to position a bar.
 */
export function displayScheduleDate(value: string | null | undefined): string {
  if (!value) return EMPTY_DATE_CELL;
  return formatDate(value);
}
