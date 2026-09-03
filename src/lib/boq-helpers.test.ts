/// <reference types="bun-types" />
// R67 D-24 + lane I (WS-I item I-05, R-177). boq-helpers is the ONLY place the
// Create and Revise screens agree about what a line row means, so both lanes'
// rules are pinned here rather than trusted to two components.
//
// D-24 (the shared validation model): the grids used to offer an ENABLED Save
// on a completely empty form and only discover an incomplete line after the
// click, in a toast that named the line but not the field. What the primary's
// disabled reason names, which field of which line is still missing, and the
// single sentence each missing field is reported with all come from these
// functions -- so the button, the on-blur message and the submit-time error
// can never say different things about the same empty box.
//
// I-05 (the Category field): a row whose only content is a category is NOT
// untouched (never silently dropped -- R47_SILENT_DROP_01); a category is
// never REQUIRED, so a line without one still saves; a blank category is
// omitted from the payload entirely, so the server stores NULL rather than ""
// (two different "no category" values in one column would split the
// Uncategorized bucket in two); and toDrafts carries the category forward, so
// revising a BOQ does not uncategorise it.
import { describe, expect, test } from "bun:test";
import {
  LINE_FIELD_LABEL, LINE_FIELD_MESSAGE, NO_CATEGORY_CHIP_LABEL, TITLE_REQUIRED_MESSAGE,
  collectLines, emptyLine, isUntouchedLine, lineMissingFields, missingBoqFields,
  toDrafts, toPayloadLineItems, unitForLine,
  type BoqLineItemRow, type LineItemDraft,
} from "./boq-helpers";

function line(overrides: Partial<LineItemDraft> = {}): LineItemDraft {
  return { ...emptyLine(), ...overrides };
}

function draft(overrides: Partial<LineItemDraft> = {}): LineItemDraft {
  return { ...emptyLine(), description: "Blockwork", unit: "sqm", quantity: "10", rate: "5", ...overrides };
}

function persistedRow(overrides: Partial<BoqLineItemRow> = {}): BoqLineItemRow {
  return {
    id: "row-1", itemCode: "1", description: "Blockwork", unit: "sqm",
    quantity: "10", rate: "5", amount: "50", activityId: null,
    parentLineItemId: null, breakdownPercentage: null,
    ...overrides,
  };
}

const COMPLETE = line({ description: "Blockwork", unit: "sqm", quantity: "10", rate: "5" });

describe("emptyLine", () => {
  test("starts with a blank category, so a fresh row is genuinely untouched", () => {
    expect(emptyLine().category).toBe("");
    expect(collectLines([emptyLine()])).toEqual({ valid: [], error: null });
  });
});

describe("collectLines -- category is content, but never a requirement", () => {
  test("a row whose ONLY content is a category is kept and reported incomplete, never silently dropped", () => {
    const result = collectLines([{ ...emptyLine(), category: "Civil" }]);
    expect(result.valid).toEqual([]);
    expect(result.error).toBe("Line 1 is incomplete — add Description, Unit, Qty, Rate. Nothing was saved.");
  });

  test("a complete line with NO category is valid -- a missing category never blocks Save", () => {
    const result = collectLines([draft({ category: "" })]);
    expect(result.error).toBeNull();
    expect(result.valid).toHaveLength(1);
  });

  test("a complete line WITH a category is valid and keeps it", () => {
    const result = collectLines([draft({ category: "Gypsum" })]);
    expect(result.error).toBeNull();
    expect(result.valid[0].category).toBe("Gypsum");
  });
});

describe("toPayloadLineItems -- what actually reaches the server", () => {
  test("a real category is trimmed and sent", () => {
    expect(toPayloadLineItems([draft({ category: "  Civil " })])[0]).toMatchObject({ category: "Civil" });
  });

  test("a blank category is OMITTED, not sent as an empty string", () => {
    for (const blank of ["", "   ", undefined]) {
      const payload = toPayloadLineItems([draft({ category: blank })])[0];
      expect("category" in payload).toBe(false);
    }
  });
});

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

describe("toDrafts -- revising a BOQ must not uncategorise it", () => {
  test("carries each persisted line's category into the revision form", () => {
    const drafts = toDrafts([
      persistedRow({ id: "a", category: "Civil" }),
      persistedRow({ id: "b", itemCode: "2", category: null }),
    ]);
    expect(drafts[0].category).toBe("Civil");
    // "" and not undefined: the grid's Category control is a CONTROLLED
    // select, and undefined would make React switch it to uncontrolled and
    // warn. "" is this module's single spelling of "no category chosen" --
    // toPayloadLineItems below is what turns it back into an omitted field so
    // the server stores NULL.
    expect(drafts[1].category).toBe("");
  });

  test("a category that survives toDrafts also survives the round-trip back to a payload", () => {
    const [redrafted] = toDrafts([persistedRow({ category: "Joinery" })]);
    expect(toPayloadLineItems([redrafted])[0]).toMatchObject({ category: "Joinery" });
  });
});

describe("NO_CATEGORY_CHIP_LABEL", () => {
  test("is one shared string, so Create/Revise/Object can never show three different words", () => {
    expect(NO_CATEGORY_CHIP_LABEL).toBe("no category");
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

describe("category round-trips through the payload (D-24 / lane I I-05)", () => {
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
