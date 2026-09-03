/// <reference types="bun-types" />
// R67 D-67 -- the autosave rules, asserted without a DOM, a timer or a
// network.

import { describe, expect, test } from "bun:test";
import { AUTOSAVE_IDLE_MS, autosaveIsSendable, autosaveLabel } from "./autosave";

// 2026-08-28T08:04:00Z is 12:04 in Asia/Dubai (+04) -- R-257's own example
// time, so the assertion is against the wording the audit actually wrote.
const AT = new Date("2026-08-28T08:04:00.000Z");

describe("autosaveLabel", () => {
  test("says nothing at all before the first change", () => {
    // A screen that has saved nothing has no claim to make.
    expect(autosaveLabel("idle", null)).toBeNull();
  });

  test("'Saving…' while it is in flight", () => {
    expect(autosaveLabel("saving", null)).toBe("Saving…");
    expect(autosaveLabel("saving", AT)).toBe("Saving…");
  });

  test("'Saved 12:04' -- the clock time, not a tick and not a bare 'Saved'", () => {
    // A user who has typed for ten minutes needs to know WHEN, or the word
    // tells them nothing about the last two minutes of work.
    expect(autosaveLabel("saved", AT)).toBe("Saved 12:04");
  });

  test("pending changes are never reported as saved", () => {
    expect(autosaveLabel("pending", null)).toBe("Unsaved changes");
    expect(autosaveLabel("pending", AT)).toBe("Unsaved changes — last saved 12:04");
  });

  test("a failed autosave says so rather than leaving the last success standing", () => {
    expect(autosaveLabel("error", AT)).toBe("Not saved");
  });

  test("the time is the org's zone, so a server and a browser render the same string", () => {
    expect(autosaveLabel("saved", AT, "UTC")).toBe("Saved 08:04");
    expect(autosaveLabel("saved", AT, "Asia/Kolkata")).toBe("Saved 13:34");
  });

  test("an unusable timestamp does not render a broken sentence", () => {
    expect(autosaveLabel("saved", new Date("nonsense"))).toBe("Saved ");
  });
});

describe("autosaveIsSendable", () => {
  test("a complete draft may be sent", () => {
    expect(autosaveIsSendable([])).toBe(true);
  });

  test("a draft missing something required is HELD, not sent", () => {
    // Otherwise deleting a title to retype it would PATCH the meeting into a
    // state the Save button itself refuses to produce.
    expect(autosaveIsSendable(["Title"])).toBe(false);
  });
});

describe("AUTOSAVE_IDLE_MS", () => {
  test("is the ~2 s pause R-257 specified, named once so the timer and the copy agree", () => {
    expect(AUTOSAVE_IDLE_MS).toBe(2000);
  });
});
