import { describe, expect, test } from "bun:test";
import {
  TASK_ERROR_CODES,
  TASK_ERROR_DICTIONARY,
  asTaskErrorCode,
  inferTaskErrorCode,
  maskTechnical,
  resolveTaskError,
} from "./task-errors";

// The four shapes a real captured row took in the R66 walkthrough. Kept
// verbatim so a regression is measured against the actual defect, not a
// paraphrase of it.
const REAL_ROWS = {
  connectTimeout: "write CONNECT_TIMEOUT 3.109.171.244:6543",
  itemCodeRequired: "itemCode is required",
  itemNotFound: 'item code "01" not found in this project\'s BOQ',
  noProject: "no project resolved for this task",
};

const IPV4_PORT = /\d+\.\d+\.\d+\.\d+:\d+/;

describe("D-03: the closed vocabulary", () => {
  test("every code has a sentence, a verb label and an action", () => {
    for (const code of TASK_ERROR_CODES) {
      const entry = TASK_ERROR_DICTIONARY[code];
      expect(entry.code).toBe(code);
      expect(entry.template.length).toBeGreaterThan(0);
      expect(entry.verbLabel.length).toBeGreaterThan(0);
      expect(["fix", "retry", "open"]).toContain(entry.action);
    }
  });

  test("D-03's sentences are used verbatim", () => {
    expect(resolveTaskError({ code: "BOQ_LINE_REQUIRED" }).sentence).toBe("Pick a BOQ line");
    expect(resolveTaskError({ code: "PROJECT_REQUIRED" }).sentence).toBe("Pick a project");
    expect(resolveTaskError({ code: "VALUE_REQUIRED" }).sentence).toBe("Type quantity or %");
    expect(resolveTaskError({ code: "BACKEND_UNAVAILABLE" }).sentence).toBe(
      "The construction data service didn't answer — nothing was saved"
    );
  });

  test("the verb label is a word the user can act on, never an icon or a code", () => {
    expect(resolveTaskError({ code: "BOQ_LINE_REQUIRED" }).verbLabel).toBe("Pick line");
    expect(resolveTaskError({ code: "PROJECT_REQUIRED" }).verbLabel).toBe("Choose project");
    expect(resolveTaskError({ code: "VALUE_REQUIRED" }).verbLabel).toBe("Type value");
    expect(resolveTaskError({ code: "BACKEND_UNAVAILABLE" }).verbLabel).toBe("Retry");
  });

  test("a missing-slot failure offers Fix, a transport failure offers Retry", () => {
    expect(resolveTaskError({ code: "BOQ_LINE_REQUIRED" }).action).toBe("fix");
    expect(resolveTaskError({ code: "VALUE_REQUIRED" }).action).toBe("fix");
    expect(resolveTaskError({ code: "BACKEND_UNAVAILABLE" }).action).toBe("retry");
    expect(resolveTaskError({ code: "UNKNOWN" }).action).toBe("retry");
  });
});

describe("the templated sentence degrades a clause at a time", () => {
  test("with every fact, it reads as D-03 wrote it", () => {
    expect(
      resolveTaskError({
        code: "BOQ_LINE_NOT_FOUND",
        itemCode: "1.02",
        projectName: "Cedar Heights Villa - Phase 1",
        boqVersion: "v3",
      }).sentence
    ).toBe("There is no line 1.02 on Cedar Heights Villa - Phase 1 v3 — pick a line");
  });

  test("a missing fact is dropped, never printed as a placeholder", () => {
    const noProject = resolveTaskError({ code: "BOQ_LINE_NOT_FOUND", itemCode: "1.02" }).sentence;
    expect(noProject).toBe("There is no line 1.02 on this BOQ — pick a line");
    expect(noProject).not.toContain("{");

    const nothing = resolveTaskError({ code: "BOQ_LINE_NOT_FOUND" }).sentence;
    expect(nothing).toBe("That line is not on this BOQ — pick a line");
    expect(nothing).not.toContain("{");
    // Whatever is dropped, the instruction survives.
    expect(nothing).toContain("pick a line");
  });
});

