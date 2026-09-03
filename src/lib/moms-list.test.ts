/// <reference types="bun-types" />
// R67 D-16 / D-20. The acceptance criterion for D-16 is "a fetch stub
// rejecting as a 504: the render contains 'Retry' and does NOT contain the
// string 'No meetings recorded yet'". That is a statement about the decision
// the screen makes, so it is asserted here on the decision itself -- where a
// regression is a failing test rather than a screenshot nobody re-takes.
import { describe, expect, test } from "bun:test";
import {
  MOMS_DEFAULT_RANGE_DAYS,
  MOMS_TEXT,
  countCell,
  csvCell,
  defaultMomsRange,
  displayAttendeesCount,
  displayOpenActions,
  filterMeetings,
  isFilterNarrowed,
  isoDay,
  meetingStatusChip,
  meetingsToCsv,
  momsCsvFilename,
  momsHref,
  momsListState,
  momsLoadErrorSentence,
  momsSearchParams,
  parseMomsFilter,
  type MeetingListRow,
  type MomsFilter,
} from "./moms-list";

const TODAY = new Date("2026-08-28T09:00:00.000Z");
const DEFAULTS = defaultMomsRange(TODAY);

function meeting(overrides: Partial<MeetingListRow> & { id: string }): MeetingListRow {
  return {
    title: "Site coordination",
    status: "draft",
    scheduledAt: "2026-08-20T06:00:00.000Z",
    contextEntityId: "p-cedar",
    attendees: ["Arjun Mehta", "Priya Nair"],
    attendeesCount: 2,
    openActionItems: 0,
    ...overrides,
  };
}

describe("momsListState -- a failed read can never reach the empty sentence", () => {
  test("a 504 yields the error branch with the specified sentence, and NOT 'No meetings recorded yet'", () => {
    const state = momsListState({
      hasProjectScope: true,
      status: "error",
      httpStatus: 504,
      errorMessage: "The construction data service did not respond in time. Please retry.",
      projectLabel: "Cedar Heights Villa - Phase 1",
    });
    expect(state.kind).toBe("error");
    expect(state.kind === "error" && state.message).toBe(
      "Couldn't load meetings for Cedar Heights Villa - Phase 1: the construction data service did not respond."
    );
    expect(JSON.stringify(state)).not.toContain("No meetings recorded yet");
    expect(state.kind === "error" && state.footer).toBe("1 error");
  });

  test("401 and 403 say so in the user's words, not the transport's", () => {
    for (const httpStatus of [401, 403]) {
      const state = momsListState({ hasProjectScope: true, status: "error", httpStatus, projectLabel: "X" });
      expect(state).toEqual({ kind: "forbidden", message: "You don't have access to this project's meetings" });
    }
  });

  test("loading is its own branch -- it is not 'no meetings'", () => {
    expect(momsListState({ hasProjectScope: true, status: "loading", projectLabel: "X" })).toEqual({ kind: "loading" });
  });

  test("no project scope at all asks for one instead of listing something arbitrary", () => {
    expect(momsListState({ hasProjectScope: false, status: "ready", projectLabel: "X", rows: [] })).toEqual({
      kind: "no-project",
    });
    expect(MOMS_TEXT.noProject).toBe("Choose a project in the top bar");
  });

  test("ONLY a successful, genuinely empty response shows the empty sentence", () => {
    const state = momsListState({ hasProjectScope: true, status: "ready", projectLabel: "X", rows: [], visibleRows: [] });
    expect(state).toEqual({ kind: "empty", message: "No meetings recorded yet - press + New Meeting to start one." });
  });

  test("rows hidden by the filter are a DIFFERENT branch -- the 90-day default must never read as 'you have never held a meeting'", () => {
    const rows = [meeting({ id: "m1" })];
    const state = momsListState({ hasProjectScope: true, status: "ready", projectLabel: "X", rows, visibleRows: [] });
    expect(state).toEqual({ kind: "filtered-empty", message: "No meetings match these filters." });
  });

  test("the ready branch carries the visible rows, not the raw ones", () => {
    const rows = [meeting({ id: "m1" }), meeting({ id: "m2" })];
    const state = momsListState({
      hasProjectScope: true,
      status: "ready",
      projectLabel: "X",
      rows,
      visibleRows: [rows[1]],
    });
    expect(state.kind === "ready" && state.rows.map((r) => r.id)).toEqual(["m2"]);
  });
});

describe("the filter's default range", () => {
  test("is the last 90 days ending today", () => {
    expect(MOMS_DEFAULT_RANGE_DAYS).toBe(90);
    expect(DEFAULTS.to).toBe("2026-08-28");
    expect(DEFAULTS.from).toBe("2026-05-30");
  });

  test("isoDay is UTC and independent of the runtime's own zone", () => {
    expect(isoDay(new Date("2026-08-28T23:59:59.000Z"))).toBe("2026-08-28");
  });
});

