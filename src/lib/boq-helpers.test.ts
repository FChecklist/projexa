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
  LINE_FIELD_LABEL,
  LINE_FIELD_MESSAGE,
  NO_CATEGORY_CHIP_LABEL,
  TITLE_REQUIRED_MESSAGE,
  childPercentNote,
  collectLines,
  createBoqSaveDisabledReason,
  draftBoqTotal,
  draftLineAmount,
  draftLineFieldMessages,
  draftLineMissingFields,
  draftLineTouched,
  draftRootAncestor,
  emptyLine,
  isUntouchedLine,
  lineMissingFields,
  missingBoqFields,
  toDrafts,
  toPayloadLineItems,
  unitForLine,
  type BoqLineItemRow,
  type LineItemDraft,
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

// ─── R67 lane D22 (item D-60, recs R-196/R-225) ───────────────────────────
// The new-BOQ grid's arithmetic and its disabled-with-reason button. The
// acceptance clause names the empty-form button text literally, so it is
// pinned here character for character.
describe("draftRootAncestor", () => {
  const root = draft({ itemCode: "A", quantity: "100", rate: "10" });
  const child = draft({ itemCode: "A-1", parentItemCode: "A", breakdownPercentage: "40", quantity: "", rate: "" });
  const grandchild = draft({ itemCode: "A-1-a", parentItemCode: "A-1", breakdownPercentage: "50", quantity: "", rate: "" });

  test("a root line is its own root", () => {
    expect(draftRootAncestor(root, [root])).toBe(root);
  });

  test("walks past the immediate parent to the true root, per the canonical child-rate rule", () => {
    expect(draftRootAncestor(grandchild, [root, child, grandchild])).toBe(root);
  });

  test("a parent code nothing declares has no root, rather than a guessed one", () => {
    expect(draftRootAncestor(draft({ parentItemCode: "GHOST" }), [root])).toBeNull();
  });

  test("a loop of parents has no root instead of hanging", () => {
    const a = draft({ itemCode: "A", parentItemCode: "B" });
    const b = draft({ itemCode: "B", parentItemCode: "A" });
    expect(draftRootAncestor(a, [a, b])).toBeNull();
  });
});

describe("draftLineAmount / draftBoqTotal", () => {
  const root = draft({ itemCode: "A", quantity: "100", rate: "10" });
  const child = draft({ itemCode: "A-1", parentItemCode: "A", breakdownPercentage: "40", quantity: "", rate: "" });

  test("a root line's amount is qty x rate", () => {
    expect(draftLineAmount(root, [root])).toBe(1000);
  });

  test("a sub-task's amount is the root's amount x its breakdown %, matching what the server stores", () => {
    expect(draftLineAmount(child, [root, child])).toBe(400);
  });

  test("an incomplete line has no amount rather than a misleading zero", () => {
    expect(draftLineAmount(draft({ quantity: "", rate: "" }), [])).toBeNull();
    expect(draftLineAmount(draft({ itemCode: "A-2", parentItemCode: "A", breakdownPercentage: "" }), [root])).toBeNull();
  });

  test("the running total counts root lines only, so a weighted sub-task is not double-counted", () => {
    expect(draftBoqTotal([root, child])).toBe(1000);
    const second = draft({ itemCode: "B", quantity: "2", rate: "50" });
    expect(draftBoqTotal([root, child, second])).toBe(1100);
  });
});

describe("createBoqSaveDisabledReason", () => {
  test("an untouched form reads exactly the sentence the acceptance names", () => {
    expect(createBoqSaveDisabledReason("", [emptyLine()])).toBe("Title, 1 line with Description, Qty, Rate");
  });

  test("names only what is still missing once part of the form is filled", () => {
    expect(createBoqSaveDisabledReason("Fit-out", [emptyLine()])).toBe("1 line with Description, Qty, Rate");
    expect(createBoqSaveDisabledReason("", [draft()])).toBe("Title");
  });

  test("narrows to the one field a nearly-complete line is missing", () => {
    expect(createBoqSaveDisabledReason("Fit-out", [draft({ unit: "" })])).toBe("1 line with Unit");
    expect(createBoqSaveDisabledReason("Fit-out", [draft({ rate: "" })])).toBe("1 line with Rate");
  });

  test("is null -- the button is enabled -- once a title and one complete line exist", () => {
    expect(createBoqSaveDisabledReason("Fit-out", [draft()])).toBeNull();
  });

  test("a sub-task counts as a complete line when it carries a breakdown %, inheriting its unit", () => {
    const root = draft({ itemCode: "A" });
    const child = { ...emptyLine(), description: "Sub", itemCode: "A-1", parentItemCode: "A", breakdownPercentage: "40" };
    expect(createBoqSaveDisabledReason("Fit-out", [root, child])).toBeNull();
  });
});

describe("draftLineMissingFields / draftLineTouched", () => {
  test("a blank row is untouched; any single character makes it real", () => {
    expect(draftLineTouched(emptyLine())).toBe(false);
    expect(draftLineTouched({ ...emptyLine(), category: "Civil" })).toBe(true);
  });

  test("a sub-task needs a breakdown %, not a qty and rate of its own", () => {
    const root = draft({ itemCode: "A" });
    const child = { ...emptyLine(), description: "Sub", itemCode: "A-1", parentItemCode: "A" };
    expect(draftLineMissingFields(child, [root, child])).toEqual(["Breakdown %"]);
  });
});

describe("draftLineFieldMessages", () => {
  const root = draft({ itemCode: "A" });

  test("says which code is missing, using the code the user actually typed", () => {
    const child = { ...emptyLine(), parentItemCode: "X-9", breakdownPercentage: "50" };
    expect(draftLineFieldMessages(child, [root, child])).toEqual([
      { field: "parentItemCode", text: "No line has Item Code X-9" },
    ]);
  });

  test("asks for the breakdown % in the words the item specifies", () => {
    const child = { ...emptyLine(), itemCode: "A-1", parentItemCode: "A" };
    expect(draftLineFieldMessages(child, [root, child])).toEqual([
      { field: "breakdownPercentage", text: "Enter the % of the parent this sub-task carries" },
    ]);
  });

  test("catches a line pointed at itself", () => {
    const self = { ...emptyLine(), itemCode: "A", parentItemCode: "A", breakdownPercentage: "50" };
    expect(draftLineFieldMessages(self, [self])[0]!.text).toBe("A line cannot be its own parent");
  });

  test("a root line has nothing to say -- an empty Parent code is the normal case", () => {
    expect(draftLineFieldMessages(root, [root])).toEqual([]);
  });
});

describe("childPercentNote", () => {
  test("reads as the item specifies once children exist", () => {
    const root = draft({ itemCode: "A" });
    const c1 = { ...emptyLine(), parentItemCode: "A", breakdownPercentage: "40" };
    const c2 = { ...emptyLine(), parentItemCode: "A", breakdownPercentage: "35" };
    expect(childPercentNote([root, c1, c2], "A")).toBe("children total 75% of 100%");
  });

  test("is silent for a line with no children at all", () => {
    expect(childPercentNote([draft({ itemCode: "A" })], "A")).toBeNull();
    expect(childPercentNote([draft({ itemCode: "A" })], undefined)).toBeNull();
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
