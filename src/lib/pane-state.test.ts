/// <reference types="bun-types" />
// R67 D-65 / D-59 / D-55. The rules a data pane obeys, tested where they
// live rather than through a screenshot.
import { describe, expect, test } from "bun:test";
import {
  PANE_ELAPSED_WAIT_MS,
  PANE_NAMED_WAIT_MS,
  PANE_SLOW_WAIT_MS,
  asOfLabel,
  loadingCaption,
  mayShowEmptyState,
  paneError,
  recordCountLabel,
} from "./pane-state";
import { READ_ERROR_CODES, classifyReadError, describeReadError } from "./task-errors";

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
