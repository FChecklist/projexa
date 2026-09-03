/// <reference types="bun-types" />
// R67 E-03 (R-072/R-073/R-076/R-077) and binding decision D-02. The rules the
// WPR runs on arrival with, asserted directly.
import { describe, expect, test } from "bun:test";
import {
  captionDate,
  isoDay,
  matchPeriodPreset,
  noProgressNotice,
  periodLine,
  periodPresetRange,
  reportCaption,
  resolveDefaultFrom,
  resolveWprParams,
  THIRD_COLUMN_NOTE,
  whatsappHref,
  whatsappMessage,
  wprRunningLine,
  WPR_STILL_RUNNING_MS,
  WPR_STILL_RUNNING_NOTE,
} from "./work-progress-report-params";

/** What the URL carries, as the merged resolver reads it. */
function search(entries: Record<string, string> = {}) {
  return entries;
}

const TODAY = "2026-09-02";

describe("resolveDefaultFrom", () => {
  test("the earliest recorded entry date wins -- the report opens on the work that exists", () => {
    expect(resolveDefaultFrom({ earliestEntryDate: "2026-03-14", projectStartDate: "2026-01-05", today: TODAY }))
      .toBe("2026-03-14");
  });

  test("no entries yet falls back to the project's own start date", () => {
    expect(resolveDefaultFrom({ earliestEntryDate: null, projectStartDate: "2026-01-05", today: TODAY }))
      .toBe("2026-01-05");
  });

  test("neither falls back to 1 January of the current year -- never 'the 1st of this month'", () => {
    // The shipped defaultFrom() returned the 1st of the current month, which
    // on the 2nd of a month is a TWO-DAY window: a busy project reads as idle.
    expect(resolveDefaultFrom({ today: TODAY })).toBe("2026-01-01");
    expect(resolveDefaultFrom({ today: "2027-09-02" })).toBe("2027-01-01");
  });

  test("a malformed stored date is ignored rather than passed through into a query", () => {
    expect(resolveDefaultFrom({ earliestEntryDate: "not-a-date", projectStartDate: "", today: TODAY }))
      .toBe("2026-01-01");
  });
});

describe("resolveWprParams", () => {
  test("with an empty URL, the report still has a real range to run on arrival", () => {
    const params = resolveWprParams(search(), { earliestEntryDate: "2026-01-15", today: TODAY });
    expect(params).toEqual({ from: "2026-01-15", to: TODAY, view: "scope", boqVersion: null });
  });

  test("every parameter the URL carries is honoured -- the URL is the state", () => {
    const params = resolveWprParams(
      search({ from: "2026-02-01", to: "2026-02-28", view: "category", boqVersion: "7" }),
      { today: TODAY }
    );
    // R67 D-02: the BOQ rides in the URL as a stable, readable VERSION rather
    // than a cuid, so a pasted link says which revision it is about.
    expect(params).toEqual({ from: "2026-02-01", to: "2026-02-28", view: "category", boqVersion: 7 });
  });

  test("a junk view falls back to the scope tab rather than rendering nothing", () => {
    expect(resolveWprParams(search({ view: "nonsense" }), { today: TODAY }).view).toBe("scope");
  });

  test("a junk date falls back to the computed default rather than reaching the query", () => {
    const params = resolveWprParams(search({ from: "01/02/2026" }), { earliestEntryDate: "2026-01-15", today: TODAY });
    expect(params.from).toBe("2026-01-15");
  });

  test("a From later than the To is honoured, not silently 'corrected'", () => {
    // Narrowing to nothing is a legitimate request, and the screen states an
    // empty result in words. Rewriting someone's shared link would be worse.
    const params = resolveWprParams(search({ from: "2026-09-02", to: "2026-01-01" }), { today: TODAY });
    expect(params.from).toBe("2026-09-02");
    expect(params.to).toBe("2026-01-01");
  });
});

describe("captionDate / isoDay", () => {
  test("renders the caption's date shape", () => {
    expect(captionDate("2026-01-01")).toBe("1 Jan 2026");
    expect(captionDate("2026-09-02")).toBe("2 Sep 2026");
  });

  test("a date at the very start of a day does not slip to the previous one", () => {
    // The pinned UTC timezone is the whole point: a local-time parse renders
    // "31 Dec 2025" for this input anywhere west of Greenwich.
    expect(captionDate("2026-01-01")).toContain("2026");
  });

  test("isoDay round-trips through captionDate", () => {
    expect(isoDay(new Date("2026-09-02T11:30:00Z"))).toBe("2026-09-02");
  });
});

