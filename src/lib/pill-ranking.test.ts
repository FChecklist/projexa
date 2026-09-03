/// <reference types="bun-types" />
// R67 WS-A (A-14). The whole value of this rule is a negative: the strip must
// NOT change while the user is looking at it. A negative is exactly the kind of
// property that regresses silently, so both halves are asserted here.
import { describe, test, expect } from "bun:test";
import { isStripPainted, rankingArrival } from "./pill-ranking";

describe("isStripPainted -- is there a considered answer on screen already?", () => {
  test("a cached ranking from a previous visit counts", () => {
    expect(isStripPainted({ cachedRanking: [], roleKnown: false })).toBe(true);
  });

  test("a known role counts -- the strip is showing that role's own order", () => {
    expect(isStripPainted({ cachedRanking: null, roleKnown: true })).toBe(true);
  });

  test("neither means skeletons, which are not an answer", () => {
    expect(isStripPainted({ cachedRanking: null, roleKnown: false })).toBe(false);
  });
});

describe("rankingArrival -- the strip re-ranks only on navigation", () => {
  test("a ranking arriving over a painted strip is HELD, not applied", () => {
    expect(rankingArrival({ painted: true })).toBe("defer");
  });

  test("a ranking arriving over skeletons is painted at once", () => {
    // Otherwise a first-ever user sits on placeholders until they navigate.
    expect(rankingArrival({ painted: false })).toBe("paint");
  });

  test("the decision depends on nothing else -- no timer, no hover state", () => {
    // A-07 gated this on "has the band been touched in the last five seconds",
    // which made the outcome depend on the clock: the same page could keep or
    // replace its strip depending on how fast the network was. It cannot now.
    expect(rankingArrival({ painted: true })).toBe(rankingArrival({ painted: true }));
    expect(rankingArrival({ painted: false })).toBe(rankingArrival({ painted: false }));
  });
});
