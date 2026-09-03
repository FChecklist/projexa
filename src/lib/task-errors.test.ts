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
  taskErrorSentence,
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

// ── R67 B-10: rows written before the pipeline returned codes ─────────────
import { LEGACY_FALLBACK_MESSAGE, legacyToCode } from "./task-errors";

describe("B-10 -- legacyToCode maps the strings the R66 walkthrough photographed", () => {
  test("the acceptance mapping", () => {
    expect(legacyToCode("itemCode is required")).toBe("BOQ_LINE_REQUIRED");
  });

  test("a driver message never renders as itself", () => {
    for (const raw of [
      "write CONNECT_TIMEOUT 3.109.171.244:6543",
      "connect ECONNREFUSED 127.0.0.1:5432",
      "getaddrinfo ENOTFOUND db.example.supabase.co",
    ]) {
      const code = legacyToCode(raw);
      expect(code).toBe("BACKEND_UNAVAILABLE");
      const rendered = messageFor(code!);
      expect(rendered).not.toMatch(HOST_PORT);
      expect(rendered).toBe("The construction data service didn't answer - nothing was saved [Retry]");
    }
  });

  test("the other three real R66 strings", () => {
    expect(legacyToCode("no project resolved for this task")).toBe("PROJECT_REQUIRED");
    expect(legacyToCode('item code "1" not found in this project\'s BOQ')).toBe("BOQ_LINE_NOT_FOUND");
    expect(legacyToCode("Progress cannot be recorded directly against a parent BOQ line item")).toBe(
      "BOQ_LINE_IS_PARENT"
    );
  });

  test("a statement timeout is told apart from a connection failure", () => {
    expect(legacyToCode("canceling statement due to statement timeout")).toBe("UPSTREAM_TIMEOUT");
  });

  test("anything unmatched falls back without leaking the original text", () => {
    expect(legacyToCode("something nobody anticipated")).toBeNull();
    expect(legacyToCode("")).toBeNull();
    expect(legacyToCode(null)).toBeNull();
    expect(LEGACY_FALLBACK_MESSAGE).toBe("This task needs your input - [Fix]");
    expect(LEGACY_FALLBACK_MESSAGE).not.toMatch(CAMEL_CASE);
  });
});

// ── R67 B-10: the Fix chain, and the row's own affordance ─────────────────
import { fixChainFor, rowDetailFor } from "./task-errors";