describe("reportCaption", () => {
  test("one sentence carrying the range, the BOQ revision and the third-column choice", () => {
    expect(
      reportCaption({ from: "2026-01-01", to: "2026-09-02", boqTitle: "Tower B Fit-out", boqVersionLabel: "v2", mode: "total" })
    ).toBe("Showing 1 Jan 2026 – 2 Sep 2026 · BOQ Tower B Fit-out v2 · Third column: Total");
  });

  test("the third-column choice follows the toggle, so an export cannot mislabel its own column", () => {
    expect(
      reportCaption({ from: "2026-01-01", to: "2026-09-02", boqTitle: "Tower B Fit-out", boqVersionLabel: "v2", mode: "balance" })
    ).toContain("Third column: Balance");
  });

  test("no BOQ says so rather than leaving a dangling separator", () => {
    expect(reportCaption({ from: "2026-01-01", to: "2026-09-02", boqTitle: null, boqVersionLabel: null, mode: "total" }))
      .toContain("No BOQ selected");
  });

  test("the third-column note is a sentence, not a tooltip -- it survives a printout", () => {
    expect(THIRD_COLUMN_NOTE).toBe("Total = to-date; Balance = contract less to-date");
  });
});

describe("noProgressNotice", () => {
  const untouched = { touched: { prev: false, current: false, total: false } };
  const touched = { touched: { prev: false, current: true, total: true } };

  test("nothing recorded anywhere: the reader is told, so 0 % is never read as zero work", () => {
    expect(noProgressNotice([untouched, untouched], "2026-01-01", "2026-09-02"))
      .toBe("No progress recorded between 1 Jan 2026 and 2 Sep 2026");
  });

  test("one touched bucket anywhere is enough to suppress it -- the notice is about NOTHING, not about a little", () => {
    expect(noProgressNotice([untouched, touched], "2026-01-01", "2026-09-02")).toBeNull();
  });

  test("a project with no BOQ lines at all gets the table's own empty state, not this one", () => {
    expect(noProgressNotice([], "2026-01-01", "2026-09-02")).toBeNull();
  });
});

describe("whatsappMessage / whatsappHref", () => {
  test("names the project, the range and the link -- nothing the recipient has to decode", () => {
    expect(
      whatsappMessage({ projectName: "Cedar Heights Villa - Phase 1", from: "2026-01-01", to: "2026-09-02", url: "https://x/y" })
    ).toBe("Work Progress Report – Cedar Heights Villa - Phase 1, 1 Jan 2026–2 Sep 2026: https://x/y");
  });

  test("the href encodes the whole message, so an ampersand in a project name cannot truncate it", () => {
    const href = whatsappHref("A & B: https://x/y?z=1");
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(href.slice("https://wa.me/?text=".length))).toBe("A & B: https://x/y?z=1");
  });
});

