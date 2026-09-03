/// <reference types="bun-types" />
// R67 lane D22 (item D-76, rec R-288). Two rules the BOQ list must not break:
// the newest BOQ is the first row, and rose is reserved for rejected/late.
import { describe, expect, test } from "bun:test";
import { BOQ_SEMANTIC_STATUS, DEFAULT_BOQ_SORT, boqVariation, nextBoqSort, sortBoqs } from "./boq-list";
import { STATUS_MAP, TONE_STYLE, toSemanticStatus } from "@/components/ui/status-pill";

const rev0 = { id: "b0", version: 1, createdAt: "2026-08-01T09:00:00.000Z", parentBoqId: null };
const rev1 = { id: "b1", version: 2, createdAt: "2026-08-20T09:00:00.000Z", parentBoqId: "b0" };
const rev2 = { id: "b2", version: 3, createdAt: "2026-09-01T09:00:00.000Z", parentBoqId: "b1" };

describe("sortBoqs", () => {
  test("defaults to newest first -- the BOQ just created is the first row", () => {
    expect(DEFAULT_BOQ_SORT).toEqual({ field: "createdAt", dir: "desc" });
    expect(sortBoqs([rev0, rev2, rev1]).map((b) => b.id)).toEqual(["b2", "b1", "b0"]);
  });

  test("the Version toggle orders by revision, highest first", () => {
    expect(sortBoqs([rev1, rev0, rev2], { field: "version", dir: "desc" }).map((b) => b.id)).toEqual(["b2", "b1", "b0"]);
    expect(sortBoqs([rev1, rev0, rev2], { field: "version", dir: "asc" }).map((b) => b.id)).toEqual(["b0", "b1", "b2"]);
  });

  test("BOQs created in the same second still read in revision order, never at random", () => {
    const a = { id: "a", version: 1, createdAt: "2026-09-01T09:00:00.000Z", parentBoqId: null };
    const b = { id: "b", version: 2, createdAt: "2026-09-01T09:00:00.000Z", parentBoqId: "a" };
    expect(sortBoqs([a, b]).map((x) => x.id)).toEqual(["b", "a"]);
    expect(sortBoqs([b, a]).map((x) => x.id)).toEqual(["b", "a"]);
  });

  test("does not mutate the array it was given", () => {
    const input = [rev0, rev2, rev1];
    sortBoqs(input);
    expect(input.map((b) => b.id)).toEqual(["b0", "b2", "b1"]);
  });
});

describe("nextBoqSort", () => {
  test("pressing the sorted column flips its direction", () => {
    expect(nextBoqSort({ field: "createdAt", dir: "desc" }, "createdAt")).toEqual({ field: "createdAt", dir: "asc" });
    expect(nextBoqSort({ field: "createdAt", dir: "asc" }, "createdAt")).toEqual({ field: "createdAt", dir: "desc" });
  });

  test("pressing a different column starts it descending -- nobody wants Rev0 at the top", () => {
    expect(nextBoqSort({ field: "createdAt", dir: "asc" }, "version")).toEqual({ field: "version", dir: "desc" });
  });
});

// R67 lane D22 (review finding): this block used to test a pill function that
// lived in boq-list.ts -- a second status->tone->word mapping beside the one
// origin/main already ships in src/components/ui/status-pill.tsx. The guarantee
// it protected is worth keeping and is kept, but it is now asserted against the
// map that OWNS the vocabulary, so it cannot pass here while the screen renders
// something else.
describe("BOQ statuses on the app-wide status map", () => {
  test("a superseded pill carries NO rose colour class", () => {
    // WS-G's rule, at its source: superseded resolves to the neutral tone, and
    // the neutral tone is not the late (rose) one.
    const tone = STATUS_MAP[BOQ_SEMANTIC_STATUS.superseded!].tone;
    expect(tone).toBe("neutral");
    expect(TONE_STYLE[tone].colorVar).not.toContain("late");
    expect(TONE_STYLE[tone].colorVar).toBe("var(--status-neutral-text)");
    expect(STATUS_MAP[BOQ_SEMANTIC_STATUS.superseded!].word).toBe("superseded");
  });

  test("draft is neutral too -- not started is not a fault", () => {
    expect(STATUS_MAP[BOQ_SEMANTIC_STATUS.draft!].tone).toBe("neutral");
  });

  test("approved is the done tone, with a word", () => {
    const entry = STATUS_MAP[BOQ_SEMANTIC_STATUS.approved!];
    expect(entry.tone).toBe("done");
    expect(entry.word.length).toBeGreaterThan(0);
  });

  test("submitted is distinguishable from draft -- awaiting approval is not untouched", () => {
    expect(BOQ_SEMANTIC_STATUS.submitted).not.toBe(BOQ_SEMANTIC_STATUS.draft);
    expect(STATUS_MAP[BOQ_SEMANTIC_STATUS.submitted!].tone).toBe("running");
  });

  test("NO BOQ status reaches the rose tone -- rose is reserved for late and error", () => {
    for (const semantic of Object.values(BOQ_SEMANTIC_STATUS)) {
      expect(STATUS_MAP[semantic].tone).not.toBe("late");
    }
  });

  test("every word this backend emits is in the map, so none falls through to a bare status", () => {
    for (const status of ["draft", "submitted", "approved", "superseded"]) {
      expect(BOQ_SEMANTIC_STATUS[status]).toBeDefined();
    }
  });

  test("an unrecognised status is not in the map, and the screen falls back to neutral with its own word", () => {
    expect(BOQ_SEMANTIC_STATUS["archived_2027"]).toBeUndefined();
    expect(toSemanticStatus("archived_2027")).toBeNull();
  });
});

describe("boqVariation", () => {
  test("a baseline has no variation at all", () => {
    expect(boqVariation(rev0, { b0: 42 })).toBeUndefined();
  });

  test("prefers the list payload's own figure (DE-15) over a per-row compare call", () => {
    expect(boqVariation({ ...rev1, totalVariation: 1200 }, { b1: 99 })).toBe(1200);
    expect(boqVariation({ ...rev1, variation: -300 }, { b1: 99 })).toBe(-300);
  });

  test("falls back to the fetched compare result while that payload is not there yet", () => {
    expect(boqVariation(rev1, { b1: 99 })).toBe(99);
    expect(boqVariation(rev1, {})).toBeUndefined();
  });

  test("a real zero from the payload is kept, not treated as missing", () => {
    expect(boqVariation({ ...rev1, totalVariation: 0 }, { b1: 99 })).toBe(0);
  });
});