describe("parseMomsFilter -- the URL is the filter", () => {
  test("reads every field back out of the query string", () => {
    const params = new URLSearchParams("status=published&from=2026-01-01&to=2026-02-01&attendee=Priya");
    expect(parseMomsFilter(params, TODAY)).toEqual({
      status: "published",
      from: "2026-01-01",
      to: "2026-02-01",
      attendee: "Priya",
    });
  });

  test("a malformed bookmark shows the default range rather than refusing to render", () => {
    const params = new URLSearchParams("from=last-tuesday&to=");
    expect(parseMomsFilter(params, TODAY)).toEqual({ status: "", from: DEFAULTS.from, to: DEFAULTS.to, attendee: "" });
  });

  test("no params at all is the default range", () => {
    expect(parseMomsFilter(null, TODAY)).toEqual({ status: "", from: DEFAULTS.from, to: DEFAULTS.to, attendee: "" });
  });

  test("round-trips through momsSearchParams, which is what makes Back restore the view", () => {
    const filter: MomsFilter = { status: "draft", from: "2026-03-01", to: "2026-03-31", attendee: "Arjun" };
    const round = parseMomsFilter(momsSearchParams(filter, "p-cedar"), TODAY);
    expect(round).toEqual(filter);
    expect(momsSearchParams(filter, "p-cedar").get("projectId")).toBe("p-cedar");
  });

  test("the all-projects mode carries no projectId at all", () => {
    expect(momsSearchParams({ status: "", from: "2026-03-01", to: "2026-03-31", attendee: "" }, null).has("projectId")).toBe(
      false
    );
    expect(momsHref({ status: "", from: "2026-03-01", to: "2026-03-31", attendee: "" }, null)).toBe(
      "/moms?from=2026-03-01&to=2026-03-31"
    );
  });

  test("isFilterNarrowed distinguishes 'the user filtered' from 'this is just the default'", () => {
    expect(isFilterNarrowed(parseMomsFilter(null, TODAY), TODAY)).toBe(false);
    expect(isFilterNarrowed({ ...DEFAULTS, status: "published", attendee: "" }, TODAY)).toBe(true);
    expect(isFilterNarrowed({ ...DEFAULTS, status: "", attendee: "Priya" }, TODAY)).toBe(true);
    expect(isFilterNarrowed({ from: "2020-01-01", to: DEFAULTS.to, status: "", attendee: "" }, TODAY)).toBe(true);
  });
});

describe("filterMeetings", () => {
  const rows = [
    meeting({ id: "old", scheduledAt: "2026-01-05T06:00:00.000Z" }),
    meeting({ id: "recent", scheduledAt: "2026-08-20T06:00:00.000Z", status: "published" }),
    meeting({ id: "other-people", scheduledAt: "2026-08-21T06:00:00.000Z", attendees: ["Sumeet"] }),
  ];

  test("the default 90-day range hides the January meeting", () => {
    expect(filterMeetings(rows, parseMomsFilter(null, TODAY)).map((r) => r.id)).toEqual(["recent", "other-people"]);
  });

  test("status narrows to exactly that status", () => {
    expect(filterMeetings(rows, { ...DEFAULTS, status: "published", attendee: "" }).map((r) => r.id)).toEqual(["recent"]);
  });

  test("the attendee box matches a name fragment, case-insensitively", () => {
    expect(filterMeetings(rows, { ...DEFAULTS, status: "", attendee: "priya" }).map((r) => r.id)).toEqual(["recent"]);
    expect(filterMeetings(rows, { ...DEFAULTS, status: "", attendee: "sum" }).map((r) => r.id)).toEqual(["other-people"]);
  });

  test("widening the range brings the January meeting back -- nothing is dropped permanently", () => {
    expect(filterMeetings(rows, { from: "2026-01-01", to: "2026-12-31", status: "", attendee: "" }).length).toBe(3);
  });

  test("a row with an unparseable date is KEPT -- hiding a real meeting is worse than showing an undatable one", () => {
    const broken = [meeting({ id: "broken", scheduledAt: "not a date" })];
    expect(filterMeetings(broken, parseMomsFilter(null, TODAY)).map((r) => r.id)).toEqual(["broken"]);
  });

  test("boundaries are inclusive on both ends", () => {
    const boundary = [
      meeting({ id: "from-day", scheduledAt: "2026-05-30T00:00:00.000Z" }),
      meeting({ id: "to-day", scheduledAt: "2026-08-28T23:00:00.000Z" }),
    ];
    expect(filterMeetings(boundary, parseMomsFilter(null, TODAY)).map((r) => r.id)).toEqual(["from-day", "to-day"]);
  });
});

