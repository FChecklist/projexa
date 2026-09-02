/// <reference types="bun-types" />
// R67 WS-A (A-16). The acceptance is a Playwright run against a dev server this
// lane may not start, so what is asserted here is the half of it that is real
// logic rather than pixels: the strip never changes for a ranking that has not
// changed, a cached ranking belongs to exactly one user, each call is attempted
// twice before any fallback, and the bare em-dash cannot be produced at all.
import { describe, test, expect } from "bun:test";
import {
  EMPTY_RANKED_CACHE,
  organisationLabel,
  parseRankedCache,
  rankingFor,
  readJsonWithRetry,
  rememberRanking,
  sameRanking,
  serialiseRankedCache,
  TASKS_UNAVAILABLE,
} from "./shell-resilience";

const A = { pillKey: "work-progress.entry", label: "Record progress", pinned: false };
const B = { pillKey: "permits.new", label: "Add permit", pinned: false };

describe("sameRanking -- the strip is replaced only when it differs", () => {
  test("the same entries in the same order are the same ranking", () => {
    expect(sameRanking([A, B], [{ ...A }, { ...B }])).toBe(true);
  });

  test("order IS the ranking, so a swap is a different ranking", () => {
    expect(sameRanking([A, B], [B, A])).toBe(false);
  });

  test("a changed label is a different ranking -- it is what the user reads", () => {
    expect(sameRanking([A], [{ ...A, label: "Record daily progress" }])).toBe(false);
  });

  test("a changed pin is a different ranking", () => {
    expect(sameRanking([A], [{ ...A, pinned: true }])).toBe(false);
  });

  test("a missing pinned flag and an explicit false are the same fact", () => {
    expect(sameRanking([{ pillKey: "x" }], [{ pillKey: "x", pinned: false }])).toBe(true);
  });

  test("nothing cached is never the same as an answered empty ranking", () => {
    expect(sameRanking(null, [])).toBe(false);
    expect(sameRanking([], [])).toBe(true);
  });
});

describe("the ranked cache is keyed by user id", () => {
  test("a user reads back their own ranking", () => {
    const cache = rememberRanking(EMPTY_RANKED_CACHE, "user-1", [A, B]);
    expect(rankingFor(cache, "user-1")).toEqual([A, B]);
  });

  test("a DIFFERENT user on the same browser gets nothing, never someone else's strip", () => {
    const cache = rememberRanking(EMPTY_RANKED_CACHE, "user-1", [A, B]);
    expect(rankingFor(cache, "user-2")).toBeNull();
  });

  test("before the identity is known, the browser's last user is painted", () => {
    const cache = rememberRanking(rememberRanking(EMPTY_RANKED_CACHE, "user-1", [A]), "user-2", [B]);
    expect(rankingFor(cache, null)).toEqual([B]);
  });

  test("a round trip through storage keeps both users and the pointer", () => {
    const cache = rememberRanking(rememberRanking(EMPTY_RANKED_CACHE, "user-1", [A]), "user-2", [B]);
    const back = parseRankedCache(serialiseRankedCache(cache));
    expect(rankingFor(back, "user-1")).toEqual([A]);
    expect(rankingFor(back, "user-2")).toEqual([B]);
    expect(rankingFor(back, null)).toEqual([B]);
  });

  test("the shape this key used to hold is still painted, but attributed to nobody", () => {
    const legacy = parseRankedCache(JSON.stringify([A, B]));
    expect(rankingFor(legacy, null)).toEqual([A, B]);
    expect(rankingFor(legacy, "user-1")).toBeNull();
  });

  test("unreadable storage is an empty cache, never a thrown shell", () => {
    expect(parseRankedCache("{not json")).toEqual(EMPTY_RANKED_CACHE);
    expect(parseRankedCache(null)).toEqual(EMPTY_RANKED_CACHE);
    expect(rankingFor(parseRankedCache('{"last":"gone","byUser":{}}'), null)).toBeNull();
  });
});

describe("organisationLabel -- the bare em-dash is unreachable", () => {
  test("a name is the name", () => {
    expect(organisationLabel({ name: "Demo Organization", failed: false })).toEqual({
      text: "Demo Organization",
      retry: false,
    });
  });

  test("not answered yet says so", () => {
    expect(organisationLabel({ name: null, failed: false }).text).toBe("Loading…");
  });

  test("a failed read says what failed and offers the one control that helps", () => {
    expect(organisationLabel({ name: null, failed: true })).toEqual({
      text: "Organisation unavailable",
      retry: true,
    });
  });

  test("no combination of inputs produces a lone punctuation mark", () => {
    for (const name of [null, undefined, "", "   ", "Demo Organization"]) {
      for (const failed of [true, false]) {
        expect(organisationLabel({ name, failed }).text).not.toBe("—");
        expect(organisationLabel({ name, failed }).text.trim().length).toBeGreaterThan(1);
      }
    }
  });

  test("the task pane's notice is the sentence the acceptance looks for", () => {
    expect(TASKS_UNAVAILABLE).toBe("Could not load your tasks");
  });
});

describe("readJsonWithRetry -- every call is attempted twice before any fallback", () => {
  const noSleep = async () => {};

  test("a first success is not retried", async () => {
    let calls = 0;
    const read = await readJsonWithRetry<{ ok: boolean }>("/api/organization", {
      sleep: noSleep,
      fetcher: async () => {
        calls += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    expect(calls).toBe(1);
    expect(read).toEqual({ ok: true, data: { ok: true }, attempts: 1 });
  });

  test("a failure is retried once and the second answer is used", async () => {
    let calls = 0;
    const read = await readJsonWithRetry<{ name: string }>("/api/organization", {
      sleep: noSleep,
      fetcher: async () => {
        calls += 1;
        if (calls === 1) return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
        return new Response(JSON.stringify({ name: "Demo Organization" }), { status: 200 });
      },
    });
    expect(calls).toBe(2);
    expect(read.ok).toBe(true);
    expect(read.attempts).toBe(2);
  });

  test("two failures keep the backend's OWN words and report both attempts", async () => {
    let calls = 0;
    const read = await readJsonWithRetry("/api/pill-usage", {
      sleep: noSleep,
      fetcher: async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: "pill usage is down" }), { status: 503 });
      },
    });
    expect(calls).toBe(2);
    expect(read).toEqual({ ok: false, error: "pill usage is down", attempts: 2 });
  });

  test("a thrown request is a failure like any other, and is retried too", async () => {
    let calls = 0;
    const read = await readJsonWithRetry("/api/tasks", {
      sleep: noSleep,
      fetcher: async () => {
        calls += 1;
        throw new Error("Failed to fetch");
      },
    });
    expect(calls).toBe(2);
    expect(read).toEqual({ ok: false, error: "Failed to fetch", attempts: 2 });
  });

  test("a status with no message still names the status rather than nothing", async () => {
    const read = await readJsonWithRetry("/api/tasks", {
      sleep: noSleep,
      attempts: 1,
      fetcher: async () => new Response("<html>gateway</html>", { status: 502 }),
    });
    expect(read).toEqual({ ok: false, error: "HTTP 502", attempts: 1 });
  });

  test("the wait between the two attempts is the one second the item names", async () => {
    const waited: number[] = [];
    await readJsonWithRetry("/api/organization", {
      sleep: async (ms) => {
        waited.push(ms);
      },
      fetcher: async () => new Response("{}", { status: 500 }),
    });
    expect(waited).toEqual([1000]);
  });
});
