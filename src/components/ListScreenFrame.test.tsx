/// <reference types="bun-types" />
// R67 F-31. Proves the two things a Playwright budget and a waiting user each
// depend on: the machine-readable state of the list region, and the fact that
// a wait acquires words instead of staying a bare spinner.
//
// The two timing tests deliberately use REAL timers and real elapsed time. The
// thresholds are the product decision (3 s, 8 s) and D-04's abort budget; a
// fake-timer test would assert that the component reads a constant, not that a
// user staring at the screen is told anything.
//
// Queries come from the render RESULT, never from `screen`: this suite's
// happy-dom global is registered at module scope, and @testing-library's
// `screen` binds to document.body at ITS import time, which is earlier.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import ListScreenFrame, { ListLoadingWords, ListStateRegion } from "./ListScreenFrame";

afterEach(cleanup);

function region(container: HTMLElement): HTMLElement {
  const el = container.querySelector("[data-state]");
  if (!el) throw new Error("no [data-state] region rendered");
  return el as HTMLElement;
}

describe("ListScreenFrame data-state", () => {
  test("a list with nothing yet is loading, and is marked busy", () => {
    const { container, queryByText } = render(
      <ListScreenFrame label="minutes" loading rowCount={0}>
        <p>rows</p>
      </ListScreenFrame>
    );
    expect(region(container).getAttribute("data-state")).toBe("loading");
    expect(region(container).getAttribute("aria-busy")).toBe("true");
    // The body is NOT rendered while loading -- an empty table under a spinner
    // is the "no data" lie this whole item removes.
    expect(queryByText("rows")).toBeNull();
  });

  test("rows on screen are ready, not busy, and the body renders", () => {
    const { container, getByText } = render(
      <ListScreenFrame label="minutes" loading={false} rowCount={2}>
        <p>rows</p>
      </ListScreenFrame>
    );
    expect(region(container).getAttribute("data-state")).toBe("ready");
    expect(region(container).getAttribute("aria-busy")).toBe("false");
    expect(getByText("rows")).toBeDefined();
  });

  test("a backend answer of 'there are none' is empty -- a usable state, not a wait", () => {
    const { container, getByText } = render(
      <ListScreenFrame label="minutes" loading={false} rowCount={0}>
        <p>No meetings recorded yet.</p>
      </ListScreenFrame>
    );
    expect(region(container).getAttribute("data-state")).toBe("empty");
    expect(getByText("No meetings recorded yet.")).toBeDefined();
  });

  test("a failed read is error, and the backend's own sentence is what renders", () => {
    const { container, getByRole } = render(
      <ListScreenFrame label="minutes" loading={false} error="Storage is not configured" rowCount={0}>
        <p role="alert">Storage is not configured</p>
      </ListScreenFrame>
    );
    expect(region(container).getAttribute("data-state")).toBe("error");
    expect(getByRole("alert").textContent).toBe("Storage is not configured");
  });

  test("ListStateRegion carries the attribute on its own, for early-return screens", () => {
    const { container } = render(<ListStateRegion state="ready"><p>board</p></ListStateRegion>);
    expect(region(container).getAttribute("data-state")).toBe("ready");
  });
});

describe("the waiting words", () => {
  test("nothing is said while the wait is still ordinary", () => {
    const { queryByText } = render(<ListLoadingWords label="minutes" />);
    expect(queryByText(/Still loading/)).toBeNull();
  });

  test(
    "at 3 s the region names what it is waiting for, with a counter",
    async () => {
      const { getByText, queryByRole } = render(
        <ListScreenFrame label="minutes" loading rowCount={0} onRetry={() => {}} />
      );
      await waitFor(() => expect(getByText(/Still loading minutes/)).toBeDefined(), {
        timeout: 6_000,
        interval: 200,
      });
      // The counter is part of the sentence, not decoration.
      expect(getByText(/Still loading minutes… \d+ s/)).toBeDefined();
      // Retry is NOT offered yet: at 3 s the request is still running and
      // re-issuing it would only add load.
      expect(queryByRole("button", { name: "Retry" })).toBeNull();
    },
    15_000
  );

  test(
    "at 8 s -- the abort budget -- it says the wait is abnormal and offers Retry",
    async () => {
      let retried = 0;
      const { getByRole, getByText } = render(
        <ListScreenFrame label="roster" loading rowCount={0} onRetry={() => { retried += 1; }} />
      );
      const retry = await waitFor(() => getByRole("button", { name: "Retry" }), {
        timeout: 14_000,
        interval: 250,
      });
      expect(getByText("This is taking longer than usual")).toBeDefined();
      retry.click();
      expect(retried).toBe(1);
    },
    25_000
  );
});