describe("maskTechnical is the last line of defence", () => {
  test("the real captured row loses its IP, its port and its transport code", () => {
    const masked = maskTechnical(REAL_ROWS.connectTimeout);
    expect(masked).toBe("write service unavailable");
    expect(masked).not.toMatch(IPV4_PORT);
    expect(masked).not.toContain("CONNECT_TIMEOUT");
  });

  test("a hostname with a port is masked too", () => {
    expect(maskTechnical("connect ECONNREFUSED db.pcrjmlpuqsbocqfwoxod.supabase.co:5432")).toBe(
      "connect service unavailable"
    );
    expect(maskTechnical("fetch failed to localhost:3100")).toBe("fetch failed to service unavailable");
  });

  test("a safe sentence survives unchanged", () => {
    expect(maskTechnical("Pick a BOQ line")).toBe("Pick a BOQ line");
    expect(maskTechnical("There is no line 1.02 on Cedar Heights Villa - Phase 1 v3 — pick a line")).toBe(
      "There is no line 1.02 on Cedar Heights Villa - Phase 1 v3 — pick a line"
    );
  });

  test("it never throws and never blanks the string", () => {
    expect(maskTechnical("")).toBe("");
    expect(maskTechnical("   ")).toBe("");
  });
});

describe("a legacy pipeline_tasks.error string is translated, never shown", () => {
  test("each real captured row maps to its D-03 code", () => {
    expect(inferTaskErrorCode(REAL_ROWS.itemCodeRequired)).toBe("BOQ_LINE_REQUIRED");
    expect(inferTaskErrorCode(REAL_ROWS.itemNotFound)).toBe("BOQ_LINE_NOT_FOUND");
    expect(inferTaskErrorCode(REAL_ROWS.noProject)).toBe("PROJECT_REQUIRED");
    expect(inferTaskErrorCode(REAL_ROWS.connectTimeout)).toBe("BACKEND_UNAVAILABLE");
    expect(inferTaskErrorCode("percent is required")).toBe("VALUE_REQUIRED");
  });

  test("the executor's own no-BOQ and validate()'s own wordings are covered", () => {
    expect(inferTaskErrorCode('no BOQ found for project "abc"')).toBe("BOQ_LINE_NOT_FOUND");
    expect(inferTaskErrorCode('boq_line_item_id "x" does not exist in this BOQ')).toBe("BOQ_LINE_NOT_FOUND");
    expect(inferTaskErrorCode("percent must be a number between 0 and 100, got null")).toBe("VALUE_REQUIRED");
  });

  test("an unrecognised string is UNKNOWN, and the user still gets a way out", () => {
    expect(inferTaskErrorCode("something nobody has ever written before")).toBeNull();
    const resolved = resolveTaskError({ raw: "something nobody has ever written before" });
    expect(resolved.code).toBe("UNKNOWN");
    expect(resolved.sentence).toBe("Something went wrong");
    expect(resolved.verbLabel).toBe("Retry");
  });

  test("no legacy string ever reaches the sentence", () => {
    for (const raw of Object.values(REAL_ROWS)) {
      const resolved = resolveTaskError({ raw });
      expect(resolved.sentence).not.toContain("itemCode");
      expect(resolved.sentence).not.toContain("_");
      expect(resolved.sentence).not.toMatch(IPV4_PORT);
    }
  });

  test("empty and missing input do not infer a code", () => {
    expect(inferTaskErrorCode(null)).toBeNull();
    expect(inferTaskErrorCode(undefined)).toBeNull();
    expect(inferTaskErrorCode("   ")).toBeNull();
  });
});

