import { describe, expect, test } from "bun:test";
import {
  FIX_PARAMS,
  LEGACY_FALLBACK_MESSAGE,
  TASK_ERROR_CODES,
  TASK_ERROR_DICTIONARY,
  allMessages,
  asTaskErrorCode,
  fixChainFor,
  inferTaskErrorCode,
  isTaskErrorCode,
  legacyToCode,
  maskTechnical,
  messageFor,
  nextStepFor,
  resolveTaskError,
  rowDetailFor,
  taskErrorFor,
  unknownCodeMessage,
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
const CAMEL_CASE = /[a-z][A-Z]/;
const HOST_PORT = /\d+\.\d+\.\d+\.\d+:\d+/;
const SAMPLE = { code: "EX-00", project: "Cedar Heights Villa - Phase 1", version: "Rev0", functionId: "some_future_write" };

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

  test("R67 C-16: the worker sentence the item names, with the picker C-08 shipped", () => {
    expect(resolveTaskError({ code: "WORKER_REQUIRED" }).sentence).toBe("Pick a worker");
    expect(resolveTaskError({ code: "WORKER_REQUIRED" }).verbLabel).toBe("Pick worker");
    expect(resolveTaskError({ code: "WORKER_REQUIRED" }).action).toBe("fix");
    expect(resolveTaskError({ code: "WORKER_REQUIRED" }).missingStep).toBe("worker");
  });

  test("every missingStep in the dictionary is a step something can answer", () => {
    // The union is exported (task-errors.ts's MissingStep) precisely so a new
    // code cannot introduce a step chain-walk.ts has never heard of.
    const steps = new Set(["boqLine", "project", "value", "task", "worker"]);
    for (const code of TASK_ERROR_CODES) {
      const step = TASK_ERROR_DICTIONARY[code].missingStep;
      if (step !== null) expect(steps.has(step)).toBe(true);
    }
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

  // *** FIX PASS REGRESSION 1: A FOUR-SEGMENT BOQ CODE IS NOT AN IP ADDRESS. ***
  test("a four-segment BOQ item code survives untouched", () => {
    expect(maskTechnical("record 50% on 1.01.1.2")).toBe("record 50% on 1.01.1.2");
    expect(maskTechnical("1.01.1.a is a parent line")).toBe("1.01.1.a is a parent line");
    // Still masked: an address WITH a port is what the captured defect was.
    expect(maskTechnical("write to 1.2.3.4:5432")).toBe("write to service unavailable");
  });

  test("the same code survives the BOQ_LINE_NOT_FOUND sentence it is the subject of", () => {
    const resolved = resolveTaskError({
      code: "BOQ_LINE_NOT_FOUND",
      itemCode: "1.01.1.2",
      projectName: "Cedar Heights",
    });
    expect(resolved.sentence).toContain("1.01.1.2");
    expect(resolved.sentence).not.toContain("service unavailable");
  });

  // *** FIX PASS REGRESSION 2: THE COLLAPSE MUST NOT EAT THE SEPARATOR. ***
  test("collapsing a stutter keeps the separator that followed it", () => {
    expect(maskTechnical("write CONNECT_TIMEOUT 3.109.171.244:6543 while saving")).toBe(
      "write service unavailable while saving"
    );
    expect(maskTechnical("record 50% on 1.01.1.2 today")).toBe("record 50% on 1.01.1.2 today");
    // A genuine repeat still collapses to one.
    expect(maskTechnical("1.2.3.4:5432 1.2.3.4:5432 then done")).toBe("service unavailable then done");
    // Nothing may end up glued to a word.
    expect(maskTechnical("write CONNECT_TIMEOUT 1.2.3.4:5432 while saving")).not.toMatch(
      /\w(?:service unavailable)|(?:service unavailable)\w/
    );
  });
});

// *** FIX PASS REGRESSION 3: AN HTTP STATUS NEEDS AN HTTP CONTEXT. ***
describe("a three-digit number is not an outage unless it is wearing a status", () => {
  test("a BOQ line numbered 502/503/504 keeps its own meaning", () => {
    expect(inferTaskErrorCode("there is no line 503 on Cedar Heights")).toBeNull();
    expect(inferTaskErrorCode("record 50% on line 504")).toBeNull();
    expect(inferTaskErrorCode(`item code "502" not found in this project's BOQ`)).toBe("BOQ_LINE_NOT_FOUND");
  });

  test("a real 5xx still reads as one, in every shape this stack produces", () => {
    for (const raw of ["HTTP 503 from upstream", "status 502", "502 Bad Gateway", "504 gateway timeout"]) {
      expect(inferTaskErrorCode(raw)).toBe("BACKEND_UNAVAILABLE");
    }
  });

  test("the named transport codes are unaffected -- they never needed the number", () => {
    expect(inferTaskErrorCode("write CONNECT_TIMEOUT 3.109.171.244:6543")).toBe("BACKEND_UNAVAILABLE");
    expect(inferTaskErrorCode("the request timed out")).toBe("BACKEND_UNAVAILABLE");
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

  test("R67 merge: UPSTREAM_TIMEOUT is now first-class, not an alias -- WS-B's own code", () => {
    expect(asTaskErrorCode("UPSTREAM_TIMEOUT")).toBe("UPSTREAM_TIMEOUT");
    expect(resolveTaskError({ code: "UPSTREAM_TIMEOUT" }).code).toBe("UPSTREAM_TIMEOUT");
    // POOL_TIMEOUT has no first-class code of its own, so it still aliases.
    expect(asTaskErrorCode("POOL_TIMEOUT")).toBe("BACKEND_UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R67 MERGE (decision D-11) -- WS-B's own suite, restated against the merged
// dictionary. WS-B's own tests below are UNCHANGED except where the merge
// deliberately kept WS-C's wording for a code both sides defined (see the
// merge note in task-errors.ts); those specific expectations are restated
// against the wording that ships, and say so.
// ═══════════════════════════════════════════════════════════════════════════

describe("R67 merge -- every sentence obeys the three D-03 rules, over the full merged vocabulary", () => {
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
        expect(FIX_PARAMS).toContain(step.param!);
      }
      if (step.kind === "route") expect(step.route).toBeTruthy();
    }
  });
});

describe("R67 merge -- taskErrorFor / messageFor render the merged BOQ_LINE_NOT_FOUND sentence", () => {
  test("the acceptance string, character for character (WS-C's em-dash wording, kept -- see merge note)", () => {
    expect(
      taskErrorFor({
        code: "BOQ_LINE_NOT_FOUND",
        params: { code: "1", project: "Cedar Heights Villa - Phase 1", version: "Rev0" },
      })
    ).toBe("There is no line 1 on Cedar Heights Villa - Phase 1 Rev0 — pick a line");
  });

  test("an unresolved version leaves no double space behind", () => {
    expect(messageFor("BOQ_LINE_NOT_FOUND", { code: "1", project: "Cedar Heights Villa - Phase 1" })).toBe(
      "There is no line 1 on Cedar Heights Villa - Phase 1 — pick a line"
    );
  });

  test("the server's own context key (itemCode) is read, and never printed", () => {
    const rendered = messageFor("BOQ_LINE_NOT_FOUND", { itemCode: "EX-01", project: "Oakwood", version: "v2" });
    expect(rendered).toBe("There is no line EX-01 on Oakwood v2 — pick a line");
    expect(rendered).not.toContain("itemCode");
  });

  test("BOQ_LINE_IS_PARENT names the line when the server knew it, and the rule when it did not", () => {
    expect(messageFor("BOQ_LINE_IS_PARENT", { code: "EX-00" })).toBe("EX-00 is a parent line — pick one of its child lines");
    expect(messageFor("BOQ_LINE_IS_PARENT", {})).toBe("Progress goes on a child line, not the parent");
  });

  test("an unknown code renders the honest fallback, never a blank row", () => {
    expect(isTaskErrorCode("SOMETHING_NEW")).toBe(false);
    expect(messageFor("SOMETHING_NEW")).toBe("Something went wrong (code SOMETHING_NEW)");
    expect(unknownCodeMessage("X9")).toBe("Something went wrong (code X9)");
    expect(nextStepFor("SOMETHING_NEW").kind).toBe("retry");
  });

  test("null and undefined codes do not throw", () => {
    expect(messageFor(null)).toBe("Something went wrong (code unknown)");
    expect(messageFor(undefined)).toBe("Something went wrong (code unknown)");
  });
});

// ── R67 B-10: rows written before the pipeline returned codes ─────────────

describe("R67 merge -- legacyToCode maps the strings the R66 walkthrough photographed", () => {
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
      expect(rendered).toBe("The construction data service didn't answer — nothing was saved");
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

describe("R67 merge -- a sentence that names the problem also carries the way out", () => {
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
      "There is no line 1 on Cedar Heights Villa - Phase 1 Rev0 — pick a line [Fix]"
    );
  });

  test("a retry sentence gets its bracket appended by rowDetailFor, not baked into the dictionary", () => {
    expect(rowDetailFor("BACKEND_UNAVAILABLE")).toBe(
      "The construction data service didn't answer — nothing was saved [Retry]"
    );
    expect(rowDetailFor("BACKEND_UNAVAILABLE").match(/\[Retry\]/g)?.length).toBe(1);
  });

  test("no row detail can ever print a parameter, an id or an address", () => {
    for (const code of TASK_ERROR_CODES) {
      const detail = rowDetailFor(code, SAMPLE);
      expect(detail).not.toMatch(CAMEL_CASE);
      expect(detail).not.toMatch(HOST_PORT);
      expect(detail.replace(/\[Fix\]|\[Retry\]|\[Open Home\]|\[Open the screen\]/, "")).not.toContain("_");
    }
    // and the same holds for the R66 rows that started all of this
    expect(rowDetailFor(legacyToCode("write CONNECT_TIMEOUT 3.109.171.244:6543"))).not.toMatch(HOST_PORT);
    expect(rowDetailFor(legacyToCode("itemCode is required"))).toBe("Pick a BOQ line [Fix]");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// R67 FIX PASS (WS-B)
// ═══════════════════════════════════════════════════════════════════════════
describe("FIX PASS -- BOQ_LINE_NOT_FOUND reads correctly for EVERY context shape", () => {
  test("all three present: the full D-03 sentence", () => {
    expect(messageFor("BOQ_LINE_NOT_FOUND", { code: "1", project: "Cedar Heights Villa - Phase 1", version: "v2" })).toBe(
      "There is no line 1 on Cedar Heights Villa - Phase 1 v2 — pick a line"
    );
  });

  test("VERSION ONLY: the clause carries the version alone, with no dangling 'on'", () => {
    expect(messageFor("BOQ_LINE_NOT_FOUND", { itemCode: "EX-01", version: "v2" })).toBe(
      "There is no line EX-01 on v2 — pick a line"
    );
  });

  test("NEITHER: the clause still names the BOQ rather than leaving a hole (WS-C's fallback, kept)", () => {
    expect(messageFor("BOQ_LINE_NOT_FOUND", { itemCode: "EX-01", version: null })).toBe(
      "There is no line EX-01 on this BOQ — pick a line"
    );
    expect(messageFor("BOQ_LINE_NOT_FOUND", { itemCode: "EX-01" })).toBe("There is no line EX-01 on this BOQ — pick a line");
  });

  test("the row detail is equally clean -- no ' on' left dangling, ever", () => {
    expect(rowDetailFor("BOQ_LINE_NOT_FOUND", { itemCode: "EX-01", version: null })).toBe(
      "There is no line EX-01 on this BOQ — pick a line [Fix]"
    );
    for (const params of [{}, { itemCode: "EX-01" }, { project: "Oakwood" }, { version: "v3" }]) {
      expect(messageFor("BOQ_LINE_NOT_FOUND", params)).not.toMatch(/ on\s*—/);
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
      "That BOQ has already been revised — open the latest revision"
    );
  });

  test("an unrecognised write still gets an honest sentence, and never prints the function id", () => {
    const rendered = messageFor("ALREADY_RECORDED", { functionId: "some_future_write" });
    expect(rendered).toBe("That is already recorded — nothing new was saved");
    expect(rendered).not.toContain("some_future_write");
    expect(rendered).not.toContain("_");
  });

  test("RECORD_NOT_FOUND and REQUEST_REJECTED read as statements about the request", () => {
    expect(messageFor("RECORD_NOT_FOUND")).toBe("That record is not on this project — pick another");
    expect(messageFor("REQUEST_REJECTED")).toBe("That was not accepted as entered — check the values and try again");
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
    expect(legacyToCode(stored)).toBeNull();
  });

  test("but a genuine missing-activity string still maps", () => {
    expect(legacyToCode("activityId is required")).toBe("ACTIVITY_REQUIRED");
    expect(legacyToCode("activity is required")).toBe("ACTIVITY_REQUIRED");
  });

  test("the percent/quantity pattern no longer claims any string containing the words", () => {
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
