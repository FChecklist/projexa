/// <reference types="bun-types" />
// R67 F-02/F-03/F-04. Two properties are worth pinning here, because both
// were the actual defect this component replaces:
//
//  1. the REAL column headers are on screen while loading -- a centred spinner
//     told the reader nothing and made the page reflow when data landed;
//  2. it does not flash. A skeleton that appears for 80 ms reads as a glitch,
//     so nothing renders until delayMs has passed -- which, on the warm,
//     cached responses this whole workstream exists to produce, means nothing
//     renders at all.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own note.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
// NOTE: `screen` is deliberately NOT imported. @testing-library/dom binds its
// screen queries to document.body at module-evaluation time, and ESM
// evaluates every static import BEFORE this file's body -- i.e. before
// GlobalRegistrator.register() has created `document` -- so `screen` throws
// "a global document has to be available". Every query below comes from the
// render() result instead, which is bound per-render, after the DOM exists.
import { cleanup, render, waitFor } from "@testing-library/react";

const { TableLoadingRows } = await import("./TableLoadingRows");

afterEach(cleanup);

const HEADERS = ["Title", "Version", "Status", "Variation vs. prior", "Created"];

describe("TableLoadingRows", () => {
  test("with delayMs=0 it paints the real headers immediately", () => {
    const { getByText } = render(<TableLoadingRows headers={HEADERS} rows={6} caption="Loading BOQs..." delayMs={0} />);

    for (const header of HEADERS) {
      expect(getByText(header)).toBeDefined();
    }
  });

  test("it renders exactly the requested number of grey rows", () => {
    const { getAllByTestId } = render(<TableLoadingRows headers={HEADERS} rows={6} delayMs={0} />);

    expect(getAllByTestId("table-loading-row")).toHaveLength(6);
  });

  test("the caption is announced as a status, not silently drawn", () => {
    const { getByRole } = render(<TableLoadingRows headers={HEADERS} caption="Loading BOQs..." delayMs={0} />);

    const status = getByRole("status");
    expect(status.textContent).toBe("Loading BOQs...");
  });

  test("the table is marked aria-busy so a screen reader is not read an empty grid", () => {
    const { container } = render(<TableLoadingRows headers={HEADERS} delayMs={0} />);

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  test("nothing renders before the delay elapses -- no flash on a fast response", async () => {
    const { container, getByText } = render(<TableLoadingRows headers={HEADERS} delayMs={150} />);

    // The whole point: at mount time there is no skeleton to flash.
    expect(container.textContent).toBe("");

    await waitFor(() => expect(getByText("Title")).toBeDefined(), { timeout: 2000 });
  });

  test("defaults to three rows", () => {
    const { getAllByTestId } = render(<TableLoadingRows headers={["A", "B"]} delayMs={0} />);

    expect(getAllByTestId("table-loading-row")).toHaveLength(3);
  });
});
