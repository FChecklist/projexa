/// <reference types="bun-types" />
// R67 lane D22 (item D-76, rec R-288). Two rules the BOQ list must not break:
// the newest BOQ is the first row, and rose is reserved for rejected/late.
import { describe, expect, test } from "bun:test";
import { DEFAULT_BOQ_SORT, boqStatusPill, boqVariation, nextBoqSort, sortBoqs } from "./boq-list";

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

describe("boqStatusPill", () => {
  test("a superseded pill carries NO rose colour class", () => {
    const pill = boqStatusPill("superseded");
    expect(pill.className).not.toContain("error");
    expect(pill.className).not.toContain("destructive");
    expect(pill.className).toContain("bg-px-cloud");
    expect(pill.glyph).toBe("archive");
    expect(pill.label).toBe("superseded");
  });

  test("draft is a grey outline with the word and no glyph", () => {
    const pill = boqStatusPill("draft");
    expect(pill.className).toContain("bg-transparent");
    expect(pill.className).not.toContain("error");
    expect(pill.glyph).toBe("none");
  });

  test("approved is sage with a tick and the word", () => {
    const pill = boqStatusPill("approved");
    expect(pill.className).toContain("success");
    expect(pill.glyph).toBe("tick");
    expect(pill.label).toBe("approved");
  });

  test("rose is used for rejected and late, and for nothing else", () => {
    for (const status of ["rejected", "late"]) {
      expect(boqStatusPill(status).className).toContain("error");
    }
    for (const status of ["draft", "submitted", "approved", "superseded"]) {
      expect(boqStatusPill(status).className).not.toContain("error");
    }
  });

  test("an unrecognised status is neutral and still shows its own word", () => {
    const pill = boqStatusPill("archived_2027");
    expect(pill.label).toBe("archived_2027");
    expect(pill.className).not.toContain("error");
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
