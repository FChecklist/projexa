/// <reference types="bun-types" />
// R67 D-10. The filter half of "Back restores the list's filters and scroll".
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { beforeEach, describe, expect, test } from "bun:test";
import { parseListFilters, readListFilters, writeListFilters } from "./list-view-state";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("writeListFilters / readListFilters", () => {
  test("a filter set survives the round trip, which is the whole point of Back", () => {
    writeListFilters("drawings.list", { kind: "dwg", discipline: "MEP" });
    expect(readListFilters("drawings.list")).toEqual({ kind: "dwg", discipline: "MEP" });
  });

  test("reading does NOT clear -- unlike a receipt, a filter set is read on every mount", () => {
    writeListFilters("drawings.list", { kind: "dwg" });
    expect(readListFilters("drawings.list")).toEqual({ kind: "dwg" });
    expect(readListFilters("drawings.list")).toEqual({ kind: "dwg" });
  });

  test("clearing the filter forgets it rather than storing an empty object", () => {
    writeListFilters("drawings.list", { kind: "dwg" });
    writeListFilters("drawings.list", {});
    expect(window.sessionStorage.getItem("veri.list.filters:drawings.list")).toBeNull();
    expect(readListFilters("drawings.list")).toEqual({});
  });

  test("an empty value is not a filter", () => {
    writeListFilters("drawings.list", { kind: "", discipline: "MEP" });
    expect(readListFilters("drawings.list")).toEqual({ discipline: "MEP" });
  });

  test("each screen's filters are its own", () => {
    writeListFilters("drawings.list", { kind: "dwg" });
    expect(readListFilters("documents.list")).toEqual({});
  });

  test("a screen that has never been filtered reads as no filters, not as null", () => {
    expect(readListFilters("never.used")).toEqual({});
  });
});

describe("parseListFilters", () => {
  test("a corrupted or hand-edited entry comes back as no filters", () => {
    expect(parseListFilters("not json")).toEqual({});
    expect(parseListFilters("[1,2,3]")).toEqual({});
    expect(parseListFilters("null")).toEqual({});
  });

  test("a non-string value is dropped rather than rendered into a chip", () => {
    expect(parseListFilters('{"kind":{"a":1},"discipline":"MEP"}')).toEqual({ discipline: "MEP" });
    expect(parseListFilters('{"kind":7}')).toEqual({});
  });
});
