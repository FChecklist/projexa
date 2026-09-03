/// <reference types="bun-types" />
// R67 lane B (B-09) -- the Daily Entry form's required-field rule, proved
// against BOTH project states, because getting one of them wrong is how the
// module becomes unusable: require a BOQ line on a project that has no BOQ
// and nobody can log anything at all.
import { describe, expect, test } from "bun:test";
import {
  REQUIRED_FIELD_LABELS,
  missingFieldNames,
  missingProgressFields,
  requiredProgressFields,
  submitLabelFor,
} from "./work-progress-form-fields";

const FILLED = {
  activityId: "act_1",
  entryDate: "2026-09-02",
  quantityDone: 2,
  percentComplete: 40,
  entryBasis: "DELTA",
};

describe("the rule matches the server's, in both project states", () => {
  test("a project WITH a BOQ requires the line", () => {
    expect(requiredProgressFields(true)).toContain("boqLineItemId");
  });

  test("a project WITHOUT a BOQ does not -- there is nothing to link to", () => {
    expect(requiredProgressFields(false)).not.toContain("boqLineItemId");
  });

  test("everything else is required either way", () => {
    for (const f of ["activityId", "entryDate", "quantityDone", "percentComplete", "entryBasis"]) {
      expect(requiredProgressFields(false)).toContain(f);
      expect(requiredProgressFields(true)).toContain(f);
    }
  });
});

describe("B-09 acceptance -- the Save button names the BOQ line when it is what is missing", () => {
  test("only the line missing -> 'Log Entry (BOQ line)'", () => {
    const missing = missingProgressFields(FILLED, true);
    expect(missing).toEqual(["boqLineItemId"]);
    expect(submitLabelFor(missing)).toBe("Log Entry (BOQ line)");
  });

  test("the same form on a project with no BOQ is complete -> plain 'Log Entry'", () => {
    const missing = missingProgressFields(FILLED, false);
    expect(missing).toEqual([]);
    expect(submitLabelFor(missing)).toBe("Log Entry");
  });

  // R67 FIX PASS -- the button names ONE field, not four.
  //
  // A freshly-opened Daily Entry form prefills only entryDate and entryBasis,
  // so naming every missing field made the primary control read "Log Entry
  // (Activity, BOQ line, Quantity done, % complete)" -- a worse label than
  // the "Log Entry" + "4 required fields" it replaced, and not the two-word
  // case the item quotes. The full list still lives in the disabled reason,
  // which is where a list belongs.
  test("several missing fields collapse to the plain label", () => {
    const missing = missingProgressFields({ entryBasis: "DELTA" }, true);
    expect(missing.length).toBeGreaterThan(1);
    expect(submitLabelFor(missing)).toBe("Log Entry");
  });

  test("the form as it actually opens does not produce a four-item parenthetical", () => {
    // Exactly the initial values: a date and a basis, nothing else.
    const missing = missingProgressFields({ entryDate: "2026-09-02", entryBasis: "DELTA" }, true);
    expect(missing).toEqual(["activityId", "boqLineItemId", "quantityDone", "percentComplete"]);
    expect(submitLabelFor(missing)).toBe("Log Entry");
    // ...and the reason beside it still names all four, in form order.
    expect(missingFieldNames(missing)).toBe("Activity, BOQ line, Quantity done, % complete");
  });

  test("the label never grows past one named field", () => {
    for (const values of [{}, { entryBasis: "DELTA" }, { ...FILLED, boqLineItemId: undefined }]) {
      const label = submitLabelFor(missingProgressFields(values, true));
      expect(label.split(",").length).toBe(1);
      expect(label.startsWith("Log Entry")).toBe(true);
    }
  });

  test("a field left as an empty string counts as missing, not as answered", () => {
    expect(missingProgressFields({ ...FILLED, boqLineItemId: "" }, true)).toEqual(["boqLineItemId"]);
    expect(missingProgressFields({ ...FILLED, boqLineItemId: null }, true)).toEqual(["boqLineItemId"]);
  });
});

describe("no label is a camelCase parameter name", () => {
  test("every label is words a person would say", () => {
    for (const label of Object.values(REQUIRED_FIELD_LABELS)) {
      expect(label).not.toMatch(/[a-z][A-Z]/);
      expect(label).not.toContain("_");
    }
    expect(missingFieldNames(["boqLineItemId", "activityId"])).toBe("BOQ line, Activity");
  });
});
