/// <reference types="bun-types" />
// Sibling test for src/components/SkeletonTable.tsx, the loading primitive R67
// put in place of every module's centred Loader2 spinner.
//
// WHAT IS WORTH PINNING HERE. This component looks trivial, and the two things
// that make it worth having are exactly the two a careless edit would drop:
//
//  1. It renders the REAL column labels while the body loads. A skeleton with
//     generic grey bars and no headers tells the user nothing about what is
//     coming, and -- more practically -- a skeleton whose column count does not
//     match the real table's is what makes the card jump when the data lands,
//     which is the layout-reflow defect this component exists to remove.
//  2. The caption is announced (role="status"), because "what is loading" is
//     the answer a screen-reader user gets nothing else for; the skeleton rows
//     themselves are aria-hidden, since a row of placeholders read out cell by
//     cell is noise.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

const SkeletonTable = (await import("./SkeletonTable")).default;

const HEADERS = ["ID", "Name", "Trade", "Company", "Daily Rate", "Status"];

afterEach(() => cleanup());

describe("SkeletonTable", () => {
  test("renders the real column labels, so the header row is honest while the body loads", () => {
    const { getByText, container } = render(<SkeletonTable headers={HEADERS} />);
    for (const header of HEADERS) expect(getByText(header)).toBeDefined();
    expect(container.querySelectorAll("thead th").length).toBe(HEADERS.length);
  });

  test("the placeholder body is `rows` deep and every row is as wide as the header", () => {
    const { container } = render(<SkeletonTable headers={HEADERS} rows={3} />);
    const bodyRows = container.querySelectorAll("tbody tr");
    expect(bodyRows.length).toBe(3);
    // A skeleton narrower than the real table is what makes the card jump when
    // the data arrives -- the whole defect this component removes.
    for (const row of bodyRows) expect(row.querySelectorAll("td").length).toBe(HEADERS.length);
  });

  test("defaults to five rows when no count is given", () => {
    const { container } = render(<SkeletonTable headers={HEADERS} />);
    expect(container.querySelectorAll("tbody tr").length).toBe(5);
  });

  test("the caption says WHAT is loading and is announced; the placeholder rows are not", () => {
    const { getByRole, container } = render(
      <SkeletonTable headers={HEADERS} caption="Loading roster for Cedar Heights Villa - Phase 1…" />
    );
    expect(getByRole("status").textContent).toBe("Loading roster for Cedar Heights Villa - Phase 1…");
    for (const row of container.querySelectorAll("tbody tr")) {
      expect(row.getAttribute("aria-hidden")).not.toBeNull();
    }
  });

  test("no caption renders no status region at all -- an empty announcement is worse than none", () => {
    const { queryByRole } = render(<SkeletonTable headers={HEADERS} />);
    expect(queryByRole("status")).toBeNull();
  });
});
