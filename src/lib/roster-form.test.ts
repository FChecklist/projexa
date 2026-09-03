/// <reference types="bun-types" />
// R67 D-34 (R-085). The create screen and the edit fields used to validate the
// roster independently -- one silently, one with a toast, neither naming the
// field. These pin the ONE model they both now read, including the case a
// naive implementation gets wrong: a rate that is present but not a usable
// number, which the server refuses and the form therefore must not offer to
// submit.
import { describe, expect, test } from "bun:test";
import {
  isUsableRate,
  missingRosterFields,
  missingRosterReason,
  rateRequiredMessage,
  rosterFieldMessage,
  NAME_REQUIRED_MESSAGE,
} from "./roster-form";

describe("missingRosterFields", () => {
  test("an empty form is missing both, in form order", () => {
    expect(missingRosterFields({ name: "", dailyRate: "" })).toEqual(["name", "dailyRate"]);
  });

  test("a whitespace-only name does not count as a name", () => {
    expect(missingRosterFields({ name: "   ", dailyRate: "120" })).toEqual(["name"]);
  });

  test("a complete form is missing nothing", () => {
    expect(missingRosterFields({ name: "Ali", dailyRate: "120" })).toEqual([]);
  });
});

describe("isUsableRate -- what the server will actually accept", () => {
  test("a plain number is usable", () => {
    expect(isUsableRate("120")).toBe(true);
    expect(isUsableRate("120.5")).toBe(true);
  });

  test("zero is a legitimate rate", () => {
    expect(isUsableRate("0")).toBe(true);
  });

  test("text is not a rate -- the server refuses it, so the form must not offer to submit it", () => {
    expect(isUsableRate("abc")).toBe(false);
  });

  test("a negative rate is refused here as well as on the server", () => {
    expect(isUsableRate("-5")).toBe(false);
  });

  test("blank is not a rate", () => {
    expect(isUsableRate("")).toBe(false);
    expect(isUsableRate("   ")).toBe(false);
  });
});

describe("the field messages", () => {
  test("the name message is the exact sentence the item asks for", () => {
    expect(rosterFieldMessage("name", { name: "", dailyRate: "120" }, "AED ")).toBe(NAME_REQUIRED_MESSAGE);
    expect(NAME_REQUIRED_MESSAGE).toBe("Enter the worker's name");
  });

  test("the rate message names the org's own currency", () => {
    expect(rateRequiredMessage("AED ")).toBe("Enter a daily rate in AED, e.g. 120");
    expect(rosterFieldMessage("dailyRate", { name: "Ali", dailyRate: "" }, "AED ")).toBe("Enter a daily rate in AED, e.g. 120");
  });

  test("an org whose currency has not resolved gets the sentence WITHOUT a currency, never a guessed one", () => {
    expect(rateRequiredMessage("")).toBe("Enter a daily rate, e.g. 120");
  });

  test("a rate that is present but unusable still produces the message -- present is not the same as valid", () => {
    expect(rosterFieldMessage("dailyRate", { name: "Ali", dailyRate: "abc" }, "AED ")).toBe("Enter a daily rate in AED, e.g. 120");
  });

  test("a field that is fine produces no message", () => {
    expect(rosterFieldMessage("name", { name: "Ali", dailyRate: "120" }, "AED ")).toBeNull();
    expect(rosterFieldMessage("dailyRate", { name: "Ali", dailyRate: "120" }, "AED ")).toBeNull();
  });
});

describe("missingRosterReason -- what the primary button says", () => {
  test("names both fields, in the convention /labour/new already ships", () => {
    expect(missingRosterReason({ name: "", dailyRate: "" })).toBe("Name, Daily Rate");
  });

  test("names only what is actually missing", () => {
    expect(missingRosterReason({ name: "Ali", dailyRate: "" })).toBe("Daily Rate");
  });

  test("a complete form has no reason at all, so the button is plain 'Save'", () => {
    expect(missingRosterReason({ name: "Ali", dailyRate: "120" })).toBeUndefined();
  });
});
