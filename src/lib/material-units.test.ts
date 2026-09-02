import { describe, expect, test } from "bun:test";
import { MATERIAL_UNITS, isMaterialUnit, materialUnitLabel, normaliseMaterialUnit } from "./material-units";

describe("the closed unit vocabulary (R-260)", () => {
  test("every value is canonical: lower-case, trimmed, non-empty", () => {
    for (const unit of MATERIAL_UNITS) {
      expect(unit.value).toBe(unit.value.toLowerCase());
      expect(unit.value).toBe(unit.value.trim());
      expect(unit.value.length).toBeGreaterThan(0);
      expect(unit.label.length).toBeGreaterThan(0);
    }
  });

  test("no value appears twice -- the whole point is that one unit is one string", () => {
    const values = MATERIAL_UNITS.map((u) => u.value);
    expect(new Set(values).size).toBe(values.length);
  });

  test("covers the units the old free-text placeholder suggested", () => {
    for (const value of ["bag", "cum", "kg"]) {
      expect(isMaterialUnit(value)).toBe(true);
    }
  });
});

describe("normaliseMaterialUnit folds the spellings that already exist", () => {
  test("'bag' and 'Bag' cannot coexist -- the exact defect R-260 names", () => {
    expect(normaliseMaterialUnit("bag")).toBe("bag");
    expect(normaliseMaterialUnit("Bag")).toBe("bag");
    expect(normaliseMaterialUnit("BAG")).toBe("bag");
    expect(normaliseMaterialUnit("  bag  ")).toBe("bag");
    expect(normaliseMaterialUnit("bags")).toBe("bag");
    expect(new Set(["bag", "Bag", "BAG", "  bag  ", "bags"].map(normaliseMaterialUnit)).size).toBe(1);
  });

  test("'nos' is a unit in its own right and is not de-pluralised to 'no'", () => {
    expect(normaliseMaterialUnit("nos")).toBe("nos");
  });

  test("an unrecognised unit comes back null rather than being rewritten", () => {
    // A legacy row saying "drum" must keep saying "drum". Guessing at it is
    // how a stored value silently becomes something the user never entered.
    expect(normaliseMaterialUnit("drum")).toBeNull();
    expect(normaliseMaterialUnit("")).toBeNull();
    expect(normaliseMaterialUnit(null)).toBeNull();
    expect(normaliseMaterialUnit(undefined)).toBeNull();
  });
});

describe("materialUnitLabel", () => {
  test("expands a canonical value for display", () => {
    expect(materialUnitLabel("cum")).toBe("cum (cubic metre)");
    expect(materialUnitLabel("bag")).toBe("bag");
  });

  test("shows a legacy value verbatim rather than blanking it", () => {
    expect(materialUnitLabel("drum")).toBe("drum");
    expect(materialUnitLabel(null)).toBe("");
  });
});