describe("meetingStatusChip -- glyph plus word, never colour alone", () => {
  test("published is a filled sage circle and says the word", () => {
    expect(meetingStatusChip("published")).toEqual({ label: "published", filled: true, tone: "done" });
  });

  test("draft is a hollow grey circle and says the word", () => {
    expect(meetingStatusChip("draft")).toEqual({ label: "draft", filled: false, tone: "neutral" });
  });

  test("an unknown status shows its own word rather than being forced into a known bucket", () => {
    expect(meetingStatusChip("in_review")).toEqual({ label: "in_review", filled: false, tone: "neutral" });
    expect(meetingStatusChip("")).toEqual({ label: "unknown", filled: false, tone: "neutral" });
  });
});

describe("CSV export", () => {
  test("a leading =, +, - or @ is neutralised so a cell cannot execute on open", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@here")).toBe("'@here");
  });

  test("delimiters, quotes and newlines are quoted and escaped", () => {
    expect(csvCell('Kick-off, "Phase 1"')).toBe('"Kick-off, ""Phase 1"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  test("exports the visible rows with the same date form the table shows", () => {
    const csv = meetingsToCsv([meeting({ id: "m1", scheduledAt: "2026-08-28T06:00:00.000Z", openActionItems: 3 })]);
    expect(csv.split("\r\n")[0]).toBe("Meeting,Date & time,Attendees,Open actions,Status");
    // The date itself contains a comma, so the cell is quoted -- which is the
    // whole reason csvCell exists rather than a bare join.
    expect(csv.split("\r\n")[1]).toBe('Site coordination,"28 Aug 2026, 10:00",2,3,draft');
  });

  test("the all-projects export gains a Project column", () => {
    const csv = meetingsToCsv([meeting({ id: "m1" })], { projectNameFor: () => "Cedar Heights Villa - Phase 1" });
    expect(csv.split("\r\n")[0]).toBe("Meeting,Project,Date & time,Attendees,Open actions,Status");
    expect(csv.split("\r\n")[1]).toContain("Cedar Heights Villa - Phase 1");
  });

  test("an unknown aggregate exports an EMPTY cell, never a confident 0", () => {
    const csv = meetingsToCsv([
      meeting({ id: "m1", attendeesCount: null, openActionItems: undefined, attendees: undefined }),
    ]);
    expect(csv.split("\r\n")[1]).toBe('Site coordination,"20 Aug 2026, 10:00",,,draft');
  });

  test("attendees still export when only the raw array is present (the server half not yet deployed)", () => {
    const csv = meetingsToCsv([
      meeting({ id: "m1", attendeesCount: null, openActionItems: undefined, attendees: ["A", "B", "C"] }),
    ]);
    expect(csv.split("\r\n")[1]).toBe('Site coordination,"20 Aug 2026, 10:00",3,,draft');
  });

  test("the filename names the project and the range that produced it", () => {
    expect(momsCsvFilename("Cedar Heights Villa - Phase 1", { ...DEFAULTS, status: "", attendee: "" })).toBe(
      "moms-cedar-heights-villa-phase-1-2026-05-30-to-2026-08-28.csv"
    );
    expect(momsCsvFilename("All projects", { ...DEFAULTS, status: "", attendee: "" })).toBe(
      "moms-all-projects-2026-05-30-to-2026-08-28.csv"
    );
  });
});

describe("the two aggregate columns -- an absent count is not zero", () => {
  test("attendeesCount from the server is used verbatim", () => {
    expect(displayAttendeesCount(meeting({ id: "m1", attendeesCount: 7 }))).toBe(7);
  });

  test("with no server field, the row's own attendees array still answers the question", () => {
    expect(
      displayAttendeesCount(meeting({ id: "m1", attendeesCount: undefined, attendees: ["A", "", "B"] }))
    ).toBe(2);
  });

  test("with neither, the answer is 'we were not told' -- null, rendered as an en-dash", () => {
    const row = meeting({ id: "m1", attendeesCount: undefined, attendees: undefined });
    expect(displayAttendeesCount(row)).toBeNull();
    expect(countCell(displayAttendeesCount(row))).toBe("—");
  });

  test("openActionItems cannot be derived, so it is an en-dash until the server half ships -- never a confident 0", () => {
    expect(displayOpenActions(meeting({ id: "m1", openActionItems: undefined }))).toBeNull();
    expect(countCell(displayOpenActions(meeting({ id: "m1", openActionItems: undefined })))).toBe("—");
    expect(countCell(displayOpenActions(meeting({ id: "m1", openActionItems: 0 })))).toBe("0");
    expect(countCell(displayOpenActions(meeting({ id: "m1", openActionItems: 4 })))).toBe("4");
  });
});

describe("momsLoadErrorSentence", () => {
  test("names the project the user was actually looking at", () => {
    expect(momsLoadErrorSentence("Villa 21")).toBe(
      "Couldn't load meetings for Villa 21: the construction data service did not respond."
    );
  });
});
