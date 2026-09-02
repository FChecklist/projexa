/// <reference types="bun-types" />
// R67 D-24. The BOQ create/revise grids used to offer an ENABLED Save on a
// completely empty form and only discover an incomplete line after the click,
// in a toast that named the line but not the field. These pin the shared
// validation model behind the fix: what the primary's disabled reason names,
// which field of which line is still missing, and the single sentence each
// missing field is reported with -- so the button, the on-blur message and the
// submit-time error can never say different things about the same empty box.
import { describe, expect, test } from "bun:test";
import {
  LINE_FIELD_LABEL, LINE_FIELD_MESSAGE, TITLE_REQUIRED_MESSAGE,
  collectLines, emptyLine, isUntouchedLine, lineMissingFields, missingBoqFields,
  toDrafts, toPayloadLineItems, unitForLine,
  type BoqLineItemRow, type LineItemDraft,
} from "./boq-helpers";

function line(overrides: Partial<LineItemDraft> = {}): LineItemDraft {
  return { ...emptyLine(), ...overrides };
}

const COMPLETE = line({ description: "Blockwork", unit: "sqm", quantity: "10", rate: "5" });

describe("missingBoqFields -- what 'Save (Title, Line 1)' is built from", () => {
  test("an empty form names both, in the order the button prints them", () => {
    expect(missingBoqFields("", [emptyLine()])).toEqual(["Title", "Line 1"]);
  });

  test("typing a title leaves only the line", () => {
    expect(missingBoqFields("Civil Works - Phase 1", [emptyLine()])).toEqual(["Line 1"]);
  });

  test("a complete title and a complete line 1 leave nothing missing -- Save is enabled", () => {
    expect(missingBoqFields("Civil Works - Phase 1", [COMPLETE])).toEqual([]);
  });

  test("a whitespace-only title still counts as missing", () => {
    expect(missingBoqFields("   ", [COMPLETE])).toEqual(["Title"]);
  });

  test("'+ Add Line' does NOT immediately disable Save -- an untouched extra row is not a mistake", () => {
    expect(missingBoqFields("Civil Works", [COMPLETE, emptyLine()])).toEqual([]);
  });

  test("but a TOUCHED, incomplete later line is named by its own number", () => {
    const touched = line({ description: "Skirting" }); // no unit, qty, rate
    expect(missingBoqFields("Civil Works", [COMPLETE, touched])).toEqual(["Line 2"]);
  });
});

describe("lineMissingFields", () => {
  test("an empty line 1 is missing description, unit, quantity and rate", () => {
    expect(lineMissingFields([emptyLine()], 0)).toEqual(["description", "unit", "quantity", "rate"]);
  });

  test("a SUB-line needs a Breakdown % and is never asked for Qty or Rate -- the backend derives those from its root", () => {
    const parent = line({ description: "Main", unit: "sqm", quantity: "100", rate: "50", itemCode: "M1" });
    const child = line({ description: "Frame", parentItemCode: "M1" });
    expect(lineMissingFields([parent, child], 1)).toEqual(["breakdownPercentage"]);
  });

  test("a sub-line inherits its parent's unit rather than being told to retype it", () => {
    const parent = line({ description: "Main", unit: "sqm", quantity: "100", rate: "50", itemCode: "M1" });
    const child = line({ description: "Frame", parentItemCode: "M1", breakdownPercentage: "30" });
    expect(unitForLine([parent, child], 1)).toBe("sqm");
    expect(lineMissingFields([parent, child], 1)).toEqual([]);
  });

  test("an out-of-range index is empty, never a crash", () => {
    expect(lineMissingFields([emptyLine()], 9)).toEqual([]);
  });
});

describe("the field sentences the grid renders", () => {
  test("an empty Qty is reported as exactly 'Enter the quantity'", () => {
    expect(LINE_FIELD_MESSAGE.quantity).toBe("Enter the quantity");
  });

  test("an empty Title is reported as exactly 'Enter a title, e.g. Civil Works - Phase 1'", () => {
    expect(TITLE_REQUIRED_MESSAGE).toBe("Enter a title, e.g. Civil Works - Phase 1");
  });

  test("every field the validator can name has a sentence AND a short label", () => {
    for (const field of lineMissingFields([emptyLine()], 0)) {
      expect(LINE_FIELD_MESSAGE[field]).toBeTruthy();
      expect(LINE_FIELD_LABEL[field]).toBeTruthy();
    }
  });
});

describe("isUntouchedLine", () => {
  test("a fresh row is untouched", () => {
    expect(isUntouchedLine(emptyLine())).toBe(true);
  });

  test("a row carrying ONLY a category is touched -- a human chose that", () => {
    expect(isUntouchedLine(line({ category: "Gypsum" }))).toBe(false);
  });
});

describe("collectLines still reports an incomplete row by number and field", () => {
  test("names the line and the missing labels, and saves nothing", () => {
    const result = collectLines([COMPLETE, line({ description: "Skirting" })]);
    expect(result.valid).toEqual([]);
    expect(result.error).toBe("Line 2 is incomplete — add Unit, Qty, Rate. Nothing was saved.");
  });

  test("an all-blank submission is still a legitimate title-only BOQ, never an error", () => {
    expect(collectLines([emptyLine(), emptyLine()])).toEqual({ valid: [], error: null });
  });
});

describe("category round-trips through the payload (D-24, drizzle/0528)", () => {
  test("a chosen category is carried in the POST body", () => {
    const [payload] = toPayloadLineItems([line({ description: "Ceiling", unit: "sqm", quantity: "10", rate: "5", category: "Gypsum" })]);
    expect(payload.category).toBe("Gypsum");
  });

  test("an unchosen category is OMITTED, not sent as an empty string", () => {
    const [payload] = toPayloadLineItems([COMPLETE]);
    expect("category" in payload).toBe(false);
  });

  test("a saved line's category comes back into the revise grid", () => {
    const row: BoqLineItemRow = {
      id: "li-1", itemCode: "C1", description: "Ceiling", unit: "sqm",
      quantity: "10", rate: "5", amount: "50", activityId: null, category: "Gypsum",
    };
    expect(toDrafts([row])[0].category).toBe("Gypsum");
  });

  test("an uncategorised saved line comes back as an empty selection, not the string 'null'", () => {
    const row: BoqLineItemRow = {
      id: "li-2", itemCode: "C2", description: "Blockwork", unit: "sqm",
      quantity: "10", rate: "5", amount: "50", activityId: null, category: null,
    };
    expect(toDrafts([row])[0].category).toBe("");
  });
});
