/// <reference types="bun-types" />
// R67 D-02. This fork exists for exactly one behaviour, so that behaviour is
// what is held here: a KPI with no real delta behind it renders NO arrow and
// NO status colour, and a KPI that does have one still renders both exactly
// as the kit's card does.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// render()'s bound queries, not `screen` -- see ProjectCreateClient.test.tsx.
import { cleanup, fireEvent, render } from "@testing-library/react";

const { KpiCard } = await import("./KpiCard");

afterEach(cleanup);

describe("KpiCard (projexa fork)", () => {
  test("renders no arrow glyph at all when no trend is given", () => {
    const view = render(<KpiCard label="Revenue" value="AED 847,300" baseline="invoiced to date" />);
    const text = view.container.textContent ?? "";
    expect(text).toContain("Revenue");
    expect(text).toContain("AED 847,300");
    expect(text).toContain("invoiced to date");
    for (const arrow of ["↑", "↓", "→"]) expect(text).not.toContain(arrow);
  });

  test("emits no status colour either -- nothing carries a --color-veri-status-* variable", () => {
    const view = render(<KpiCard label="Revenue" value="AED 847,300" baseline="invoiced to date" />);
    expect(view.container.innerHTML).not.toContain("--color-veri-status-");
  });

  test("a real trend still renders its arrow, its words and its tone, exactly as the kit card does", () => {
    const view = render(
      <KpiCard label="Spend" value="AED 1,250,000" trend={{ direction: "up", tone: "late", label: "over budget" }} baseline="budget AED 900,000" />
    );
    expect(view.container.textContent).toContain("↑");
    expect(view.container.textContent).toContain("over budget");
    expect(view.container.innerHTML).toContain("--color-veri-status-late");
  });

  test("an explicit null trend is treated as no trend, not as a crash", () => {
    const view = render(<KpiCard label="Permits expiring" value="0" trend={null} baseline="next 30 days" />);
    expect(view.container.textContent).toContain("next 30 days");
    expect(view.container.textContent).not.toContain("→");
  });

  test("every KPI value is still a door: with onClick it is a real button that fires", () => {
    const onClick = mock(() => {});
    const view = render(<KpiCard label="Revenue" value="AED 1" baseline="invoiced to date" onClick={onClick} />);
    const button = view.getByRole("button");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("without onClick it is not a button, so nothing advertises a destination it does not have", () => {
    const view = render(<KpiCard label="Revenue" value="AED 1" baseline="invoiced to date" />);
    expect(view.queryByRole("button")).toBeNull();
  });
});

// R67 D-61 (audit R-226). The kit set every KPI value in `font-heading` --
// DM Serif Display. A display serif has proportional, old-style figures, so a
// column of numbers set in it does not line up and a seven-digit dirham figure
// at 36 px reads as decoration. The serif stays for the page H1 and card
// titles; the numbers are Inter 600 with tabular figures, at the two sizes the
// item fixes.
describe("KpiCard typography (R67 D-61)", () => {
  function valueClass(html: string, value: string): string {
    const re = new RegExp(`<div class="([^"]*)">${value}</div>`);
    return re.exec(html)?.[1] ?? "";
  }

  test("the hero value is Inter 600 at 32 px, with tabular figures", () => {
    const view = render(<KpiCard label="Portfolio earned value" value="AED 1,000,000.00" baseline="of AED 4,000,000.00 contract" size="primary" />);
    const cls = valueClass(view.container.innerHTML, "AED 1,000,000.00");
    expect(cls).toContain("font-sans");
    expect(cls).toContain("font-semibold");
    expect(cls).toContain("tabular-nums");
    expect(cls).toContain("text-[32px]");
  });

  test("a supporting value is the same treatment at 20 px", () => {
    const view = render(<KpiCard label="Revenue" value="AED 847,300.00" baseline="invoiced to date" />);
    const cls = valueClass(view.container.innerHTML, "AED 847,300.00");
    expect(cls).toContain("font-sans");
    expect(cls).toContain("tabular-nums");
    expect(cls).toContain("text-[20px]");
  });

  test("no KPI value is set in the display serif any more, at either size", () => {
    for (const size of ["primary", "secondary"] as const) {
      const view = render(<KpiCard label="Spend" value="AED 12.00" baseline="budget not set" size={size} />);
      expect(valueClass(view.container.innerHTML, "AED 12.00")).not.toContain("font-heading");
      cleanup();
    }
  });
});
