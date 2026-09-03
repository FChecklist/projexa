/// <reference types="bun-types" />
// R67 -- the one pane module, tested from both halves (decision D-11 addendum).
//
// PART 1 (lane D0, D-65 / D-59 / D-55): the rules a data pane obeys, tested
// where they live rather than through a screenshot.
// PART 2 (lane F2, F-25): the per-tab pane state machine, tested without React.
// The rules that matter there are the ones a shared `loading` flag got wrong:
// an unopened tab is not an empty result, a refresh must not blank rows that
// are already correct, and an error must never be indistinguishable from
// "there are none".
import { describe, expect, test } from "bun:test";
import {
  PANE_ELAPSED_WAIT_MS,
  PANE_NAMED_WAIT_MS,
  PANE_SLOW_WAIT_MS,
  asOfLabel,
  errorPane,
  idlePane,
  loadingCaption,
  loadingPane,
  mayShowEmptyState,
  metricLabel,
  needsLoad,
  paneAsOf,
  paneError,
  paneIsBusy,
  readyPane,
  recordCountLabel,
  seededPane,
} from "./pane-state";
import { READ_ERROR_CODES, classifyReadError, describeReadError, sanitiseBackendMessage } from "./task-errors";

const T0 = 1_756_800_000_000; // fixed epoch ms, so nothing here depends on the clock

describe("loadingCaption -- waiting is narrated, late", () => {
  test("a fast read shows the skeleton and NO text -- a line that appears and vanishes is noise", () => {
    expect(loadingCaption(0, "permits", "Cedar Heights Villa – Phase 1")).toEqual({
      primary: null,
      secondary: null,
      showRetry: false,
    });
    expect(loadingCaption(PANE_NAMED_WAIT_MS - 1, "permits").primary).toBeNull();
  });

  test("at 2 s it names what is loading and which project", () => {
    expect(loadingCaption(PANE_NAMED_WAIT_MS, "permits", "Cedar Heights Villa – Phase 1")).toEqual({
      primary: "Loading permits for Cedar Heights Villa – Phase 1…",
      secondary: null,
      showRetry: false,
    });
  });

  test("with no project in scope the sentence does not invent one", () => {
    expect(loadingCaption(PANE_NAMED_WAIT_MS, "meetings", null).primary).toBe("Loading meetings…");
  });

  test("from 3 s the elapsed seconds arrive on their OWN line, so the line above does not move", () => {
    const caption = loadingCaption(4200, "permits", "Cedar Heights Villa – Phase 1");
    expect(caption.primary).toBe("Loading permits for Cedar Heights Villa – Phase 1…");
    expect(caption.secondary).toBe("Still loading from VERIDIAN… 4s");
    expect(caption.showRetry).toBe(false);
    expect(PANE_ELAPSED_WAIT_MS).toBe(3000);
  });

  test("at 8 s it admits the service is slow, says the screen is not blocking anything, and offers a way out", () => {
    const caption = loadingCaption(PANE_SLOW_WAIT_MS, "permits", "Cedar Heights Villa – Phase 1");
    expect(caption.primary).toBe(
      "Still working — the construction data service is slow right now. You can keep using other screens; this one will fill in."
    );
    expect(caption.secondary).toBe("8s");
    expect(caption.showRetry).toBe(true);
  });

  test("the seconds count up rather than sticking at the threshold", () => {
    expect(loadingCaption(12_400, "permits").secondary).toBe("12s");
  });
});

describe("mayShowEmptyState -- the empty sentence needs a 200", () => {
  test("a successful read with no rows may say so", () => {
    expect(mayShowEmptyState("ready", 0)).toBe(true);
  });

  test("a FAILED read with no rows may not -- this is the whole defect", () => {
    expect(mayShowEmptyState("error", 0)).toBe(false);
  });

  test("neither may a read still in flight, nor one that has not started", () => {
    expect(mayShowEmptyState("loading", 0)).toBe(false);
    expect(mayShowEmptyState("idle", 0)).toBe(false);
  });

  test("a successful read WITH rows is not empty either", () => {
    expect(mayShowEmptyState("ready", 3)).toBe(false);
  });
});

