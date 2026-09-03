/// <reference types="bun-types" />
// R67 F-30. The strip that answers "who turned up today" above the tabs,
// without the foreman having to open a tab and read a table.

import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { AttendanceSummaryStrip, AttendanceSummaryStripSkeleton } from "./AttendanceSummaryStrip";

afterEach(cleanup);

const SUMMARY = { date: "2026-09-02", recorded: 3, present: 1, halfDay: 1, absent: 1, totalCost: 750 };

describe("AttendanceSummaryStrip", () => {
  test("states the day it is about, not just 'today'", () => {
    // A summary is only useful if you can see which day it covers -- the
    // server's own date and the site's date are not always the same day.
    const { getByText } = render(<AttendanceSummaryStrip summary={SUMMARY} />);
    // format-date.ts pins en-US + UTC, so a plain YYYY-MM-DD renders as the
    // same calendar day everywhere -- never a day earlier east of Greenwich.
    expect(getByText(/Attendance on 9\/2\/2026/)).toBeDefined();
  });

  test("shows the three counts and the day's labour cost, in the org currency", () => {
    const { getByText } = render(<AttendanceSummaryStrip summary={SUMMARY} currencyCode="INR" />);
    expect(getByText("present")).toBeDefined();
    expect(getByText("half day")).toBeDefined();
    expect(getByText("absent")).toBeDefined();
    expect(getByText("INR 750")).toBeDefined();
  });

  test("a day with nothing marked says so -- it is an answer, and it is what 9 a.m. looks like", () => {
    const { getByText, container } = render(
      <AttendanceSummaryStrip summary={{ ...SUMMARY, recorded: 0, present: 0, halfDay: 0, absent: 0, totalCost: 0 }} />
    );
    expect(getByText("Nothing marked yet.")).toBeDefined();
    // `empty`, not `loading`: the read finished. A latency measurement counts
    // this screen as usable here, and correctly.
    expect(container.querySelector("[data-state='empty']")).not.toBeNull();
  });

  test("a failed read shows the backend's own words, never a strip of zeroes", () => {
    const { getByRole, queryByText } = render(
      <AttendanceSummaryStrip summary={null} errorMessage="The construction data service did not respond in time." />
    );
    expect(getByRole("alert").textContent).toBe("The construction data service did not respond in time.");
    // Zeroes over a failed read would state that nobody turned up today.
    expect(queryByText("present")).toBeNull();
  });

  test("no summary and no error renders nothing at all", () => {
    const { container } = render(<AttendanceSummaryStrip summary={null} />);
    expect(container.innerHTML).toBe("");
  });

  test("rows on screen report data-state='ready' for the latency script", () => {
    const { container } = render(<AttendanceSummaryStrip summary={SUMMARY} />);
    expect(container.querySelector("[data-state='ready']")).not.toBeNull();
  });

  test("the fallback is busy and marked loading, so its own boundary is measurable too", () => {
    const { container } = render(<AttendanceSummaryStripSkeleton />);
    const region = container.querySelector("[data-state='loading']");
    expect(region).not.toBeNull();
    expect(region!.getAttribute("aria-busy")).toBe("true");
  });
});