describe("resolution order", () => {
  test("an explicit server code beats everything else", () => {
    const r = resolveTaskError({ code: "VALUE_REQUIRED", missing: ["itemCode"], raw: REAL_ROWS.connectTimeout });
    expect(r.code).toBe("VALUE_REQUIRED");
    expect(r.inferred).toBe(false);
  });

  test("the first missing field names the code when no code was sent", () => {
    expect(resolveTaskError({ missing: ["itemCode"] }).code).toBe("BOQ_LINE_REQUIRED");
    expect(resolveTaskError({ missing: ["boqLineItemId"] }).code).toBe("BOQ_LINE_REQUIRED");
    expect(resolveTaskError({ missing: ["projectId"] }).code).toBe("PROJECT_REQUIRED");
    expect(resolveTaskError({ missing: ["percent"] }).code).toBe("VALUE_REQUIRED");
    expect(resolveTaskError({ missing: ["hours"] }).code).toBe("VALUE_REQUIRED");
  });

  test("the legacy string is only consulted last", () => {
    const r = resolveTaskError({ missing: ["percent"], raw: REAL_ROWS.itemCodeRequired });
    expect(r.code).toBe("VALUE_REQUIRED");
    expect(r.inferred).toBe(true);
  });

  test("an unknown code string from the server is not trusted into the union", () => {
    expect(asTaskErrorCode("NOT_A_REAL_CODE")).toBeNull();
    expect(asTaskErrorCode(42)).toBeNull();
    expect(asTaskErrorCode("BOQ_LINE_REQUIRED")).toBe("BOQ_LINE_REQUIRED");
    expect(resolveTaskError({ code: "NOT_A_REAL_CODE" }).code).toBe("UNKNOWN");
  });
});

// ---------------------------------------------------------------------------
// R67 C-13 -- the two codes VERIDIAN emits that had no sentence here.
// ---------------------------------------------------------------------------

describe("the timesheet slot and the unregistered function now have words", () => {
  test("a missing task asks for a task, not 'something went wrong'", () => {
    const r = resolveTaskError({ code: "TASK_REQUIRED" });
    expect(r.sentence).toBe("Pick a task");
    expect(r.verbLabel).toBe("Pick task");
    expect(r.action).toBe("fix");
    expect(r.missingStep).toBe("task");
  });

  test("the executor's own ambiguous-match wording resolves to it too", () => {
    expect(resolveTaskError({ raw: `"joinery" matches 2 tasks on this project -- name one of them` }).code).toBe(
      "TASK_REQUIRED"
    );
    expect(resolveTaskError({ raw: `no task on this project matches "joinery"` }).code).toBe("TASK_REQUIRED");
  });

  test("a missing `task` slot maps to it as well", () => {
    expect(resolveTaskError({ missing: ["task"] }).code).toBe("TASK_REQUIRED");
    expect(resolveTaskError({ missing: ["issueId"] }).code).toBe("TASK_REQUIRED");
  });

  test("an unregistered function is a gap with a way out, NOT a Retry", () => {
    const r = resolveTaskError({ code: "FUNCTION_NOT_AVAILABLE" });
    expect(r.sentence).toBe("PROJEXA can't do that from the composer yet");
    expect(r.action).toBe("open");
    // Retrying something that is not registered fails in exactly the same way.
    expect(r.action).not.toBe("retry");
  });

  test("the pipeline's own no-executor wording resolves to it", () => {
    expect(
      resolveTaskError({ raw: `no executor is registered for function_id "approve_variation" yet` }).code
    ).toBe("FUNCTION_NOT_AVAILABLE");
  });

  test("neither new sentence carries a function id, a parameter or an IP", () => {
    for (const code of ["TASK_REQUIRED", "FUNCTION_NOT_AVAILABLE"] as const) {
      const s = resolveTaskError({ code }).sentence;
      expect(s).not.toMatch(/_/);
      expect(s).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    }
  });

  test("INFRA_UNAVAILABLE, the code C-13's migration backfills, is still one sentence", () => {
    expect(resolveTaskError({ code: "INFRA_UNAVAILABLE" }).code).toBe("BACKEND_UNAVAILABLE");
    expect(resolveTaskError({ code: "INFRA_UNAVAILABLE" }).sentence).toBe(
      "The construction data service didn't answer — nothing was saved"
    );
  });
});
