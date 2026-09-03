/// <reference types="bun-types" />
// R67 E-03 (R-072/R-073/R-076/R-077) and binding decision D-02. The rules the
// WPR runs on arrival with, asserted directly.
import { describe, expect, test } from "bun:test";
import {
  captionDate,
  isoDay,
  noProgressNotice,
  reportCaption,
  resolveDefaultFrom,
  resolveReportParams,
  THIRD_COLUMN_NOTE,
  whatsappHref,
  whatsappMessage,
} from "./work-progress-report-params";

/** A stand-in for URLSearchParams that is explicit about what the URL carries. */
function search(entries: Record<string, string> = {}) {
  return { get: (k: string) => (k in entries ? entries[k] : null) };
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

describe("resolveReportParams", () => {
  test("with an empty URL, the report still has a real range to run on arrival", () => {
    const params = resolveReportParams(search(), { earliestEntryDate: "2026-01-15", today: TODAY });
    expect(params).toEqual({ from: "2026-01-15", to: TODAY, view: "scope", boqVersion: "" });
  });

  test("every parameter the URL carries is honoured -- the URL is the state", () => {
    const params = resolveReportParams(
      search({ from: "2026-02-01", to: "2026-02-28", view: "category", boqVersion: "boq_7" }),
      { today: TODAY }
    );
    expect(params).toEqual({ from: "2026-02-01", to: "2026-02-28", view: "category", boqVersion: "boq_7" });
  });

  test("a junk view falls back to the scope tab rather than rendering nothing", () => {
    expect(resolveReportParams(search({ view: "nonsense" }), { today: TODAY }).view).toBe("scope");
  });

  test("a junk date falls back to the computed default rather than reaching the query", () => {
    const params = resolveReportParams(search({ from: "01/02/2026" }), { earliestEntryDate: "2026-01-15", today: TODAY });
    expect(params.from).toBe("2026-01-15");
  });

  test("a From later than the To is honoured, not silently 'corrected'", () => {
    // Narrowing to nothing is a legitimate request, and the screen states an
    // empty result in words. Rewriting someone's shared link would be worse.
    const params = resolveReportParams(search({ from: "2026-09-02", to: "2026-01-01" }), { today: TODAY });
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
