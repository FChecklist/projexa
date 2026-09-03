/// <reference types="bun-types" />
// R67 D-04 -- the Suspense fallback's two rules.
//
// src/lib/screen-budget.test.ts asserts stillLoadingCaption()'s timeline as a
// pure function. What only a render can show is that the fallback obeys the
// rule the caption exists to serve: the caption is an EXTRA LINE, added below
// a skeleton that never moves. A fallback that swapped the skeleton for the
// caption at three seconds would pass every pure test and would still shift
// the page under a user who is already reading it.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import ScreenLoading from "./ScreenLoading";

afterEach(cleanup);

describe("ScreenLoading", () => {
  test("it is a skeleton in the shape of the real table, not a wordless spinner", () => {
    const { container } = render(<ScreenLoading entity="permits" rows={5} columns={4} />);

    // A spinner says "something is happening"; this says "a table with four
    // columns and five rows is coming".
    const skeletons = container.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBe(4 + 5 * 4); // one header row plus five body rows
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  test("the wait is announced politely, naming what is loading", () => {
    const { container } = render(<ScreenLoading entity="permits" />);
    const region = container.querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute("aria-live")).toBe("polite");
    // A screen reader should hear the module's own noun, not "loading".
    expect(region?.getAttribute("aria-label")).toBe("Loading permits");
  });

  test("nothing is said at mount -- a fast read must not flash text", () => {
    const { queryByTestId } = render(<ScreenLoading entity="permits" />);
    expect(queryByTestId("screen-loading-caption")).toBeNull();
  });

  test("the skeleton is present from the first frame, so the caption can only ever be an EXTRA line", () => {
    // The load-bearing property: the caption that appears at three seconds is
    // rendered as a sibling BELOW this frame, never in place of it, so nothing
    // the user is aiming at moves when it arrives.
    const { getByTestId, container } = render(<ScreenLoading entity="permits" rows={3} columns={2} />);
    const frame = getByTestId("screen-loading");
    expect(frame.firstElementChild?.getAttribute("role")).toBe("status");
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(2 + 3 * 2);
  });

  test("the row and column counts are the caller's, so each module's skeleton matches its own table", () => {
    const { container } = render(<ScreenLoading entity="the timesheet" rows={5} columns={6} />);
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBe(6 + 5 * 6);
  });
});
