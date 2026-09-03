/// <reference types="bun-types" />
// R67 E-02 (R-012), chart 1. The acceptance for this item is "an svg chart
// element containing at least fifteen bar rects (three per project)" whose
// "tooltip on hover contains the text 'contract'" -- both are properties of
// the rendered markup, so they are asserted on the rendered markup, through
// react-dom/server, exactly as the sibling component tests in this repo do.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { axisTicks, GroupedBarChart, type GroupedBarGroup, type GroupedBarSeries } from "./GroupedBarChart";

const SERIES: GroupedBarSeries[] = [
  { key: "contract", label: "Contract value", color: "var(--color-chart-1)" },
  { key: "earned", label: "Earned value", color: "var(--color-chart-2)" },
  { key: "spend", label: "Spend", color: "var(--color-chart-3)" },
];

function group(i: number, overrides: Partial<GroupedBarGroup> = {}): GroupedBarGroup {
  return {
    key: `p${i}`,
    label: `Project ${i}`,
    values: { contract: 1_000_000 * i, earned: 400_000 * i, spend: 250_000 * i },
    ...overrides,
  };
}

const FIVE = [group(1), group(2), group(3), group(4), group(5)];

describe("GroupedBarChart", () => {
  test("five projects x three series draws at least fifteen bar rects inside one svg", () => {
    const html = renderToStaticMarkup(<GroupedBarChart groups={FIVE} series={SERIES} title="Portfolio" />);
    expect(html).toContain("<svg");
    expect(Array.from(html.matchAll(/data-testid="grouped-bar-rect"/g))).toHaveLength(15);
  });

  test("every group carries ONE tooltip naming all three figures, so hovering answers the whole question", () => {
    const html = renderToStaticMarkup(<GroupedBarChart groups={FIVE} series={SERIES} title="Portfolio" moneyPrefix="AED " />);
    const titles = Array.from(html.matchAll(/<title>(.*?)<\/title>/gs)).map((m) => m[1]);
    // One per group, plus none anywhere else.
    expect(titles).toHaveLength(5);
    expect(titles[0]).toContain("Project 1");
    expect(titles[0]).toContain("contract");
    expect(titles[0]).toContain("earned value");
    expect(titles[0]).toContain("spend");
    expect(titles[0]).toContain("AED 1,000,000");
  });

  test("a figure that does not exist is HATCHED and named, never drawn as zero", () => {
    const html = renderToStaticMarkup(
      <GroupedBarChart
        groups={[group(1, { values: { contract: null, earned: null, spend: 120_000 } })]}
        series={SERIES}
        title="Portfolio"
      />
    );
    expect(html).toContain("url(#grouped-bar-hatch)");
    // Both the tooltip and the legend say what the hatch means, in words.
    expect(html).toContain("contract value No BOQ");
    // Still three rects: the bar is present and marked unknown, not omitted.
    expect(Array.from(html.matchAll(/data-testid="grouped-bar-rect"/g))).toHaveLength(3);
  });

  test("the legend names every series in words -- colour is never the only carrier", () => {
    const html = renderToStaticMarkup(<GroupedBarChart groups={FIVE} series={SERIES} title="Portfolio" />);
    for (const s of SERIES) expect(html).toContain(s.label);
  });

  test("an org with no currency gets bare numbers, never a guessed code", () => {
    const html = renderToStaticMarkup(<GroupedBarChart groups={[group(1)]} series={SERIES} title="Portfolio" />);
    const title = html.match(/<title>(.*?)<\/title>/s)![1];
    expect(title).toContain("1,000,000");
    expect(title).not.toContain("AED");
  });

  test("the svg is labelled with its own title, so it is announced rather than skipped", () => {
    const html = renderToStaticMarkup(<GroupedBarChart groups={FIVE} series={SERIES} title="Contract, earned and spend by project" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Contract, earned and spend by project"');
  });

  test("the chart scrolls inside its own container -- the page body must never scroll sideways", () => {
    const html = renderToStaticMarkup(<GroupedBarChart groups={FIVE} series={SERIES} title="Portfolio" />);
    expect(html).toContain("overflow-x-auto");
  });
});

describe("axisTicks", () => {
  test("returns count+1 ticks from zero to the maximum", () => {
    expect(axisTicks(1000, 4)).toEqual([0, 250, 500, 750, 1000]);
  });

  test("a maximum of zero (or a broken one) still yields a drawable axis rather than NaN", () => {
    expect(axisTicks(0)).toEqual([0]);
    expect(axisTicks(Number.NaN)).toEqual([0]);
  });
});
