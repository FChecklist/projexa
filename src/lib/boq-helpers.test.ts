// R67 lane I (WS-I item I-05, R-177): the Category field's behaviour in the
// BOQ form helpers. These four functions are the ONLY place the Create and
// Revise screens agree about what a line row means, so the category rules that
// matter are pinned here rather than trusted to two components:
//   * a row whose only content is a category is NOT untouched (never silently
//     dropped -- R47_SILENT_DROP_01);
//   * a category is never REQUIRED, so a line without one still saves;
//   * a blank category is omitted from the payload entirely, so the server
//     stores NULL rather than "" (two different "no category" values in one
//     column would split the Uncategorized bucket in two);
//   * toDrafts carries the category forward, so revising a BOQ does not
//     uncategorise it.
/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  NO_CATEGORY_CHIP_LABEL,
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
  toDrafts,
  toPayloadLineItems,
  type BoqLineItemRow,
  type LineItemDraft,
} from "./boq-helpers";

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

describe("toDrafts -- revising a BOQ must not uncategorise it", () => {
  test("carries each persisted line's category into the revision form", () => {
    const drafts = toDrafts([
      persistedRow({ id: "a", category: "Civil" }),
      persistedRow({ id: "b", itemCode: "2", category: null }),
    ]);
    expect(drafts[0].category).toBe("Civil");
    expect(drafts[1].category).toBeUndefined();
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
