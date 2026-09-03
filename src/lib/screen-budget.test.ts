/// <reference types="bun-types" />
// R67 D-04 -- the read budget and the "Still loading…" threshold.
import { describe, expect, test } from "bun:test";
import {
  SLOW_READ_NOTICE_MS,
  VERIDIAN_SCREEN_BUDGET_MS,
  budgetSignal,
  stillLoadingCaption,
} from "./screen-budget";

describe("the budget itself", () => {
  test("a screen read is bounded at 8 s, the number decision D-04 names", () => {
    expect(VERIDIAN_SCREEN_BUDGET_MS).toBe(8_000);
  });

  test("the user is told at 3 s, well inside that budget", () => {
    expect(SLOW_READ_NOTICE_MS).toBe(3_000);
    expect(SLOW_READ_NOTICE_MS).toBeLessThan(VERIDIAN_SCREEN_BUDGET_MS);
  });
});

describe("stillLoadingCaption", () => {
  test("says nothing for the first three seconds -- the skeleton is the answer", () => {
    expect(stillLoadingCaption(0, "permits")).toBeNull();
    expect(stillLoadingCaption(2_999, "permits")).toBeNull();
  });

  test("names the module's own noun and the elapsed seconds once it is slow", () => {
    expect(stillLoadingCaption(3_000, "permits")).toBe("Still loading permits — 3 s");
    expect(stillLoadingCaption(7_400, "the schedule")).toBe("Still loading the schedule — 7 s");
  });
});

describe("budgetSignal", () => {
  test("with no caller signal it is just the timeout, and starts un-aborted", () => {
    const signal = budgetSignal(50);
    expect(signal.aborted).toBe(false);
  });

  test("an already-aborted caller signal aborts the combined signal immediately", () => {
    const controller = new AbortController();
    controller.abort();
    expect(budgetSignal(50_000, controller.signal).aborted).toBe(true);
  });

  test("a later caller abort still reaches the combined signal", async () => {
    const controller = new AbortController();
    const signal = budgetSignal(50_000, controller.signal);
    expect(signal.aborted).toBe(false);
    controller.abort();
    await Promise.resolve();
    expect(signal.aborted).toBe(true);
  });

  test("the timeout still fires when the caller never aborts", async () => {
    const controller = new AbortController();
    const signal = budgetSignal(5, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(signal.aborted).toBe(true);
  });
});
