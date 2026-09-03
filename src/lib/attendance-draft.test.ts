import { describe, expect, test } from "bun:test";
import {
  EMPTY_ATTENDANCE_DRAFT,
  attendanceCountLine,
  attendanceCounts,
  attendanceEntries,
  attendanceSaveLabel,
  presentIds,
  readableDate,
  replaceWarning,
  toggleAbsent,
  toggleHalfDay,
} from "./attendance-draft";

const CREW = Array.from({ length: 12 }, (_, i) => `w${i + 1}`);

describe("the default is present", () => {
  test("an empty draft ticks the whole roster", () => {
    expect(presentIds(CREW, EMPTY_ATTENDANCE_DRAFT)).toEqual(CREW);
    expect(attendanceCounts(CREW, EMPTY_ATTENDANCE_DRAFT)).toEqual({ present: 12, halfDay: 0, absent: 0 });
  });

  test("a worker added to the roster after the draft was started is present, not absent", () => {
    const draft = toggleAbsent(EMPTY_ATTENDANCE_DRAFT, "w3");
    const withNewJoiner = [...CREW, "w13"];
    expect(presentIds(withNewJoiner, draft)).toContain("w13");
    expect(attendanceCounts(withNewJoiner, draft)).toEqual({ present: 12, halfDay: 0, absent: 1 });
  });
});

describe("attendanceSaveLabel", () => {
  test("C-08's button, verbatim, on an ordinary day", () => {
    expect(attendanceSaveLabel(CREW, EMPTY_ATTENDANCE_DRAFT)).toBe("Save attendance (12 present, 0 absent)");
  });

  test("one man off site", () => {
    const draft = toggleAbsent(EMPTY_ATTENDANCE_DRAFT, "w4");
    expect(attendanceSaveLabel(CREW, draft)).toBe("Save attendance (11 present, 1 absent)");
  });

  test("a half day gets its own clause, and only when there is one", () => {
    const draft = toggleHalfDay(EMPTY_ATTENDANCE_DRAFT, "w4");
    expect(attendanceSaveLabel(CREW, draft)).toBe("Save attendance (11 present, 1 half day, 0 absent)");
  });
});

describe("attendanceCountLine", () => {
  test("counts a half day as someone who is on site", () => {
    expect(attendanceCountLine(CREW, EMPTY_ATTENDANCE_DRAFT)).toBe("12 of 12 present");
    expect(attendanceCountLine(CREW, toggleHalfDay(EMPTY_ATTENDANCE_DRAFT, "w1"))).toBe("12 of 12 present");
    expect(attendanceCountLine(CREW, toggleAbsent(EMPTY_ATTENDANCE_DRAFT, "w1"))).toBe("11 of 12 present");
  });
});

describe("toggles", () => {
  test("un-ticking then re-ticking returns to where it started", () => {
    const once = toggleAbsent(EMPTY_ATTENDANCE_DRAFT, "w2");
    expect(once.absentIds).toEqual(["w2"]);
    expect(toggleAbsent(once, "w2").absentIds).toEqual([]);
  });

  test("marking someone absent drops their half day -- payroll must never see both", () => {
    const half = toggleHalfDay(EMPTY_ATTENDANCE_DRAFT, "w2");
    const absent = toggleAbsent(half, "w2");
    expect(absent.halfDayIds).toEqual([]);
    expect(absent.absentIds).toEqual(["w2"]);
  });

  test("half day cannot be set on someone already marked absent", () => {
    const absent = toggleAbsent(EMPTY_ATTENDANCE_DRAFT, "w2");
    expect(toggleHalfDay(absent, "w2")).toBe(absent);
  });
});

describe("attendanceEntries", () => {
  test("one row per worker on the roster -- no gaps, no invented ids", () => {
    const draft = toggleHalfDay(toggleAbsent(EMPTY_ATTENDANCE_DRAFT, "w1"), "w2");
    const entries = attendanceEntries(CREW, draft);
    expect(entries.length).toBe(12);
    expect(entries[0]).toEqual({ rosterId: "w1", status: "absent" });
    expect(entries[1]).toEqual({ rosterId: "w2", status: "half_day" });
    expect(entries[2]).toEqual({ rosterId: "w3", status: "present" });
  });
});

describe("the replace warning", () => {
  test("C-08's sentence, with the blast radius in it", () => {
    expect(
      replaceWarning({ attendanceDate: "2026-09-03", today: "2026-09-03", rosterCount: 12 })
    ).toBe("Attendance for today is already saved — replace it? This overwrites what is saved and writes 12 rows.");
  });

  test("a back-dated day is named, not called 'today'", () => {
    expect(replaceWarning({ attendanceDate: "2026-09-01", today: "2026-09-03", rosterCount: 1 })).toBe(
      "Attendance for 01 Sep 2026 is already saved — replace it? This overwrites what is saved and writes 1 row."
    );
  });
});

describe("readableDate", () => {
  test("is the fixed table, not a locale", () => {
    expect(readableDate("2026-09-03")).toBe("03 Sep 2026");
  });

  test("a string that is not an ISO date is returned untouched rather than mangled", () => {
    expect(readableDate("not-a-date")).toBe("not-a-date");
  });
});
