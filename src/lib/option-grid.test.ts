import { describe, expect, test } from "bun:test";
import { filterOptions, groupOptions, type GridGroup, type GridOption } from "./option-grid";

const CREW: GridOption[] = [
  { id: "w1", label: "Rakesh", keywords: "Carpenter" },
  { id: "w2", label: "Anil", keywords: "Mason" },
  { id: "w3", label: "Suresh", keywords: "Carpenter" },
  { id: "w9", label: "Vinod" },
];

const GROUPS: GridGroup[] = [
  { label: "Carpenter", optionIds: ["w1", "w3"] },
  { label: "Mason", optionIds: ["w2"] },
];

describe("filterOptions", () => {
  test("an empty query shows everyone", () => {
    expect(filterOptions(CREW, "").length).toBe(4);
    expect(filterOptions(CREW, "   ").length).toBe(4);
  });

  test("matches a name, case-insensitively", () => {
    expect(filterOptions(CREW, "anil").map((o) => o.id)).toEqual(["w2"]);
    expect(filterOptions(CREW, "RAK").map((o) => o.id)).toEqual(["w1"]);
  });

  test("matches a trade too -- C-08's search is 'by name or trade'", () => {
    expect(filterOptions(CREW, "carpenter").map((o) => o.id)).toEqual(["w1", "w3"]);
  });

  test("a query nobody matches yields nothing, not everyone", () => {
    expect(filterOptions(CREW, "zzz")).toEqual([]);
  });
});

describe("groupOptions", () => {
  test("with no groups it is the kit's own flat strip, unlabelled", () => {
    expect(groupOptions(CREW, undefined)).toEqual([{ label: null, options: CREW }]);
    expect(groupOptions(CREW, [])).toEqual([{ label: null, options: CREW }]);
  });

  test("one row per trade, in the groups' own order", () => {
    const rows = groupOptions(CREW, GROUPS);
    expect(rows.map((r) => r.label)).toEqual(["Carpenter", "Mason", "Other"]);
    expect(rows[0].options.map((o) => o.id)).toEqual(["w1", "w3"]);
    expect(rows[2].options.map((o) => o.id)).toEqual(["w9"]);
  });

  test("A HEADING NEVER SURVIVES ITS OWN GROUP: filter to Anil and Carpenter is gone", () => {
    const rows = groupOptions(filterOptions(CREW, "anil"), GROUPS);
    expect(rows.map((r) => r.label)).toEqual(["Mason"]);
  });

  test("a group naming an option that is not visible simply skips it", () => {
    const rows = groupOptions(filterOptions(CREW, "rakesh"), GROUPS);
    expect(rows).toEqual([{ label: "Carpenter", options: [CREW[0]] }]);
  });

  test("an option claimed by two groups renders once, under the first", () => {
    const rows = groupOptions(CREW, [
      { label: "Carpenter", optionIds: ["w1"] },
      { label: "Also carpenter", optionIds: ["w1"] },
    ]);
    expect(rows.map((r) => r.label)).toEqual(["Carpenter", "Other"]);
    expect(rows[0].options.map((o) => o.id)).toEqual(["w1"]);
    expect(rows[1].options.map((o) => o.id)).toEqual(["w2", "w3", "w9"]);
  });
});
