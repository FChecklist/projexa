/// <reference types="bun-types" />
// R67 D-40. The acceptance sentence is exact -- "Only 120 bags on hand" -- and
// the cases that matter are the ones where a plural would be WRONG.
import { describe, expect, test } from "bun:test";
import { issueQuantityError, onHandLimitMessage, pluraliseUnit, QUANTITY_TOO_SMALL_MESSAGE } from "./unit-label";

describe("pluraliseUnit", () => {
  test("a countable noun takes a plural", () => {
    expect(pluraliseUnit("bag", 120)).toBe("bags");
    expect(pluraliseUnit("drum", 4)).toBe("drums");
    expect(pluraliseUnit("sheet", 0)).toBe("sheets");
  });

  test("exactly one never pluralises", () => {
    expect(pluraliseUnit("bag", 1)).toBe("bag");
  });

  test("unit symbols are left alone -- '120 kg', never '120 kgs'", () => {
    expect(pluraliseUnit("kg", 120)).toBe("kg");
    expect(pluraliseUnit("cum", 5)).toBe("cum");
    expect(pluraliseUnit("sqm", 40)).toBe("sqm");
    expect(pluraliseUnit("m3", 2)).toBe("m3");
    expect(pluraliseUnit("KG", 120)).toBe("KG");
  });

  test("a unit that is already plural is not doubled", () => {
    expect(pluraliseUnit("nos", 12)).toBe("nos");
    expect(pluraliseUnit("rolls", 3)).toBe("rolls");
  });

  test("a missing or blank unit yields an empty string, never 'undefineds'", () => {
    expect(pluraliseUnit(null, 5)).toBe("");
    expect(pluraliseUnit("   ", 5)).toBe("");
  });
});

describe("onHandLimitMessage", () => {
  test("the exact sentence the audit specifies", () => {
    expect(onHandLimitMessage(120, "bag")).toBe("Only 120 bags on hand");
  });

  test("a symbol unit keeps its own form, and a material with no unit still reads as a sentence", () => {
    expect(onHandLimitMessage(120, "kg")).toBe("Only 120 kg on hand");
    expect(onHandLimitMessage(0, null)).toBe("Only 0 on hand");
  });
});

// The Issue form's rule itself. It lives here rather than inside
// MaterialIssueCreateClient so it can be exercised directly: this repo's test
// environment (happy-dom + React 19) does not deliver `input`/`change` events
// to React at all -- verified by a minimal controlled-input harness -- so a
// component test cannot type into a field. Clicks and keyboard events do work,
// which is why the sibling component test covers everything reachable by them
// and this covers the arithmetic and the exact sentences.
describe("issueQuantityError -- the Issue form's rule (D-40)", () => {
  test("an untouched field is not an error", () => {
    expect(issueQuantityError("", 120, "bag")).toBeUndefined();
  });

  test("130 against 120 on hand gives the exact sentence the audit specifies", () => {
    expect(issueQuantityError("130", 120, "bag")).toBe("Only 120 bags on hand");
  });

  test("exactly the balance is allowed -- the cap is 'more than', not 'as much as'", () => {
    expect(issueQuantityError("120", 120, "bag")).toBeUndefined();
    expect(issueQuantityError("119.5", 120, "bag")).toBeUndefined();
  });

  test("zero, a negative and a non-number are all refused with the same sentence", () => {
    expect(issueQuantityError("0", 120, "bag")).toBe(QUANTITY_TOO_SMALL_MESSAGE);
    expect(issueQuantityError("-5", 120, "bag")).toBe(QUANTITY_TOO_SMALL_MESSAGE);
    expect(issueQuantityError("abc", 120, "bag")).toBe(QUANTITY_TOO_SMALL_MESSAGE);
  });

  test("with no material chosen the balance is unknown, so only the 'greater than 0' half applies", () => {
    expect(issueQuantityError("999999", null, null)).toBeUndefined();
    expect(issueQuantityError("0", null, null)).toBe(QUANTITY_TOO_SMALL_MESSAGE);
  });

  test("nothing on hand refuses every quantity, and says so in the material's own unit", () => {
    expect(issueQuantityError("1", 0, "bag")).toBe("Only 0 bags on hand");
  });
});
