/// <reference types="bun-types" />
// R67 lane D22 (items D-58/D-64). Covers SearchSelect's one pure decision --
// which options a typed query leaves visible when the filtering is local.
// The server-filtered path deliberately has no local filter at all (the
// component passes `options` straight through), which is why this is the only
// filtering behaviour there is to test.
import { describe, expect, test } from "bun:test";
import { filterLocally, type SearchSelectOption } from "./SearchSelect";

const options: SearchSelectOption[] = [
  { value: "1", label: "R60SK-A — R60 skiphop sub", sublabel: "m3 · 40 of 120 remaining" },
  { value: "2", label: "R60SK-B — Blockwork", sublabel: "m2 · 0 of 80 remaining" },
  { value: "3", label: "Arjun Mehta", sublabel: "arjun.mehta@skylinebuilders-demo.veridianai.dev" },
];

describe("filterLocally", () => {
  test("an empty query keeps every option", () => {
    expect(filterLocally(options, "")).toHaveLength(3);
    expect(filterLocally(options, "   ")).toHaveLength(3);
  });

  test("matches the label case-insensitively, on a code or on words inside it", () => {
    expect(filterLocally(options, "r60sk-a").map((o) => o.value)).toEqual(["1"]);
    expect(filterLocally(options, "skiphop").map((o) => o.value)).toEqual(["1"]);
    expect(filterLocally(options, "R60SK").map((o) => o.value)).toEqual(["1", "2"]);
  });

  test("matches the sublabel too, so a unit or an email finds the row", () => {
    expect(filterLocally(options, "skylinebuilders").map((o) => o.value)).toEqual(["3"]);
    expect(filterLocally(options, "m2").map((o) => o.value)).toEqual(["2"]);
  });

  test("no match is an empty list, never the whole list", () => {
    expect(filterLocally(options, "nothing like this")).toEqual([]);
  });
});
