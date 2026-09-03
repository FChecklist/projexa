/// <reference types="bun-types" />
// R67 E-17 (R-175). The two decisions in this component -- the order and the
// width -- asserted directly, plus the rendered rules that carry them.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { SortedBarList, barWidth, sortBars } from "./SortedBarList";

afterEach(cleanup);

const BARS = [
  { key: "civil", label: "Civil", value: 5400, display: "AED 5,400.00" },
  { key: "paint", label: "Paint", value: 9800, display: "AED 9,800.00" },
  { key: "mep", label: "MEP", value: 9800, display: "AED 9,800.00" },
];

describe("sortBars", () => {
  test("largest first -- a reader came to find the biggest, not the alphabetical first", () => {
    expect(sortBars(BARS).map((b) => b.key)).toEqual(["mep", "paint", "civil"]);
  });

  test("a tie falls back to the label, so the order is stable between renders", () => {
    expect(sortBars(BARS).slice(0, 2).map((b) => b.label)).toEqual(["MEP", "Paint"]);
  });

  test("the caller's array is not mutated", () => {
    const input = [...BARS];
    sortBars(input);
    expect(input.map((b) => b.key)).toEqual(["civil", "paint", "mep"]);
  });
});

describe("barWidth", () => {
  test("a bar is a percentage of the largest figure in its own list", () => {
    expect(barWidth(9800, 9800)).toBe(100);
    expect(barWidth(4900, 9800)).toBe(50);
  });

  test("nothing can draw past the track, and a negative figure draws nothing rather than backwards", () => {
    expect(barWidth(20000, 9800)).toBe(100);
    expect(barWidth(-5, 9800)).toBe(0);
  });

  test("an all-zero list draws no bars rather than dividing by zero", () => {
    expect(barWidth(0, 0)).toBe(0);
  });
});

describe("SortedBarList rendered", () => {
  test("every bar prints its figure beside it -- the length is never the only carrier", () => {
    const { getAllByTestId, getByText } = render(<SortedBarList bars={BARS} title="Amount by category" />);
    expect(getAllByTestId("sorted-bar-fill")).toHaveLength(3);
    expect(getByText("AED 5,400.00")).toBeTruthy();
  });

  test("with no bars it says so, rather than rendering an empty frame", () => {
    const { getByTestId } = render(<SortedBarList bars={[]} title="Amount by category" />);
    expect(getByTestId("sorted-bar-empty").textContent).toBe("Nothing to chart for this period.");
  });

  test("without onSelect there are no buttons -- a dead click is worse than no click", () => {
    const { queryAllByTestId } = render(<SortedBarList bars={BARS} title="Amount by category" />);
    expect(queryAllByTestId("sorted-bar-row")).toHaveLength(0);
  });

  test("with onSelect every bar is a real button and reports which one was pressed", () => {
    const pressed: string[] = [];
    const { getAllByTestId } = render(
      <SortedBarList bars={BARS} title="Amount by category" onSelect={(k) => pressed.push(k)} selectedKey="paint" />
    );
    const rows = getAllByTestId("sorted-bar-row");
    expect(rows).toHaveLength(3);
    (rows[0] as HTMLButtonElement).click();
    expect(pressed).toEqual(["mep"]); // the first row is the largest, not the first given
    // The selected bar is marked, and by a real ARIA state rather than a colour.
    expect(rows.find((r) => r.getAttribute("aria-pressed") === "true")?.textContent).toContain("Paint");
  });
});