describe("recordCountLabel -- a count we do not have is an en-dash", () => {
  test("a real count reads as a count", () => {
    expect(recordCountLabel("ready", 12)).toBe("12 records");
    expect(recordCountLabel("ready", 1)).toBe("1 record");
    expect(recordCountLabel("ready", 0)).toBe("0 records");
  });

  test("loading and error both render an en-dash, never 0", () => {
    expect(recordCountLabel("loading", 0)).toBe("—");
    expect(recordCountLabel("error", 0)).toBe("—");
    expect(recordCountLabel("error", 12)).toBe("—");
    expect(recordCountLabel("ready", null)).toBe("—");
  });
});

describe("metricLabel -- a KPI tile may not invent a number either", () => {
  test("a real figure reads as a figure, with its unit", () => {
    expect(metricLabel("ready", 12)).toBe("12");
    expect(metricLabel("ready", 0)).toBe("0");
    expect(metricLabel("ready", 64, "%")).toBe("64%");
  });

  test("a failed or in-flight read renders an en-dash, never 0 and never 0%", () => {
    // R-002/R-019: "Total entries 0" and "Avg % Complete 0%" over a 500 were
    // the exact strings the audit found on /work-progress?tab=analytics.
    expect(metricLabel("error", 0)).toBe("—");
    expect(metricLabel("error", 0, "%")).toBe("—");
    expect(metricLabel("loading", 0, "%")).toBe("—");
    expect(metricLabel("idle", 0)).toBe("—");
    // A stale figure held from an earlier success is still not a claim this
    // read may make.
    expect(metricLabel("error", 41, "%")).toBe("—");
  });

  test("a missing or unusable value is an en-dash even on a successful read", () => {
    expect(metricLabel("ready", null)).toBe("—");
    expect(metricLabel("ready", Number.NaN, "%")).toBe("—");
  });
});

describe("asOfLabel -- previous rows say when they were true", () => {
  test("renders a 24-hour time in the org's zone", () => {
    expect(asOfLabel(new Date("2026-08-28T06:32:00.000Z"))).toBe("as of 10:32");
    expect(asOfLabel(new Date("2026-08-28T06:32:00.000Z"), "UTC")).toBe("as of 06:32");
  });

  test("no previous load means no label, not a fabricated time", () => {
    expect(asOfLabel(null)).toBeNull();
    expect(asOfLabel(new Date("nope"))).toBeNull();
  });
});

describe("classifyReadError -- from what the transport actually said", () => {
  test("a 504 or a timeout message is a timeout", () => {
    expect(classifyReadError({ status: 504 })).toBe("UPSTREAM_TIMEOUT");
    expect(classifyReadError({ status: 502, message: "The construction data service did not respond in time." })).toBe(
      "UPSTREAM_TIMEOUT"
    );
  });

  test("'supabaseKey is required' becomes a storage problem, whatever the status", () => {
    expect(classifyReadError({ status: 500, message: "supabaseKey is required." })).toBe("STORAGE_UNAVAILABLE");
  });

  test("401/403 and 404 are their own answers", () => {
    expect(classifyReadError({ status: 401 })).toBe("NOT_AUTHORISED");
    expect(classifyReadError({ status: 403 })).toBe("NOT_AUTHORISED");
    expect(classifyReadError({ status: 404 })).toBe("NOT_FOUND");
  });

  test("anything else is the generic code -- which claims only that the call failed", () => {
    expect(classifyReadError({ status: 500, message: "Boom" })).toBe("UPSTREAM_ERROR");
    expect(classifyReadError({})).toBe("UPSTREAM_ERROR");
  });

  test("every code the classifier can return is in the published set", () => {
    for (const input of [{ status: 504 }, { status: 401 }, { status: 404 }, { status: 500 }, { message: "supabaseKey is required" }]) {
      expect(READ_ERROR_CODES).toContain(classifyReadError(input));
    }
  });
});

