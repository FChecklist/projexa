/// <reference types="bun-types" />
// R67 D-03 -- the Task Master error dictionary. Two things are being asserted:
// the five closed-vocabulary sentences decision D-03 names, and the rule that a
// camelCase parameter name, a function id or a host:port can never reach a
// screen through this file.
import { describe, expect, test } from "bun:test";
import {
  TASK_ERROR_CODES,
  describeTaskError,
  missingFieldLabels,
  sanitiseBackendMessage,
  taskRowDetail,
} from "./task-errors";

describe("the vocabulary stays closed", () => {
  test("it is exactly the five codes decision D-03 names", () => {
    expect([...TASK_ERROR_CODES].sort()).toEqual([
      "BACKEND_UNAVAILABLE",
      "BOQ_LINE_NOT_FOUND",
      "BOQ_LINE_REQUIRED",
      "PROJECT_REQUIRED",
      "VALUE_REQUIRED",
    ]);
  });

  test("each code renders its own sentence, verbatim", () => {
    expect(describeTaskError({ code: "PROJECT_REQUIRED" })?.sentence).toBe("Pick a project");
    expect(describeTaskError({ code: "BOQ_LINE_REQUIRED" })?.sentence).toBe("Pick a BOQ line");
    expect(describeTaskError({ code: "VALUE_REQUIRED" })?.sentence).toBe("Type quantity or %");
    expect(describeTaskError({ code: "BACKEND_UNAVAILABLE" })?.sentence).toBe(
      "The construction data service didn't answer — nothing was saved"
    );
  });

  test("BOQ_LINE_NOT_FOUND names the line, the project and the BOQ version", () => {
    expect(
      describeTaskError({
        code: "BOQ_LINE_NOT_FOUND",
        errorContext: { lineCode: "1.01", boqVersion: 2 },
        projectName: "Cedar Heights Villa",
      })?.sentence
    ).toBe("There is no line 1.01 on Cedar Heights Villa v2 — pick a line");
  });

  test("BOQ_LINE_NOT_FOUND still says something useful without the context", () => {
    expect(describeTaskError({ code: "BOQ_LINE_NOT_FOUND" })?.sentence).toBe(
      "That BOQ line is not on this project's BOQ — pick a line"
    );
    expect(describeTaskError({ code: "BOQ_LINE_NOT_FOUND", errorContext: { lineCode: "3.4" } })?.sentence).toBe(
      "There is no line 3.4 on this project's BOQ — pick a line"
    );
  });

  test("every code carries a Fix chain, or offers Retry instead", () => {
    expect(describeTaskError({ code: "PROJECT_REQUIRED" })?.fix).toEqual(["Projects"]);
    expect(describeTaskError({ code: "BOQ_LINE_REQUIRED" })?.fix).toEqual(["Scope", "BOQ lines"]);
    expect(describeTaskError({ code: "VALUE_REQUIRED" })?.fix).toEqual(["Work Progress"]);
    const unavailable = describeTaskError({ code: "BACKEND_UNAVAILABLE" });
    expect(unavailable?.fix).toEqual([]);
    expect(unavailable?.retryable).toBe(true);
  });
});

describe("the missing fields are named in words the user reads", () => {
  test("known parameters become their visible label", () => {
    expect(missingFieldLabels(["projectId", "itemCode", "percent"])).toEqual([
      "project",
      "BOQ line",
      "quantity or %",
    ]);
  });

  test("an unknown parameter key is DROPPED, never printed", () => {
    expect(missingFieldLabels(["activityId", "someNewParam"])).toEqual([]);
    expect(describeTaskError({ code: "PROJECT_REQUIRED", missing: ["someNewParam"] })?.missingLabels).toEqual([]);
  });

  test("no missing list at all is not an error", () => {
    expect(missingFieldLabels(null)).toEqual([]);
    expect(missingFieldLabels(undefined)).toEqual([]);
  });
});

describe("sanitiseBackendMessage -- what may never reach a screen", () => {
  test("an internal IP:port is replaced, not patched (the R66 live leak)", () => {
    expect(sanitiseBackendMessage("write CONNECT_TIMEOUT 3.109.171.244:6543")).toBe(
      "That didn't run. Nothing was saved."
    );
  });

  test("a camelCase parameter name is replaced", () => {
    expect(sanitiseBackendMessage("itemCode is required")).toBe("That didn't run. Nothing was saved.");
  });

  test("a quoted function id is replaced", () => {
    expect(sanitiseBackendMessage('no executor is registered for function_id "list_leads" yet')).toBe(
      "That didn't run. Nothing was saved."
    );
  });

  test("a URL is replaced", () => {
    expect(sanitiseBackendMessage("failed calling https://veridian.example/api/v1/projexa/tasks")).toBe(
      "That didn't run. Nothing was saved."
    );
  });

  test("real human prose written in this project is kept, because it is what the user can act on", () => {
    expect(sanitiseBackendMessage(`no BOQ found for this project`)).toBe("no BOQ found for this project");
    expect(
      sanitiseBackendMessage("read as a question, so it was not run -- say it as an instruction to record it")
    ).toBe("read as a question, so it was not run -- say it as an instruction to record it");
  });

  test("an empty message still says something", () => {
    expect(sanitiseBackendMessage("")).toBe("That didn't run. Nothing was saved.");
    expect(sanitiseBackendMessage(null)).toBe("That didn't run. Nothing was saved.");
  });
});

describe("taskRowDetail -- the line a Task Master row actually shows", () => {
  test("a coded failure shows the dictionary's sentence, not the server's", () => {
    expect(
      taskRowDetail({ code: "BOQ_LINE_REQUIRED", error: "itemCode is required" }, "record 40% on 1.01")
    ).toBe("Pick a BOQ line");
  });

  test("a retryable failure carries the Retry affordance in the line", () => {
    expect(taskRowDetail({ code: "BACKEND_UNAVAILABLE" }, null)).toBe(
      "The construction data service didn't answer — nothing was saved [Retry]"
    );
  });

  test("an uncoded failure with an unsafe message never leaks it", () => {
    expect(taskRowDetail({ error: "write CONNECT_TIMEOUT 3.109.171.244:6543" }, "record progress")).toBe(
      "That didn't run. Nothing was saved. [Retry]"
    );
  });

  test("a healthy row falls back to what the user typed", () => {
    expect(taskRowDetail({}, "record 40% on 1.01")).toBe("record 40% on 1.01");
    expect(taskRowDetail({}, null)).toBeUndefined();
  });
});
