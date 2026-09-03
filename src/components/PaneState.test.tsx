/// <reference types="bun-types" />
// R67 D-65 -- PaneState's RENDERING, as opposed to its rules.
//
// src/lib/pane-state.test.ts already asserts the rules as pure functions:
// mayShowEmptyState() takes an outcome, recordCountLabel() returns an en-dash
// over a failed read, loadingCaption() stays silent under two seconds. What it
// cannot assert is that the component actually OBEYS them -- and the whole
// point of extracting the rules was that the wrapper is the one place every
// adopting screen inherits them from. A PaneState that computed
// mayShowEmptyState() and then rendered the empty sentence anyway would pass
// every existing test in this repo.
//
// So these are the four branches as a real render, plus the two invariants
// that make the component safe to adopt:
//
//   * the empty sentence is unreachable from anything but a 200, and
//   * rows already on screen are never blanked by a failed refresh.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { PaneState, PaneErrorCard, PaneWaitingCaption } from "./PaneState";

afterEach(cleanup);

const COLUMNS = ["Permit", "Number", "Authority", "Expires"];

function renderPane(overrides: Partial<React.ComponentProps<typeof PaneState>> = {}) {
  return render(
    <PaneState
      status="ready"
      entity="permits"
      rowCount={0}
      skeletonColumns={COLUMNS}
      emptyMessage="No permits yet for this project."
      {...overrides}
    >
      <table>
        <tbody>
          <tr>
            <td>BP-2026-0142</td>
          </tr>
        </tbody>
      </table>
    </PaneState>
  );
}

describe("PaneState", () => {
  test("loading renders a skeleton in the REAL column shape, never a bare spinner", () => {
    const { container } = renderPane({ status: "loading", rowCount: 0 });

    // The skeleton's job is to say "a table with these columns is coming".
    for (const label of COLUMNS) {
      expect(container.textContent).toContain(label);
    }
    expect(container.querySelectorAll("thead th")).toHaveLength(COLUMNS.length);
    // And it must not assert anything about the data it does not have yet.
    expect(container.textContent).not.toContain("No permits yet for this project.");
  });

  test("a fast read is SILENT -- no caption flashes before two seconds", () => {
    const { container } = renderPane({ status: "loading", rowCount: 0, startedAt: Date.now() });
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  test("a long wait admits it is slow and offers a way out", () => {
    // startedAt in the past is how the elapsed timeline is exercised without
    // making the test itself wait eight seconds.
    const { container } = renderPane({
      status: "loading",
      rowCount: 0,
      startedAt: Date.now() - 8_500,
      onRetry: () => {},
    });

    expect(container.textContent).toContain("Still working — the construction data service is slow right now");
    expect(container.textContent).toContain("8s");
    expect(container.textContent).toContain("Retry");
  });

  test("an error shows the dictionary's sentence and NEVER the empty sentence", () => {
    const { container } = renderPane({
      status: "error",
      rowCount: 0,
      error: { status: 500, message: "Something went wrong upstream." },
      onRetry: () => {},
    });

    expect(container.textContent).toContain(
      "Couldn't load permits — the construction data service returned an error (UPSTREAM_ERROR)."
    );
    // The backend's own words survive underneath the closed-vocabulary sentence.
    expect(container.textContent).toContain("Something went wrong upstream.");
    expect(container.textContent).toContain("1 error on this screen");
    expect(container.textContent).not.toContain("No permits yet for this project.");
  });

  test("a 401 offers no Retry, because retrying will not fix a permission", () => {
    const { container } = renderPane({
      status: "error",
      rowCount: 0,
      error: { status: 401, message: "Unauthorized" },
      onRetry: () => {},
    });

    expect(container.textContent).toContain("NOT_AUTHORISED");
    const retry = Array.from(container.querySelectorAll("button")).filter((b) =>
      (b.textContent ?? "").includes("Retry")
    );
    expect(retry).toHaveLength(0);
  });

  test("rows already on screen SURVIVE a failed refresh, labelled with when they were true", () => {
    const { container } = renderPane({
      status: "error",
      rowCount: 1,
      error: { status: 500, message: "Something went wrong upstream." },
      lastLoadedAt: new Date("2026-09-02T10:32:00.000Z"), // 14:32 in Asia/Dubai
    });

    // Blanking the pane would lose information the user already had.
    expect(container.textContent).toContain("BP-2026-0142");
    expect(container.textContent).toContain("Showing what loaded as of 14:32.");
    expect(container.textContent).toContain("Couldn't load permits");
    expect(container.textContent).not.toContain("No permits yet for this project.");
  });

  test("only a successful, genuinely empty read reaches the empty sentence", () => {
    const { container } = renderPane({ status: "ready", rowCount: 0 });
    expect(container.textContent).toContain("No permits yet for this project.");
    expect(container.textContent).not.toContain("Couldn't load permits");
  });

  test("the empty state carries its primary action, so the answer is on the screen", () => {
    const { container } = renderPane({
      status: "ready",
      rowCount: 0,
      emptyAction: <button type="button">+ New permit</button>,
    });
    expect(container.textContent).toContain("+ New permit");
  });

  test("an idle pane -- asked for nothing yet -- asserts nothing at all", () => {
    // The status that exists precisely so a screen gated on a project can wait
    // without claiming the list is empty.
    const { container } = renderPane({ status: "idle", rowCount: 0 });
    expect(container.textContent).not.toContain("No permits yet for this project.");
    expect(container.textContent).not.toContain("Couldn't load permits");
  });

  test("ready with rows shows the real table and no stale label", () => {
    const { container } = renderPane({
      status: "ready",
      rowCount: 1,
      lastLoadedAt: new Date("2026-09-02T10:32:00.000Z"),
    });
    expect(container.textContent).toContain("BP-2026-0142");
    // "as of" is for rows that are no longer known to be current.
    expect(container.textContent).not.toContain("Showing what loaded");
  });
});

describe("PaneErrorCard / PaneWaitingCaption", () => {
  // The two pieces exist so a pane whose shape is NOT a table -- a board, a
  // Gantt, a card list -- gets the same words without the table skeleton.
  test("the error card carries the same sentence as the full pane", () => {
    const { container } = render(
      <PaneErrorCard entity="the schedule" error={{ status: 504, message: "timed out" }} onRetry={() => {}} />
    );
    expect(container.textContent).toContain(
      "Couldn't load the schedule — the construction data service didn't answer (UPSTREAM_TIMEOUT)."
    );
    expect(container.textContent).toContain("Retry");
  });

  test("the standalone caption follows the same timeline", () => {
    const { container } = render(
      <PaneWaitingCaption startedAt={Date.now() - 2_500} entity="the board" projectName="Cedar Heights Villa" />
    );
    expect(container.textContent).toContain("Loading the board for Cedar Heights Villa…");
  });

  test("the standalone caption is silent on a fast read too", () => {
    const { container } = render(<PaneWaitingCaption startedAt={Date.now()} entity="the board" />);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
