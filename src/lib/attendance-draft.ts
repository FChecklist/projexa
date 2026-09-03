// R67 WS-C (C-08) -- A DAY'S ATTENDANCE, AS A DRAFT.
//
// R-174: PROJEXA's only way to record attendance is one worker per
// submission, on a form with four fields. A twelve-worker crew is twelve
// visits to that form. The composer's answer is a chip grid where the whole
// roster arrives ALREADY TICKED and the foreman marks the exceptions.
//
// WHY THE DRAFT IS THE EXCEPTIONS, NOT THE SELECTION. Storing "who is
// present" would mean the state is wrong the instant the roster reloads with
// a new worker on it -- a worker who joined this morning would arrive absent.
// Storing "who is NOT present" means a new name is present by default, which
// is the truth on most days, and the state survives a reload of the list it
// describes.
//
// PURE. No React, no fetch -- every count and every sentence below is
// asserted in attendance-draft.test.ts.

export type AttendanceDraft = {
  /** Workers the foreman un-ticked. Everyone else on the roster is present. */
  absentIds: readonly string[];
  /** Workers marked half day. Only meaningful for someone not absent. */
  halfDayIds: readonly string[];
};

export const EMPTY_ATTENDANCE_DRAFT: AttendanceDraft = { absentIds: [], halfDayIds: [] };

export type AttendanceCounts = { present: number; halfDay: number; absent: number };

/** Which chips are ticked: everyone on the roster who is not marked absent. */
export function presentIds(rosterIds: readonly string[], draft: AttendanceDraft): string[] {
  const absent = new Set(draft.absentIds);
  return rosterIds.filter((id) => !absent.has(id));
}

/**
 * The live tally the grid prints above itself. A half day is still a person
 * on site, so it is counted separately rather than folded into either
 * "present" or "absent" -- a foreman reading "11 present" when twelve people
 * are on site would be reading a wrong number.
 */
export function attendanceCounts(rosterIds: readonly string[], draft: AttendanceDraft): AttendanceCounts {
  const absent = new Set(draft.absentIds);
  const half = new Set(draft.halfDayIds);
  let present = 0;
  let halfDay = 0;
  let absentCount = 0;
  for (const id of rosterIds) {
    if (absent.has(id)) absentCount += 1;
    else if (half.has(id)) halfDay += 1;
    else present += 1;
  }
  return { present, halfDay, absent: absentCount };
}

/** "12 of 12 present" -- the live count line over the grid. */
export function attendanceCountLine(rosterIds: readonly string[], draft: AttendanceDraft): string {
  const counts = attendanceCounts(rosterIds, draft);
  const onSite = counts.present + counts.halfDay;
  return `${onSite} of ${rosterIds.length} present`;
}

/**
 * C-08's primary button, verbatim: "Save attendance (12 present, 0 absent)".
 *
 * The half-day clause is added only when there is one, so the ordinary day --
 * everybody in, nobody out -- reads exactly as the item writes it.
 */
export function attendanceSaveLabel(rosterIds: readonly string[], draft: AttendanceDraft): string {
  const { present, halfDay, absent } = attendanceCounts(rosterIds, draft);
  const parts = [`${present} present`];
  if (halfDay > 0) parts.push(`${halfDay} half day`);
  parts.push(`${absent} absent`);
  return `Save attendance (${parts.join(", ")})`;
}

export type AttendanceEntry = { rosterId: string; status: "present" | "absent" | "half_day" };

/** The batch body's `entries`: one row per worker on the roster, no gaps. */
export function attendanceEntries(rosterIds: readonly string[], draft: AttendanceDraft): AttendanceEntry[] {
  const absent = new Set(draft.absentIds);
  const half = new Set(draft.halfDayIds);
  return rosterIds.map((rosterId) => ({
    rosterId,
    status: absent.has(rosterId) ? "absent" : half.has(rosterId) ? "half_day" : "present",
  }));
}

/** Un-tick / re-tick one worker. Re-ticking clears a stale half-day mark. */
export function toggleAbsent(draft: AttendanceDraft, id: string): AttendanceDraft {
  const wasAbsent = draft.absentIds.includes(id);
  return {
    absentIds: wasAbsent ? draft.absentIds.filter((x) => x !== id) : [...draft.absentIds, id],
    // Marking someone absent drops their half day; a half day for someone who
    // was not there is not a state the payroll should ever be handed.
    halfDayIds: wasAbsent ? draft.halfDayIds : draft.halfDayIds.filter((x) => x !== id),
  };
}

/** The optional per-chip "Half day". Never applies to someone marked absent. */
export function toggleHalfDay(draft: AttendanceDraft, id: string): AttendanceDraft {
  if (draft.absentIds.includes(id)) return draft;
  return {
    absentIds: draft.absentIds,
    halfDayIds: draft.halfDayIds.includes(id)
      ? draft.halfDayIds.filter((x) => x !== id)
      : [...draft.halfDayIds, id],
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "03 Sep 2026" from an ISO date. Fixed table for the same reason
 *  card-catalogue.ts uses one: an ICU difference must not change a sentence. */
export function readableDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${m[3]} ${month} ${m[1]}` : isoDate;
}

/**
 * C-08: a second save for the same date "warns 'Attendance for today is
 * already saved - replace it?' naming the blast radius".
 *
 * THE BLAST RADIUS IS IN THE SENTENCE, not in a tooltip: a replace deletes
 * rows that are already someone's payroll input, and the number of them is
 * the fact that decides whether the answer is yes.
 */
export function replaceWarning(input: {
  attendanceDate: string;
  today: string;
  rosterCount: number;
  /** What the server said, when it named a count. */
  serverMessage?: string | null;
}): string {
  const when = input.attendanceDate === input.today ? "today" : readableDate(input.attendanceDate);
  const rows = `${input.rosterCount} row${input.rosterCount === 1 ? "" : "s"}`;
  return `Attendance for ${when} is already saved — replace it? This overwrites what is saved and writes ${rows}.`;
}
