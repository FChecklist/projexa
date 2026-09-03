/// <reference types="bun-types" />
// R67 F-31. The two rules a list region obeys, asserted directly rather than
// through a rendered tree: which of the four states it is in, and what it says
// while it waits.

import { describe, expect, test } from "bun:test";
import {
  listDataState,
  loadingWords,
  STILL_LOADING_AFTER_MS,
  TAKING_LONGER_AFTER_MS,
} from "./list-loading";
import { VERIDIAN_FETCH_TIMEOUT_MS } from "./veridian-client";

describe("listDataState", () => {
  test("nothing fetched yet is 'loading', which is the only state that earns a spinner", () => {
    expect(listDataState({ loading: true, error: null, rowCount: 0 })).toBe("loading");
  });

  test("rows on screen are 'ready'", () => {
    expect(listDataState({ loading: false, error: null, rowCount: 3 })).toBe("ready");
  });

  test("a backend answer of 'there are none' is 'empty', NOT 'loading' and NOT 'error'", () => {
    // The distinction read-outcome.ts exists to protect: an unfinished read
    // must never be reported as "no data", and neither must a failed one.
    expect(listDataState({ loading: false, error: null, rowCount: 0 })).toBe("empty");
  });

  test("a failed read is 'error' even when stale rows are still on screen", () => {
    expect(listDataState({ loading: false, error: "Couldn't load minutes", rowCount: 4 })).toBe("error");
  });

  test("an error while a retry is in flight still reports 'error', never 'loading'", () => {
    expect(listDataState({ loading: true, error: "Upstream did not answer", rowCount: 0 })).toBe("error");
  });

  test("a background revalidation under correct rows stays 'ready' -- no spinner over data", () => {
    // F-22 renders a fresh speculative answer immediately and revalidates
    // underneath it. Flipping back to 'loading' there would put a spinner over
    // rows the user is already reading, and would make a latency measurement
    // report the screen as unusable while it plainly is not.
    expect(listDataState({ loading: true, error: null, rowCount: 7 })).toBe("ready");
  });

  test("a missing error field is treated as no error", () => {
    expect(listDataState({ loading: false, rowCount: 0 })).toBe("empty");
  });
});

describe("loadingWords", () => {
  test("says nothing for the first three seconds", () => {
    expect(loadingWords("minutes", 0).text).toBeNull();
    expect(loadingWords("minutes", 2_999).text).toBeNull();
    expect(loadingWords("minutes", 2_999).showRetry).toBe(false);
  });

  test("at 3 s it names what is being loaded, with a live second counter", () => {
    expect(loadingWords("minutes", STILL_LOADING_AFTER_MS).text).toBe("Still loading minutes… 3 s");
    expect(loadingWords("roster", 4_200).text).toBe("Still loading roster… 4 s");
    expect(loadingWords("permits", 7_999).text).toBe("Still loading permits… 7 s");
  });

  test("the counter is whole seconds, floored, and never negative", () => {
    expect(loadingWords("permits", 5_950).seconds).toBe(5);
    expect(loadingWords("permits", -10).seconds).toBe(0);
  });

  test("at 8 s it admits the wait is abnormal and offers a retry", () => {
    const words = loadingWords("minutes", TAKING_LONGER_AFTER_MS);
    expect(words.text).toBe("This is taking longer than usual");
    expect(words.showRetry).toBe(true);
    // The label is deliberately absent from this sentence: by 8 s the user
    // knows what they asked for; what they do not know is that it is broken.
    expect(words.text).not.toContain("minutes");
  });

  test("the 8 s figure IS veridian-client's abort budget -- one number, not two", () => {
    // If these ever diverge, the screen would either say "taking longer than
    // usual" about a request that is still running, or offer Retry after the
    // request had already been abandoned in silence.
    expect(TAKING_LONGER_AFTER_MS).toBe(VERIDIAN_FETCH_TIMEOUT_MS);
  });
});
