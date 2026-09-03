/// <reference types="bun-types" />
// R67 D-13 / D-29. The two sentences a slow read owes the user, held to their
// exact wording and to their budgets. Pure functions, no clock advanced and
// nothing rendered -- the message is a function of elapsed time, so that is what
// is asserted.
import { describe, expect, test } from "bun:test";
import {
  ELAPSED_LOAD_BUDGET_MS,
  SLOW_LOAD_BUDGET_MS,
  elapsedSeconds,
  slowLoadNotice,
} from "./slow-load";

describe("slowLoadNotice", () => {
  test("says nothing while the read is still inside its budget", () => {
    expect(slowLoadNotice("Still loading documents from VERIDIAN…", 0)).toBeNull();
    expect(slowLoadNotice("Still loading documents from VERIDIAN…", 2_999)).toBeNull();
  });

  test("D-13: the documents line appears at 3 s, without an elapsed count", () => {
    expect(slowLoadNotice("Still loading documents from VERIDIAN…", SLOW_LOAD_BUDGET_MS)).toBe(
      "Still loading documents from VERIDIAN…"
    );
    expect(slowLoadNotice("Still loading documents from VERIDIAN…", 12_000)).toBe(
      "Still loading documents from VERIDIAN…"
    );
  });

  test("D-29: the progress line appears at 5 s and carries the elapsed seconds", () => {
    const text = "Still loading progress entries…";
    expect(slowLoadNotice(text, 4_999, { afterMs: ELAPSED_LOAD_BUDGET_MS, withElapsed: true })).toBeNull();
    expect(slowLoadNotice(text, 5_000, { afterMs: ELAPSED_LOAD_BUDGET_MS, withElapsed: true })).toBe(
      "Still loading progress entries… (5 s)"
    );
    expect(slowLoadNotice(text, 12_400, { afterMs: ELAPSED_LOAD_BUDGET_MS, withElapsed: true })).toBe(
      "Still loading progress entries… (12 s)"
    );
  });
});

describe("elapsedSeconds", () => {
  test("floors, so a count never reads 12.4", () => {
    expect(elapsedSeconds(12_400)).toBe(12);
    expect(elapsedSeconds(12_999)).toBe(12);
  });

  test("never goes negative, whatever the clock does", () => {
    expect(elapsedSeconds(-500)).toBe(0);
  });
});
