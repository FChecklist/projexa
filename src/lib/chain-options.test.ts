import { describe, expect, test } from "bun:test";
import {
  boqLineLevel,
  boqLineOptions,
  levelSourceFor,
  lineLabel,
  normaliseLevel,
  parseLevelPath,
  pickCurrentBoq,
  progressValueLevel,
  activeRoster,
  rosterLevel,
  tradeOf,
  type BoqRow,
  type RosterEntry,
} from "./chain-options";

const BOQ: BoqRow = {
  id: "b2",
  version: 2,
  status: "active",
  createdAt: "2026-08-01T00:00:00.000Z",
  lineItems: [
    { id: "l1", itemCode: "EX", description: "Earthworks", parentLineItemId: null },
    { id: "l2", itemCode: "EX-01", description: "Excavation", parentLineItemId: "l1" },
    { id: "l3", itemCode: "EX-02", description: "Backfill", parentLineItemId: "l1" },
  ],
};

describe("which BOQ the progress belongs to", () => {
  test("the newest live BOQ wins, version first then createdAt", () => {
    const older: BoqRow = { id: "b1", version: 1, status: "active", createdAt: "2026-01-01T00:00:00.000Z" };
    const sameVersionNewer: BoqRow = { id: "b3", version: 2, status: "active", createdAt: "2026-09-01T00:00:00.000Z" };
    expect(pickCurrentBoq([older, BOQ])?.id).toBe("b2");
    expect(pickCurrentBoq([BOQ, sameVersionNewer])?.id).toBe("b3");
  });

  test("a superseded BOQ is skipped -- unless every BOQ is superseded", () => {
    const superseded: BoqRow = { id: "old", version: 9, status: "superseded" };
    expect(pickCurrentBoq([superseded, BOQ])?.id).toBe("b2");
    expect(pickCurrentBoq([superseded])?.id).toBe("old");
  });

  test("no BOQs at all is null, not a crash", () => {
    expect(pickCurrentBoq([])).toBeNull();
  });
});

describe("one chip per BOQ line", () => {
  test("*** A PARENT LINE IS SHOWN AND DISABLED, NEVER HIDDEN ***", () => {
    const options = boqLineOptions(BOQ);
    expect(options).toHaveLength(3);
    const parent = options.find((o) => o.id === "EX")!;
    expect(parent.isLeaf).toBe(false);
    expect(parent.unavailableReason).toContain("Parent line");
    const child = options.find((o) => o.id === "EX-01")!;
    expect(child.isLeaf).toBe(true);
    expect(child.unavailableReason).toBeUndefined();
  });

  test("the chip carries the ITEM CODE, which is what the write resolves by", () => {
    expect(boqLineOptions(BOQ).map((o) => o.id)).toEqual(["EX", "EX-01", "EX-02"]);
    // A line with no code falls back to its row id -- the only handle it has.
    expect(
      boqLineOptions({ id: "b", lineItems: [{ id: "row9", itemCode: null, description: "Nameless" }] })[0].id
    ).toBe("row9");
  });

  test("the label is the code the user says, then the words they read", () => {
    expect(lineLabel({ id: "x", itemCode: "EX-01", description: "Excavation" })).toBe("EX-01 Excavation");
    expect(lineLabel({ id: "x", itemCode: "EX-01", description: null })).toBe("EX-01");
    expect(lineLabel({ id: "x", itemCode: null, description: "Excavation" })).toBe("Excavation");
    expect(lineLabel({ id: "x" })).toBe("Untitled line");
  });

  test("no BOQ produces an empty level that PROMPTS with a way out", () => {
    const level = boqLineLevel([]);
    expect(level.legend).toBe("Which BOQ line?");
    expect(level.options).toEqual([]);
    expect(level.emptyPrompt?.text).toBe("This project has no BOQ yet");
    expect(level.emptyPrompt?.route).toBe("/scope/new");
    expect(level.emptyPrompt?.actionLabel).toBeTruthy();
  });

  test("a real BOQ produces the legend C-04's acceptance looks for", () => {
    const level = boqLineLevel([BOQ]);
    expect(level.legend).toBe("Which BOQ line?");
    expect(level.options.map((o) => o.label)).toContain("EX-01 Excavation");
  });
});

