/// <reference types="bun-types" />
// Binding decision D-03. The rule under test is a product rule, not a string
// table: a person is never shown a camelCase parameter name, a function id, a
// SCREAMING_SNAKE code or a host:port -- whatever the pipeline hands back.
import { describe, expect, test } from "bun:test";
import { taskErrorSentence, taskErrorFix, looksLikeCode, missingFieldLabel, TASK_ERROR_MESSAGES } from "./task-errors";

describe("taskErrorSentence", () => {
  test("maps each of D-03's codes to its own sentence, verbatim", () => {
    expect(taskErrorSentence({ code: "BOQ_LINE_REQUIRED" })).toBe("Pick a BOQ line");
    expect(taskErrorSentence({ code: "PROJECT_REQUIRED" })).toBe("Pick a project");
    expect(taskErrorSentence({ code: "VALUE_REQUIRED" })).toBe("Type quantity or %");
    expect(taskErrorSentence({ code: "BACKEND_UNAVAILABLE" })).toBe("The construction data service didn't answer — nothing was saved");
  });

  test("fills a templated code with the real line, project and version", () => {
    expect(taskErrorSentence({ code: "BOQ_LINE_NOT_FOUND", values: { code: "C-01", project: "Cedar Heights", version: "v2" } }))
      .toBe("There is no line C-01 on Cedar Heights v2 — pick a line");
  });

  test("a template with nothing to fill still reads as words, never as {placeholders}", () => {
    const sentence = taskErrorSentence({ code: "BOQ_LINE_NOT_FOUND" });
    expect(sentence).not.toContain("{");
    expect(sentence).toContain("pick a line");
  });

  test("prefers the backend's OWN sentence when it wrote one", () => {
    expect(taskErrorSentence({ message: "Construction is not enabled for this organisation" }))
      .toBe("Construction is not enabled for this organisation");
  });

  test("a bare string that IS a sentence is passed through; a bare string that is a CODE is mapped", () => {
    expect(taskErrorSentence("The report timed out")).toBe("The report timed out");
    expect(taskErrorSentence("PROJECT_REQUIRED")).toBe("Pick a project");
  });

  test("NEVER shows a camelCase parameter name -- the missing fields become words", () => {
    expect(taskErrorSentence({ code: "NEEDS_INPUT", missing: ["projectId"] })).toBe("This needs a project first");
    expect(taskErrorSentence({ code: "NEEDS_INPUT", missing: ["projectId", "boqLineItemId", "quantity"] }))
      .toBe("This needs a project, a BOQ line and a quantity first");
  });

  test("an unknown field is described, not printed", () => {
    expect(taskErrorSentence({ code: "NEEDS_INPUT", missing: ["someInternalRef"] })).toBe("This needs a value first");
    expect(missingFieldLabel("someInternalRef")).toBe("a value");
  });

  test("an unknown code with nothing else is the fallback sentence -- never the token itself", () => {
    const sentence = taskErrorSentence({ code: "SOME_NEW_CODE" });
    expect(sentence).toBe("That didn't run — nothing was saved");
    expect(sentence).not.toContain("SOME_NEW_CODE");
  });

  test("a message that is really a host:port or a function id is refused as a sentence", () => {
    expect(taskErrorSentence({ message: "connect ECONNREFUSED http://localhost:3000/api" })).toBe("That didn't run — nothing was saved");
    expect(taskErrorSentence({ message: "construction.record_work_progress" })).toBe("That didn't run — nothing was saved");
  });

  test("null, undefined and an empty payload all produce a sentence, never an empty string", () => {
    expect(taskErrorSentence(null)).not.toBe("");
    expect(taskErrorSentence(undefined)).not.toBe("");
    expect(taskErrorSentence({})).not.toBe("");
  });

  test("the caller may supply its own fallback for its own screen", () => {
    expect(taskErrorSentence(null, "Could not run this report")).toBe("Could not run this report");
  });
});

describe("looksLikeCode", () => {
  test("recognises SCREAMING_SNAKE, function ids and host:port; leaves real sentences alone", () => {
    expect(looksLikeCode("BOQ_LINE_REQUIRED")).toBe(true);
    expect(looksLikeCode("construction.record_work_progress")).toBe(true);
    expect(looksLikeCode("failed at 127.0.0.1:5432")).toBe(true);
    expect(looksLikeCode("Construction is not enabled for this organisation")).toBe(false);
    expect(looksLikeCode("")).toBe(false);
  });
});

describe("taskErrorFix", () => {
  test("names the next action for a code that has one, and nothing for one that does not", () => {
    expect(taskErrorFix("BOQ_LINE_REQUIRED")).toBe("Open the BOQ");
    expect(taskErrorFix({ code: "BACKEND_UNAVAILABLE" })).toBe("Retry");
    expect(taskErrorFix({ code: "SOME_NEW_CODE" })).toBeNull();
    expect(taskErrorFix(null)).toBeNull();
  });
});

describe("the dictionary itself", () => {
  test("every message is a sentence, not a token", () => {
    for (const [code, message] of Object.entries(TASK_ERROR_MESSAGES)) {
      expect(message.length, code).toBeGreaterThan(8);
      expect(looksLikeCode(message), code).toBe(false);
    }
  });
});
