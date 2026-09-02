/// <reference types="bun-types" />
// R67 lane B (B-06 / B-08 / B-10) -- the D-03 dictionary, proved.
//
// These are not decorative assertions. Each one of the three "never" rules
// below is a real string that reached a real user's screen in the R66
// walkthrough, so they are asserted over EVERY code in the dictionary rather
// than over the handful that happen to be interesting today: a code added
// later with a sloppy sentence fails this file, not a customer.
import { describe, expect, test } from "bun:test";
import {
  TASK_ERROR_CODES,
  allMessages,
  isTaskErrorCode,
  messageFor,
  nextStepFor,
  taskErrorFor,
  unknownCodeMessage,
  FIX_PARAMS,
} from "./task-errors";

// A project name that itself contains " - " and a digit, because the real
// demo project is "Cedar Heights Villa - Phase 1" and the template has to
// survive it.
const SAMPLE = { code: "EX-00", project: "Cedar Heights Villa - Phase 1", version: "Rev0" };

const CAMEL_CASE = /[a-z][A-Z]/;
const HOST_PORT = /\d+\.\d+\.\d+\.\d+:\d+/;

describe("B-06/B-08 -- every sentence obeys the three D-03 rules", () => {
  test("no sentence contains a camelCase parameter name", () => {
    for (const { code, message } of allMessages(SAMPLE)) {
      expect(`${code}: ${message}`).not.toMatch(CAMEL_CASE);
    }
  });

  test("no sentence contains a snake_case function id", () => {
    for (const { code, message } of allMessages(SAMPLE)) {
      expect(`${code}: ${message}`.slice(code.length + 2)).not.toContain("_");
    }
  });

  test("no sentence contains a host and port", () => {
    for (const { code, message } of allMessages(SAMPLE)) {
      expect(`${code}: ${message}`).not.toMatch(HOST_PORT);
    }
  });

  test("every code has a non-empty sentence and a next step", () => {
    for (const code of TASK_ERROR_CODES) {
      expect(messageFor(code, SAMPLE).length).toBeGreaterThan(0);
      const step = nextStepFor(code);
      expect(step.label.length).toBeGreaterThan(0);
      if (step.kind === "pick-param") {
        // The Fix button's own label must not smuggle a camelCase parameter
        // in through the back door either.
        expect(FIX_PARAMS).toContain(step.param!);
      }
      if (step.kind === "route") expect(step.route).toBeTruthy();
    }
  });
});

describe("B-06 -- taskErrorFor renders D-03's exact BOQ_LINE_NOT_FOUND sentence", () => {
  test("the acceptance string, character for character", () => {
    expect(
      taskErrorFor({
        code: "BOQ_LINE_NOT_FOUND",
        params: { code: "1", project: "Cedar Heights Villa - Phase 1", version: "Rev0" },
      })
    ).toBe("There is no line 1 on Cedar Heights Villa - Phase 1 Rev0 - pick a line");
  });

  test("an unresolved version leaves no double space behind", () => {
    expect(messageFor("BOQ_LINE_NOT_FOUND", { code: "1", project: "Cedar Heights Villa - Phase 1" })).toBe(
      "There is no line 1 on Cedar Heights Villa - Phase 1 - pick a line"
    );
  });

  test("the server's own context key (itemCode) is read, and never printed", () => {
    const rendered = messageFor("BOQ_LINE_NOT_FOUND", { itemCode: "EX-01", project: "Oakwood", version: "v2" });
    expect(rendered).toBe("There is no line EX-01 on Oakwood v2 - pick a line");
    expect(rendered).not.toContain("itemCode");
  });
});

describe("B-08 -- messageFor renders the same sentence under B-08's own signature", () => {
  test("the acceptance string, character for character", () => {
    expect(messageFor("BOQ_LINE_NOT_FOUND", { code: "1", project: "Cedar Heights Villa - Phase 1", version: "v1" })).toBe(
      "There is no line 1 on Cedar Heights Villa - Phase 1 v1 - pick a line"
    );
  });

  test("BOQ_LINE_IS_PARENT names the line when the server knew it, and the rule when it did not", () => {
    expect(messageFor("BOQ_LINE_IS_PARENT", { code: "EX-00" })).toBe("EX-00 is a parent line - pick one of its child lines");
    expect(messageFor("BOQ_LINE_IS_PARENT", {})).toBe("Progress goes on a child line, not the parent");
  });

  test("an unknown code renders the honest fallback, never a blank row", () => {
    expect(isTaskErrorCode("SOMETHING_NEW")).toBe(false);
    expect(messageFor("SOMETHING_NEW")).toBe("Something went wrong (code SOMETHING_NEW)");
    expect(unknownCodeMessage("X9")).toBe("Something went wrong (code X9)");
    // and it still offers a way forward
    expect(nextStepFor("SOMETHING_NEW").kind).toBe("retry");
  });

  test("null and undefined codes do not throw", () => {
    expect(messageFor(null)).toBe("Something went wrong (code unknown)");
    expect(messageFor(undefined)).toBe("Something went wrong (code unknown)");
  });
});

describe("D-03's five named codes read exactly as the decision words them", () => {
  test("the five sentences", () => {
    expect(messageFor("BOQ_LINE_REQUIRED")).toBe("Pick a BOQ line");
    expect(messageFor("PROJECT_REQUIRED")).toBe("Pick a project");
    expect(messageFor("VALUE_REQUIRED")).toBe("Type quantity or %");
    expect(messageFor("BACKEND_UNAVAILABLE")).toBe(
      "The construction data service didn't answer - nothing was saved [Retry]"
    );
    expect(messageFor("BOQ_LINE_NOT_FOUND", { code: "1", project: "P", version: "v1" })).toBe(
      "There is no line 1 on P v1 - pick a line"
    );
  });
});