// R67 E-17 (R-175) / E-20 (R-194). The period chips.
describe("periodPresetRange / matchPeriodPreset (R67 E-17)", () => {
  const CTX = { today: "2026-09-03", earliestFrom: "2025-11-14" };

  test("each preset means one real, named window", () => {
    expect(periodPresetRange("all", CTX)).toEqual({ from: "2025-11-14", to: "2026-09-03" });
    expect(periodPresetRange("this-month", CTX)).toEqual({ from: "2026-09-01", to: "2026-09-03" });
    expect(periodPresetRange("last-month", CTX)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(periodPresetRange("this-year", CTX)).toEqual({ from: "2026-01-01", to: "2026-09-03" });
  });

  test("last month crosses a year boundary without a special case", () => {
    const january = { today: "2026-01-09", earliestFrom: "2025-01-01" };
    expect(periodPresetRange("last-month", january)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  test("last month knows February", () => {
    expect(periodPresetRange("last-month", { today: "2026-03-05", earliestFrom: "2020-01-01" }))
      .toEqual({ from: "2026-02-01", to: "2026-02-28" });
    // 2028 is a leap year.
    expect(periodPresetRange("last-month", { today: "2028-03-05", earliestFrom: "2020-01-01" }))
      .toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  test("the lit chip is the one whose window the range really is", () => {
    expect(matchPeriodPreset({ from: "2026-09-01", to: "2026-09-03" }, CTX)).toBe("this-month");
    expect(matchPeriodPreset({ from: "2025-11-14", to: "2026-09-03" }, CTX)).toBe("all");
  });

  test("a range that matches NO preset is custom -- never the nearest chip", () => {
    // A shared link, or a hand-typed window. Lighting "this month" here would
    // tell the reader they are looking at a window they are not.
    expect(matchPeriodPreset({ from: "2026-09-02", to: "2026-09-03" }, CTX)).toBeNull();
  });

  test("the grey period line names the window AND the preset it corresponds to", () => {
    expect(periodLine({ from: "2026-09-01", to: "2026-09-03" }, CTX))
      .toBe("Showing 1 Sep 2026 – 3 Sep 2026 (this month)");
    // A custom window still says what it is showing; it just has no name.
    expect(periodLine({ from: "2026-09-02", to: "2026-09-03" }, CTX))
      .toBe("Showing 2 Sep 2026 – 3 Sep 2026");
  });
});

describe("the run's own state, in words (R67 E-17)", () => {
  test("the running line counts seconds, so a slow report is distinguishable from a hung one", () => {
    expect(wprRunningLine(3)).toBe("Running Work Progress Report – 3 s");
  });

  test("after twenty seconds the screen says what it thinks is happening -- and does NOT abort", () => {
    expect(WPR_STILL_RUNNING_MS).toBe(20_000);
    expect(WPR_STILL_RUNNING_NOTE).toBe("Still running – the data service is slow; you can keep waiting or cancel");
  });
});

// ---------------------------------------------------------------------------
// MERGE NOTE (2026-09-03): lane D's sibling test for the same module. Both
// halves are pure static-import tests, so they live in one file. Its
// projexaReportDestination block moved with the function itself to
// report-destinations.test.ts -- there is one destination table now, so there
// is one test for it.
// ---------------------------------------------------------------------------

// R67 D-02 -- one Work Progress Report, its parameters in the URL, run on
// arrival (decision D-02, correction C-04).
import {
  defaultWprRange,
  isoDate,
  parseWprParams,
  workProgressReportHref,
  wprSearchParams,
} from "./work-progress-report-params";

// A fixed local date so every assertion below is deterministic on any machine.
const TODAY_DATE = new Date(2026, 8, 2); // 2 September 2026, local calendar

describe("defaultWprRange", () => {
  test("opens on the first of the current month through today", () => {
    expect(defaultWprRange(TODAY_DATE)).toEqual({ from: "2026-09-01", to: "2026-09-02" });
  });

  test("uses the local calendar, not UTC -- a date near midnight must not slide a day", () => {
    expect(isoDate(new Date(2026, 0, 1, 23, 30))).toBe("2026-01-01");
  });
});

describe("parseWprParams", () => {
  test("an empty URL yields the default month-to-date, scope view, server-picked BOQ", () => {
    expect(parseWprParams({}, TODAY_DATE)).toEqual({
      from: "2026-09-01",
      to: "2026-09-02",
      view: "scope",
      boqVersion: null,
    });
  });

  test("real parameters survive a round trip through the URL", () => {
    const parsed = parseWprParams(
      { from: "2026-07-01", to: "2026-07-31", view: "manpower", boqVersion: "3" },
      TODAY_DATE
    );
    expect(parsed).toEqual({ from: "2026-07-01", to: "2026-07-31", view: "manpower", boqVersion: 3 });
  });

  test("a malformed bookmark still shows the current month rather than failing to run", () => {
    const parsed = parseWprParams(
      { from: "01/07/2026", to: "not-a-date", view: "nonsense", boqVersion: "-2" },
      TODAY_DATE
    );
    expect(parsed).toEqual({ from: "2026-09-01", to: "2026-09-02", view: "scope", boqVersion: null });
  });
});

describe("wprSearchParams", () => {
  test("always carries tab=report, so a link never lands on Daily Entry", () => {
    const search = wprSearchParams(parseWprParams({}, TODAY_DATE), "proj-1");
    expect(search.get("tab")).toBe("report");
    expect(search.get("projectId")).toBe("proj-1");
    expect(search.get("from")).toBe("2026-09-01");
    expect(search.get("view")).toBe("scope");
  });

  test("omits boqVersion when the server is to pick the BOQ", () => {
    expect(wprSearchParams(parseWprParams({}, TODAY_DATE), null).has("boqVersion")).toBe(false);
    expect(wprSearchParams({ ...parseWprParams({}, TODAY_DATE), boqVersion: 2 }, null).get("boqVersion")).toBe("2");
  });
});

describe("workProgressReportHref", () => {
  test("is the /work-progress Report tab, with the parameters in the URL", () => {
    const href = workProgressReportHref("proj-1", { view: "category" }, TODAY_DATE);
    expect(href.startsWith("/work-progress?")).toBe(true);
    const search = new URLSearchParams(href.split("?")[1]);
    expect(search.get("projectId")).toBe("proj-1");
    expect(search.get("tab")).toBe("report");
    expect(search.get("view")).toBe("category");
  });
});