describe("B-10 -- a sentence that names the problem also carries the way out", () => {
  test("BOQ_LINE_REQUIRED loads the work-progress record chain, stopped at the line", () => {
    expect(fixChainFor("BOQ_LINE_REQUIRED")).toEqual({
      module: "work-progress",
      verb: "record",
      missing: "boqLine",
      route: "/work-progress",
    });
  });

  test("every pickable code has a chain; nothing pickable is left without one", () => {
    for (const code of TASK_ERROR_CODES) {
      const step = nextStepFor(code);
      if (step.kind === "pick-param") expect(fixChainFor(code)).not.toBeNull();
    }
  });

  test("a transport failure has no chain -- there is nothing to pick, only Retry", () => {
    expect(fixChainFor("BACKEND_UNAVAILABLE")).toBeNull();
    expect(fixChainFor("UPSTREAM_TIMEOUT")).toBeNull();
    expect(fixChainFor("SOMETHING_NEW")).toBeNull();
  });

  test("the row shows the sentence AND a word-button", () => {
    expect(rowDetailFor("BOQ_LINE_REQUIRED")).toBe("Pick a BOQ line [Fix]");
    expect(rowDetailFor("PROJECT_REQUIRED")).toBe("Pick a project [Fix]");
    expect(rowDetailFor("BOQ_LINE_NOT_FOUND", { code: "1", project: "Cedar Heights Villa - Phase 1", version: "Rev0" })).toBe(
      "There is no line 1 on Cedar Heights Villa - Phase 1 Rev0 - pick a line [Fix]"
    );
  });

  test("a retry sentence is not given a second button -- it already carries [Retry]", () => {
    expect(rowDetailFor("BACKEND_UNAVAILABLE")).toBe(
      "The construction data service didn't answer - nothing was saved [Retry]"
    );
    expect(rowDetailFor("BACKEND_UNAVAILABLE")).not.toContain("[Fix]");
  });

  test("no row detail can ever print a parameter, an id or an address", () => {
    for (const code of TASK_ERROR_CODES) {
      const detail = rowDetailFor(code, SAMPLE);
      expect(detail).not.toMatch(CAMEL_CASE);
      expect(detail).not.toMatch(HOST_PORT);
      expect(detail).not.toContain("_");
    }
    // and the same holds for the R66 rows that started all of this
    expect(rowDetailFor(legacyToCode("write CONNECT_TIMEOUT 3.109.171.244:6543"))).not.toMatch(HOST_PORT);
    expect(rowDetailFor(legacyToCode("itemCode is required"))).toBe("Pick a BOQ line [Fix]");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R67 FIX PASS
// ═══════════════════════════════════════════════════════════════════════════
describe("FIX PASS -- BOQ_LINE_NOT_FOUND reads correctly for EVERY context shape", () => {
  // The executor builds its context as {itemCode, version} and, before the
  // fix, supplied no project at all -- so the same code that reads correctly
  // from validate() rendered "There is no line EX-01 on - pick a line", and
  // with a BOQ present "There is no line EX-01 on 1 - pick a line", with a
  // bare version number standing where the project's name belongs.
  test("all three present: the full D-03 sentence", () => {
    expect(messageFor("BOQ_LINE_NOT_FOUND", { code: "1", project: "Cedar Heights Villa - Phase 1", version: "v2" })).toBe(
      "There is no line 1 on Cedar Heights Villa - Phase 1 v2 - pick a line"
    );
  });

  test("VERSION ONLY: the clause carries the version alone, with no dangling 'on'", () => {
    expect(messageFor("BOQ_LINE_NOT_FOUND", { itemCode: "EX-01", version: "v2" })).toBe(
      "There is no line EX-01 on v2 - pick a line"
    );
  });

  test("NEITHER: the clause disappears entirely rather than leaving a hole", () => {
    expect(messageFor("BOQ_LINE_NOT_FOUND", { itemCode: "EX-01", version: null })).toBe("There is no line EX-01 - pick a line");
    expect(messageFor("BOQ_LINE_NOT_FOUND", { itemCode: "EX-01" })).toBe("There is no line EX-01 - pick a line");
  });

  test("the row detail is equally clean -- the regression the reviewer reproduced", () => {
    expect(rowDetailFor("BOQ_LINE_NOT_FOUND", { itemCode: "EX-01", version: null })).toBe(
      "There is no line EX-01 - pick a line [Fix]"
    );
    // No " on " left with nothing after it, ever.
    for (const params of [{}, { itemCode: "EX-01" }, { project: "Oakwood" }, { version: "v3" }]) {
      expect(messageFor("BOQ_LINE_NOT_FOUND", params)).not.toMatch(/ on\s*-/);
      expect(messageFor("BOQ_LINE_NOT_FOUND", params)).not.toMatch(/ on\s*$/);
    }
  });
});

describe("FIX PASS -- a service's own 4xx has a true sentence, not a Retry", () => {
  test("a duplicate attendance names what is already there", () => {
    expect(messageFor("ALREADY_RECORDED", { functionId: "record_attendance" })).toBe(
      "Attendance is already recorded for that worker on that date"
    );
  });

  test("the same code for a BOQ revision says the true thing for THAT write", () => {
    expect(messageFor("ALREADY_RECORDED", { functionId: "create_boq_revision" })).toBe(
      "That BOQ has already been revised - open the latest revision"
    );
  });

  test("an unrecognised write still gets an honest sentence, and never prints the function id", () => {
    const rendered = messageFor("ALREADY_RECORDED", { functionId: "some_future_write" });
    expect(rendered).toBe("That is already recorded - nothing new was saved");
    expect(rendered).not.toContain("some_future_write");
    expect(rendered).not.toContain("_");
  });

  test("RECORD_NOT_FOUND and REQUEST_REJECTED read as statements about the request", () => {
    expect(messageFor("RECORD_NOT_FOUND")).toBe("That record is not on this project - pick another");
    expect(messageFor("REQUEST_REJECTED")).toBe("That was not accepted as entered - check the values and try again");
  });

  test("none of the three offers a Retry -- resending a 4xx cannot change it", () => {
    for (const code of ["RECORD_NOT_FOUND", "ALREADY_RECORDED", "REQUEST_REJECTED"] as const) {
      expect(nextStepFor(code).kind).not.toBe("retry");
      expect(messageFor(code, SAMPLE)).not.toContain("[Retry]");
      // And each still offers somewhere to go.
      expect(rowDetailFor(code)).toMatch(/\[.+\]/);
    }
  });
});

describe("FIX PASS -- two legacy patterns that claimed the wrong strings", () => {
  test("'no construction activity exists yet ... create one first' no longer offers a picker that leads nowhere", () => {
    const stored = 'no construction activity exists yet for project "Cedar Heights Villa" -- create one before recording progress';
    // It falls through to the honest fallback rather than "Pick an activity".
    expect(legacyToCode(stored)).toBeNull();
  });

  test("but a genuine missing-activity string still maps", () => {
    expect(legacyToCode("activityId is required")).toBe("ACTIVITY_REQUIRED");
    expect(legacyToCode("activity is required")).toBe("ACTIVITY_REQUIRED");
  });

  test("the percent/quantity pattern no longer claims any string containing the words", () => {
    // Before: this matched /percent|quantity/i and rendered "Type quantity or
    // %", ahead of the date pattern that was actually true.
    expect(legacyToCode("percentComplete recorded, but entryDate is required")).toBe("DATE_REQUIRED");
    expect(legacyToCode("quantityDone must be a number")).toBeNull();
  });

  test("the required-shape it exists for still maps", () => {
    expect(legacyToCode("percent is required")).toBe("VALUE_REQUIRED");
    expect(legacyToCode("percentComplete is required")).toBe("VALUE_REQUIRED");
    expect(legacyToCode("quantityDone is required")).toBe("VALUE_REQUIRED");
  });

  test("an unmapped legacy string still gets a way forward", () => {
    expect(LEGACY_FALLBACK_MESSAGE).toBe("This task needs your input - [Fix]");
  });
});

// ---------------------------------------------------------------------------
// R67 E-10 (R-129/R-133/R-137). What a SCREEN does with the single string it
// actually holds when a run fails -- an Error's message, which may be a code,
// a usable backend sentence, or something that must never reach a person.
// Merged into this file rather than a second dictionary, per item D-65.
// ---------------------------------------------------------------------------
describe("taskErrorSentence -- the one string a failed screen has in its hand", () => {
  test("a real code becomes the dictionary's sentence, not the code", () => {
    expect(taskErrorSentence("PROJECT_REQUIRED")).toBe(messageFor("PROJECT_REQUIRED"));
    expect(taskErrorSentence("PROJECT_REQUIRED")).not.toContain("PROJECT_REQUIRED");
  });

  test("a safe backend sentence is shown as-is -- it is the most specific thing known about this run", () => {
    expect(taskErrorSentence("The BOQ has no approved revision.")).toBe("The BOQ has no approved revision.");
  });

  test("an address, a port or a camelCase field never reaches the reader -- the caller's fallback does", () => {
    const fallback = "Could not run Project Status";
    expect(taskErrorSentence("write CONNECT_TIMEOUT 3.109.171.244:6543", fallback)).toBe(fallback);
    expect(taskErrorSentence("itemCode is required", fallback)).toBe(fallback);
    expect(taskErrorSentence("https://internal.example/boom", fallback)).toBe(fallback);
  });

  test("nothing at all falls back to the caller's own sentence, never an empty string", () => {
    const fallback = "Could not run Project Status";
    expect(taskErrorSentence(null, fallback)).toBe(fallback);
    expect(taskErrorSentence("   ", fallback)).toBe(fallback);
  });

  test("with no fallback offered it still says something a person can read", () => {
    expect(taskErrorSentence(null)).toBe("That didn't run. Nothing was saved.");
  });
});