describe("the value step", () => {
  test("the four percentages that cover a site engineer's day", () => {
    const level = progressValueLevel();
    expect(level.legend).toBe("How much?");
    expect(level.options.map((o) => o.label)).toEqual(["25 %", "50 %", "75 %", "100 %"]);
    expect(level.options.every((o) => o.isLeaf)).toBe(true);
  });
});

describe("the level path router", () => {
  test("the BOQ level needs a project, and says so by resolving to nothing without one", () => {
    expect(levelSourceFor(["work_progress", "record_progress"], "p1")).toEqual({ kind: "boq", projectId: "p1" });
    expect(levelSourceFor(["work_progress", "record_progress"], null)).toBeNull();
  });

  test("a chosen line advances to the value level", () => {
    const source = levelSourceFor(["work_progress", "record_progress", "l2"], "p1");
    expect(source?.kind).toBe("static");
    if (source?.kind !== "static") return;
    expect(source.level.legend).toBe("How much?");
  });

  test("an unknown path resolves to nothing -- 'I do not know what you asked' is not 'there is nothing here'", () => {
    expect(levelSourceFor(["nonsense"], "p1")).toBeNull();
    expect(levelSourceFor([], "p1")).toBeNull();
  });

  test("parseLevelPath trims and drops blanks", () => {
    expect(parseLevelPath("work_progress, record_progress")).toEqual(["work_progress", "record_progress"]);
    expect(parseLevelPath("")).toEqual([]);
    expect(parseLevelPath(null)).toEqual([]);
    expect(parseLevelPath(",,a,,")).toEqual(["a"]);
  });
});

describe("normaliseLevel guards the contract", () => {
  test("a well-formed payload survives", () => {
    const level = normaliseLevel({
      legend: "Which BOQ line?",
      kind: "step",
      options: [{ id: "l1", label: "EX-01", isLeaf: true }],
      emptyPrompt: { text: "none", actionLabel: "New BOQ", route: "/scope/new" },
    });
    expect(level?.legend).toBe("Which BOQ line?");
    expect(level?.options).toHaveLength(1);
    expect(level?.emptyPrompt?.route).toBe("/scope/new");
  });

  test("a payload with no legend or no options array is BROKEN, not empty", () => {
    expect(normaliseLevel({ options: [] })).toBeNull();
    expect(normaliseLevel({ legend: "  ", options: [] })).toBeNull();
    expect(normaliseLevel({ legend: "Which?" })).toBeNull();
    expect(normaliseLevel(null)).toBeNull();
    expect(normaliseLevel("nope")).toBeNull();
  });

  test("a malformed option is dropped rather than rendered as a blank chip", () => {
    const level = normaliseLevel({
      legend: "Which?",
      options: [{ id: "a", label: "A" }, { id: 5, label: "B" }, null, { label: "no id" }],
    });
    expect(level?.options.map((o) => o.id)).toEqual(["a"]);
  });

  test("an unrecognised kind falls back to step rather than failing the level", () => {
    expect(normaliseLevel({ legend: "Which?", kind: "banana", options: [] })?.kind).toBe("step");
  });
});

// ---------------------------------------------------------------------------
// R67 C-08 -- THE ROSTER LEVEL
// ---------------------------------------------------------------------------

const ROSTER: RosterEntry[] = [
  { id: "w1", name: "Rakesh", trade: "Carpenter", isActive: true },
  { id: "w2", name: "Anil", trade: "Mason", isActive: true },
  { id: "w3", name: "Suresh", trade: "Carpenter", isActive: true },
  { id: "w4", name: "Vinod", trade: null, isActive: true },
  { id: "w5", name: "Left last month", trade: "Mason", isActive: false },
];

