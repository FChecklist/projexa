/// <reference types="bun-types" />
// R67 D-12. One vocabulary for a drawing's status, and the one rule that
// matters most about it: a row that predates the register is never 'current'
// by accident.
import { describe, expect, test } from "bun:test";
import {
  CREATE_STATUS_OPTIONS,
  DEFAULT_DRAWING_STATUS,
  normaliseDrawingStatus,
  statusPresentation,
  statusText,
} from "./drawing-status";

describe("normaliseDrawingStatus", () => {
  test("keeps the three real states", () => {
    expect(normaliseDrawingStatus("current")).toBe("current");
    expect(normaliseDrawingStatus("superseded")).toBe("superseded");
    expect(normaliseDrawingStatus("for_approval")).toBe("for_approval");
  });

  test("a pre-D-12 row, or anything unrecognised, is 'For approval' -- never 'Current' by accident", () => {
    expect(normaliseDrawingStatus(undefined)).toBe(DEFAULT_DRAWING_STATUS);
    expect(normaliseDrawingStatus(null)).toBe("for_approval");
    expect(normaliseDrawingStatus("CURRENT")).toBe("for_approval");
    expect(normaliseDrawingStatus(7)).toBe("for_approval");
  });
});

describe("statusPresentation / statusText", () => {
  test("every state carries a glyph AND a word, never a colour alone", () => {
    expect(statusText("current")).toBe("✓ Current");
    expect(statusText("superseded")).toBe("○ Superseded");
    expect(statusText("for_approval")).toBe("● For approval");
  });

  test("the build set is the only one in the done tone", () => {
    expect(statusPresentation("current").className).toContain("veri-status-done");
    expect(statusPresentation("superseded").className).toBe("text-ct-muted");
    expect(statusPresentation("for_approval").className).toContain("veri-status-needs-you");
  });
});

describe("CREATE_STATUS_OPTIONS", () => {
  test("offers what a person can actually upload something as, defaulting first", () => {
    expect(CREATE_STATUS_OPTIONS.map((o) => o.value)).toEqual(["for_approval", "current"]);
    expect(CREATE_STATUS_OPTIONS[0].value).toBe(DEFAULT_DRAWING_STATUS);
    // "Superseded" is a state a drawing is PUT INTO by a later revision, never
    // one you choose at upload time.
    expect(CREATE_STATUS_OPTIONS.some((o) => o.value === "superseded")).toBe(false);
  });
});
