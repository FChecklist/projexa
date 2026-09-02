/// <reference types="bun-types" />
// R67 F-25 -- the per-tab pane state machine, tested without React.
//
// The rules that matter here are the ones a shared `loading` flag got wrong:
// an unopened tab is not an empty result, a refresh must not blank rows that
// are already correct, and an error must never be indistinguishable from
// "there are none".
import { describe, expect, test } from "bun:test";
import {
  errorPane,
  idlePane,
  loadingPane,
  needsLoad,
  paneAsOf,
  paneIsBusy,
  readyPane,
  seededPane,
} from "./pane-state";

const T0 = 1_756_800_000_000; // fixed epoch ms, so nothing here depends on the clock

describe("idlePane", () => {
  test("a tab nobody opened is idle -- not empty, not an error", () => {
    const pane = idlePane<string>();
    expect(pane.status).toBe("idle");
    expect(pane.rows).toEqual([]);
    expect(pane.error).toBeNull();
    expect(needsLoad(pane)).toBe(true);
  });

  test("only an idle pane needs loading -- a pane that already answered is never re-fetched by a tab click", () => {
    expect(needsLoad(readyPane([1], T0))).toBe(false);
    expect(needsLoad(loadingPane(idlePane<number>()))).toBe(false);
    expect(needsLoad(errorPane(idlePane<number>(), "boom"))).toBe(false);
  });
});

describe("seededPane -- what the server component already fetched", () => {
  test("rows from the server are ready immediately, with the time they arrived", () => {
    const pane = seededPane(["a", "b"], null, T0);
    expect(pane.status).toBe("ready");
    expect(pane.rows).toEqual(["a", "b"]);
    expect(pane.asOf).toBe(T0);
    expect(paneIsBusy(pane)).toBe(false);
  });

  test("a server-side FAILURE is answered, not loading -- the screen says why instead of spinning forever", () => {
    const pane = seededPane<string>([], "Permits service didn't answer", T0);
    expect(pane.status).toBe("error");
    expect(pane.error).toBe("Permits service didn't answer");
    expect(paneIsBusy(pane)).toBe(false);
  });
});

describe("loadingPane", () => {
  test("a refresh KEEPS the rows already on screen -- no blank table mid-revalidation", () => {
    const pane = loadingPane(readyPane(["a"], T0));
    expect(pane.rows).toEqual(["a"]);
    expect(pane.status).toBe("loading");
    // ...and no spinner, because there is something to look at.
    expect(paneIsBusy(pane)).toBe(false);
  });

  test("a first load with nothing to show is the one case that earns a spinner", () => {
    expect(paneIsBusy(loadingPane(idlePane<string>()))).toBe(true);
  });

  test("starting a load clears the previous error -- a stale reason must not sit over a request in flight", () => {
    const pane = loadingPane(errorPane(readyPane(["a"], T0), "boom"));
    expect(pane.error).toBeNull();
  });
});

describe("errorPane", () => {
  test("keeps the last known-good rows and states the backend's own reason", () => {
    const pane = errorPane(readyPane(["a", "b"], T0), "Attendance service didn't answer");
    expect(pane.rows).toEqual(["a", "b"]);
    expect(pane.error).toBe("Attendance service didn't answer");
    expect(pane.status).toBe("error");
  });

  test("an error with no rows is distinguishable from a successful empty read", () => {
    const failed = errorPane(idlePane<string>(), "500");
    const empty = readyPane<string>([], T0);
    expect(failed.rows).toEqual(empty.rows);
    expect(failed.error).not.toBeNull();
    expect(empty.error).toBeNull();
  });
});

describe("paneAsOf -- only an aged prefetch admits its age", () => {
  test("rows read a moment ago carry no stamp", () => {
    expect(paneAsOf(readyPane(["a"], T0), T0 + 5_000)).toBeNull();
  });

  test("rows older than the freshness window carry the time they were read", () => {
    expect(paneAsOf(readyPane(["a"], T0), T0 + 60_000)).toBe(T0);
  });

  test("a pane that is loading or failed never claims an as-of time", () => {
    expect(paneAsOf(loadingPane(idlePane<string>()), T0 + 120_000)).toBeNull();
    expect(paneAsOf(errorPane(idlePane<string>(), "boom"), T0 + 120_000)).toBeNull();
    expect(paneAsOf(idlePane<string>(), T0 + 120_000)).toBeNull();
  });
});
