/// <reference types="bun-types" />
// R67 D-27. The destructive way out of the scope-reduction block used to read
// "Apply anyway (override)" -- a button that named neither what it overrides
// nor how much of it. These pin the wording a user is asked to accept.
import { describe, expect, test } from "bun:test";
import { conflictLabel, conflictQuantity, overrideActionLabel, type ScopeReductionConflict } from "./scope-conflicts";

function conflict(over: Partial<ScopeReductionConflict> = {}): ScopeReductionConflict {
  return { itemCode: "R60SK-A", description: "R60 skiphop sub", recordedQty: 12, unit: "m2", lastRecordedAt: "2026-08-28", ...over };
}

describe("overrideActionLabel", () => {
  test("one line is singular -- a destructive control that says '1 completed lines' undermines everything around it", () => {
    expect(overrideActionLabel(1)).toBe("Apply anyway - override 1 completed line");
  });

  test("more than one is plural", () => {
    expect(overrideActionLabel(3)).toBe("Apply anyway - override 3 completed lines");
  });
});

describe("conflictLabel", () => {
  test("names the line by its item code when it has one", () => {
    expect(conflictLabel(conflict())).toBe("R60SK-A");
  });

  test("falls back to the description rather than rendering a row that identifies itself as nothing", () => {
    expect(conflictLabel(conflict({ itemCode: null, description: "Unnumbered extra" }))).toBe("Unnumbered extra");
  });

  test("a blank item code counts as no item code", () => {
    expect(conflictLabel(conflict({ itemCode: "  ", description: "Blockwork" }))).toBe("Blockwork");
  });
});

describe("conflictQuantity", () => {
  test("carries the line's own unit -- '12 m2', the figure a site engineer recognises", () => {
    expect(conflictQuantity(conflict())).toBe("12 m2");
  });

  test("a unitless line reads as the bare quantity, not '12 undefined'", () => {
    expect(conflictQuantity(conflict({ unit: "" }))).toBe("12");
  });

  test("groups thousands and caps the decimals", () => {
    expect(conflictQuantity(conflict({ recordedQty: 1234.567, unit: "kg" }))).toBe("1,234.57 kg");
  });
});