describe("describeReadError / paneError -- the sentence a failed pane shows", () => {
  test("the specified wording, naming the noun the user would use and the code", () => {
    const described = paneError("permits", { status: 504, message: "The construction data service did not respond in time." });
    expect(described.sentence).toBe(
      "Couldn't load permits — the construction data service didn't answer (UPSTREAM_TIMEOUT)."
    );
    expect(described.retryable).toBe(true);
    expect(described.footer).toBe("1 error on this screen");
  });

  test("STORAGE_UNAVAILABLE says what is actually wrong, not 'supabaseKey is required'", () => {
    const described = describeReadError("documents", { status: 500, message: "supabaseKey is required." });
    expect(described.sentence).toBe(
      "Couldn't load documents — file storage is not configured for this environment (STORAGE_UNAVAILABLE)."
    );
  });

  test("a 401 offers no Retry -- retrying will not fix a permission", () => {
    expect(describeReadError("permits", { status: 401 }).retryable).toBe(false);
    expect(describeReadError("permits", { status: 404 }).retryable).toBe(false);
  });

  test("the backend's own words are kept alongside the sentence when they are safe", () => {
    const described = describeReadError("permits", { status: 500, message: "The BOQ has no published revision." });
    expect(described.detail).toBe("The BOQ has no published revision.");
  });

  test("...and DROPPED, never half-redacted, when they leak the shape of the system", () => {
    const described = describeReadError("permits", { status: 500, message: "write CONNECT_TIMEOUT 3.109.171.244:6543" });
    expect(described.detail).toBeNull();
    expect(described.sentence).not.toContain("3.109");
  });

  test("no backend message at all leaves the sentence standing alone", () => {
    expect(describeReadError("permits", { status: 500 }).detail).toBeNull();
  });
});

// R67 D-03's leak rule, asserted here because the read half of the dictionary
// is what still uses it: WS-B's own task-errors.test.ts proves the rule for
// the pipeline sentences it composes, and this proves it for the backend prose
// a failed READ passes through. Both halves of one file, both covered.
describe("sanitiseBackendMessage -- the backend's words, only when they are safe", () => {
  const GENERIC = "That didn't run. Nothing was saved.";

  test("real human prose is passed through, because the reason is what a user can act on", () => {
    expect(sanitiseBackendMessage("The construction data service did not respond in time.")).toBe(
      "The construction data service did not respond in time."
    );
  });

  test("an address, a URL or a host:port is replaced WHOLESALE, never half-redacted", () => {
    // The R66 walkthrough's worst case, on a site engineer's screen.
    expect(sanitiseBackendMessage("write CONNECT_TIMEOUT 3.109.171.244:6543")).toBe(GENERIC);
    expect(sanitiseBackendMessage("could not reach https://internal.veridian.local/api")).toBe(GENERIC);
    expect(sanitiseBackendMessage("db-primary:5432 refused the connection")).toBe(GENERIC);
  });

  test("a camelCase parameter name or a function id never reaches a screen", () => {
    expect(sanitiseBackendMessage("itemCode is required")).toBe(GENERIC);
    expect(sanitiseBackendMessage(`no executor is registered for "list_leads" yet`)).toBe(GENERIC);
    expect(sanitiseBackendMessage("function_id not recognised")).toBe(GENERIC);
  });

  test("an empty or absent message is the generic sentence, never a blank", () => {
    expect(sanitiseBackendMessage(null)).toBe(GENERIC);
    expect(sanitiseBackendMessage(undefined)).toBe(GENERIC);
    expect(sanitiseBackendMessage("   ")).toBe(GENERIC);
  });

  test("describeReadError drops a message it replaced, rather than repeating the generic twice", () => {
    const described = describeReadError("permits", { status: 500, message: "itemCode is required" });
    expect(described.detail).toBeNull();
    expect(described.sentence).toContain("Couldn't load permits");
  });
});

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
