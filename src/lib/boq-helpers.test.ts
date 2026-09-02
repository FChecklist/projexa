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
  collectLines,
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