describe("activeRoster", () => {
  test("a worker who has left is not on site today", () => {
    expect(activeRoster(ROSTER).map((r) => r.id)).toEqual(["w1", "w2", "w3", "w4"]);
  });

  test("a row with no isActive flag at all is treated as active, not dropped", () => {
    expect(activeRoster([{ id: "w9", name: "New" }]).map((r) => r.id)).toEqual(["w9"]);
  });
});

describe("tradeOf", () => {
  test("never yields a blank sub-heading", () => {
    expect(tradeOf({ id: "x", trade: "Mason" })).toBe("Mason");
    expect(tradeOf({ id: "x", trade: "  " })).toBe("No trade recorded");
    expect(tradeOf({ id: "x" })).toBe("No trade recorded");
  });
});

describe("rosterLevel", () => {
  const level = rosterLevel(ROSTER);

  test("asks its question in words, and is a multi-select level", () => {
    expect(level.legend).toBe("Who was on site?");
    expect(level.multi).toBe(true);
    expect(level.searchBy).toBe("name or trade");
  });

  test("EVERY active worker arrives already ticked -- present is the default", () => {
    expect(level.preselectedIds).toEqual(["w1", "w2", "w3", "w4"]);
    expect(level.options.map((o) => o.label)).toEqual(["Rakesh", "Anil", "Suresh", "Vinod"]);
    // The trade travels with the chip, so the grid search really is "by name
    // or trade" and not by name with a misleading label.
    expect(level.options.map((o) => o.keywords)).toEqual([
      "Carpenter",
      "Mason",
      "Carpenter",
      "No trade recorded",
    ]);
  });

  test("the grid is grouped by trade, in a stable order", () => {
    expect(level.groups).toEqual([
      { label: "Carpenter", optionIds: ["w1", "w3"] },
      { label: "Mason", optionIds: ["w2"] },
      { label: "No trade recorded", optionIds: ["w4"] },
    ]);
  });

  test("a nameless row still renders as something a person can pick", () => {
    expect(rosterLevel([{ id: "w1", name: "  " }]).options[0].label).toBe("Unnamed worker");
  });

  test("an empty roster prompts with the way out, never a blank grid", () => {
    const empty = rosterLevel([]);
    expect(empty.options).toEqual([]);
    expect(empty.emptyPrompt).toEqual({
      text: "This project has no workers on its roster yet",
      actionLabel: "Add worker",
      route: "/labour/new",
    });
  });
});

describe("levelSourceFor, C-08's paths", () => {
  test("the crew comes from the roster read, and only with a project", () => {
    expect(levelSourceFor(["manpower", "mark_attendance"], "p1")).toEqual({ kind: "roster", projectId: "p1" });
    expect(levelSourceFor(["manpower", "mark_attendance"], null)).toBeNull();
  });

  test("site photos reuse the BOQ line chips", () => {
    expect(levelSourceFor(["work_progress", "upload_photos"], "p1")).toEqual({ kind: "boq", projectId: "p1" });
  });
});

describe("normaliseLevel guards the multi contract too", () => {
  test("groups and preselectedIds survive the round trip", () => {
    const level = normaliseLevel(rosterLevel(ROSTER));
    expect(level?.multi).toBe(true);
    expect(level?.preselectedIds).toEqual(["w1", "w2", "w3", "w4"]);
    expect(level?.groups?.[0]).toEqual({ label: "Carpenter", optionIds: ["w1", "w3"] });
  });

  test("a malformed group is dropped rather than crashing the grid", () => {
    const level = normaliseLevel({
      legend: "Who was on site?",
      kind: "step",
      options: [{ id: "w1", label: "Rakesh" }],
      multi: true,
      groups: [{ label: "Carpenter", optionIds: ["w1", 42] }, { optionIds: ["w1"] }, "nonsense"],
      preselectedIds: ["w1", 7],
    });
    expect(level?.groups).toEqual([{ label: "Carpenter", optionIds: ["w1"] }]);
    expect(level?.preselectedIds).toEqual(["w1"]);
  });

  test("a single-select level is not silently turned into a multi one", () => {
    const level = normaliseLevel(progressValueLevel());
    expect(level?.multi).toBe(false);
    expect(level?.groups).toBeUndefined();
  });
});
