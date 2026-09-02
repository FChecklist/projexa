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
