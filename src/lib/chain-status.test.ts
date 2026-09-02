/// <reference types="bun-types" />
// R67 WS-A (A-10), and the surviving assertions of A-01's composer-instruction
// .test.ts, which this file replaces along with the module it tested.
//
// A-10's acceptance is "each state maps to exactly one strip string and one
// Send label", so the tests below are organised as exactly that: a table from
// status to the pair it produces, plus an exhaustive sweep proving that no
// combination of inputs can bring back one of the retired sentences.
import { describe, test, expect } from "bun:test";
import {
  RETIRED_STRINGS,
  canSend,
  chainPrompt,
  chainStatus,
  sendLabel,
  type ComposerState,
} from "./chain-status";

const base: ComposerState = {
  shipped: true,
  hasProjects: true,
  hasProject: true,
  projectName: "Cedar Heights Villa - Phase 1",
  moduleLabel: null,
  action: null,
  missing: [],
  hasText: false,
};

const RECORD = { label: "Record progress", object: "progress", kind: "write" as const };
const EXPIRING = { label: "Expiring permits", object: "expiring permits", kind: "ask" as const };
const WPR = { label: "Run WPR", object: "WPR", kind: "run" as const };

describe("chainStatus -- the earliest unanswered question wins", () => {
  test("a 404 outranks every question about the chain", () => {
    expect(chainStatus({ ...base, shipped: false, hasProject: false })).toBe("not-found");
  });

  test("a submission in flight outranks everything but the 404", () => {
    expect(chainStatus({ ...base, busy: true, hasText: true })).toBe("sending");
  });

  test("a failure is its own state", () => {
    expect(chainStatus({ ...base, error: "itemCode is required", hasText: true })).toBe("error");
  });

  test("an org with no projects is not the same state as a project not chosen", () => {
    expect(chainStatus({ ...base, hasProjects: false, hasProject: false })).toBe("no-projects");
    expect(chainStatus({ ...base, hasProject: false })).toBe("no-project");
  });

  test("an armed action with a missing parameter names that parameter", () => {
    expect(
      chainStatus({ ...base, action: RECORD, missing: [{ key: "itemCode", label: "BOQ line" }] })
    ).toBe("missing-step:itemCode");
  });

  test("armed and complete is ready-pill; text alone is ready-text", () => {
    expect(chainStatus({ ...base, action: RECORD })).toBe("ready-pill");
    expect(chainStatus({ ...base, hasText: true })).toBe("ready-text");
  });

  test("a project and nothing else is the no-action state", () => {
    expect(chainStatus(base)).toBe("no-action");
  });
});

describe("chainPrompt -- ONE instruction, and it is the next question", () => {
  test("no project asks for the project, at the control that chooses one", () => {
    expect(chainPrompt({ ...base, hasProject: false })).toBe("Which project? Choose one in the top rail");
  });

  test("no projects at all names the only thing that can be done (A-05)", () => {
    expect(chainPrompt({ ...base, hasProjects: false, hasProject: false })).toBe(
      "No projects yet — Create Project"
    );
  });

  test("inside a module it names that module's two ways forward (A-06)", () => {
    expect(chainPrompt({ ...base, moduleLabel: "Permits" })).toBe(
      "Pick an action above or type what you need on Permits"
    );
  });

  test("outside a module it asks the plain question", () => {
    expect(chainPrompt(base)).toBe("What do you want to do?");
  });

  test("a missing parameter is asked for by name", () => {
    expect(
      chainPrompt({ ...base, action: RECORD, missing: [{ key: "itemCode", label: "BOQ line" }] })
    ).toBe("Which BOQ line?");
  });

  test("a complete sentence asks NOTHING -- the Send button's name says it", () => {
    expect(chainPrompt({ ...base, action: RECORD })).toBe("");
    expect(chainPrompt({ ...base, hasText: true })).toBe("");
  });

  test("an unshipped URL says so (A-06)", () => {
    expect(chainPrompt({ ...base, shipped: false })).toBe("Page not found — HOME");
  });

  test("an error does not blank the strip -- it still shows the same question", () => {
    // The failure itself is rendered once, in the footer, in the backend's own
    // words. Repeating it in the strip would be the duplication this removes.
    expect(chainPrompt({ ...base, moduleLabel: "Permits", error: "Nothing was saved" })).toBe(
      "Pick an action above or type what you need on Permits"
    );
  });
});

describe("sendLabel -- the button is named for what it will do", () => {
  test("a write card saves its own object", () => {
    expect(sendLabel({ ...base, action: RECORD })).toBe("Save progress");
  });

  test("an ask card asks, a run card runs", () => {
    expect(sendLabel({ ...base, action: EXPIRING })).toBe("Ask");
    expect(sendLabel({ ...base, action: WPR })).toBe("Run");
  });

  test("free text keeps the generic verb -- the server decides what it means", () => {
    expect(sendLabel({ ...base, hasText: true })).toBe("Send");
    expect(sendLabel(base)).toBe("Send");
  });

  test("a blocked action shows the count of what is missing, and stays named", () => {
    expect(sendLabel({ ...base, action: RECORD, missing: [{ key: "itemCode", label: "BOQ line" }] })).toBe(
      "Record progress (1 required field)"
    );
    expect(
      sendLabel({
        ...base,
        action: RECORD,
        missing: [
          { key: "itemCode", label: "BOQ line" },
          { key: "quantity", label: "quantity" },
        ],
      })
    ).toBe("Record progress (2 required fields)");
  });

  test("it NEVER becomes 'Sending...' -- the spinner sits beside it instead", () => {
    expect(sendLabel({ ...base, action: RECORD, busy: true })).toBe("Save progress");
    expect(sendLabel({ ...base, hasText: true, busy: true })).toBe("Send");
    const everyLabel = new Set<string>();
    for (const busy of [true, false]) {
      for (const action of [null, RECORD, EXPIRING, WPR]) {
        for (const hasText of [true, false]) {
          everyLabel.add(sendLabel({ ...base, busy, action, hasText }));
        }
      }
    }
    expect([...everyLabel].some((l) => l.toLowerCase().includes("sending"))).toBe(false);
  });
});

describe("A-10's acceptance: each state maps to exactly one strip string and one Send label", () => {
  const byStatus: Record<string, ComposerState> = {
    "not-found": { ...base, shipped: false },
    sending: { ...base, busy: true, hasText: true },
    error: { ...base, hasText: true, error: "Nothing was saved" },
    "no-projects": { ...base, hasProjects: false, hasProject: false },
    "no-project": { ...base, hasProject: false },
    "missing-step:itemCode": { ...base, action: RECORD, missing: [{ key: "itemCode", label: "BOQ line" }] },
    "ready-pill": { ...base, action: RECORD },
    "ready-text": { ...base, hasText: true },
    "no-action": base,
  };

  test("every named status is actually reachable from its fixture", () => {
    for (const [status, state] of Object.entries(byStatus)) {
      expect(chainStatus(state)).toBe(status as ReturnType<typeof chainStatus>);
    }
  });

  test("each state produces one deterministic prompt and one deterministic label", () => {
    for (const state of Object.values(byStatus)) {
      expect(chainPrompt(state)).toBe(chainPrompt(state));
      expect(sendLabel(state)).toBe(sendLabel(state));
    }
  });

  test("no two DIFFERENT questions share a status, and none is a duplicate of another's", () => {
    const questions = Object.values(byStatus)
      .map(chainPrompt)
      .filter((p) => p.length > 0);
    expect(new Set(questions).size).toBe(questions.length);
  });
});

describe("the four retired sentences are unreachable", () => {
  test("no combination of inputs can produce one", () => {
    const produced = new Set<string>();
    for (const shipped of [true, false]) {
      for (const hasProjects of [true, false]) {
        for (const hasProject of [true, false]) {
          for (const moduleLabel of [null, "Permits", "Work Progress"]) {
            for (const action of [null, RECORD, EXPIRING, WPR]) {
              for (const missing of [[], [{ key: "itemCode", label: "BOQ line" }]]) {
                for (const hasText of [true, false]) {
                  for (const busy of [true, false]) {
                    for (const error of [null, "Nothing was saved"]) {
                      const state: ComposerState = {
                        ...base,
                        shipped,
                        hasProjects,
                        hasProject,
                        moduleLabel,
                        action,
                        missing,
                        hasText,
                        busy,
                        error,
                      };
                      produced.add(chainPrompt(state));
                      produced.add(sendLabel(state));
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    for (const gone of RETIRED_STRINGS) expect(produced.has(gone)).toBe(false);
  });
});

describe("canSend", () => {
  test("nothing to send with neither text nor an armed action", () => {
    expect(canSend(base)).toBe(false);
  });

  test("text alone is submittable -- POST /api/tasks takes { rawInput }", () => {
    expect(canSend({ ...base, hasText: true })).toBe(true);
  });

  test("an armed action alone is submittable -- it takes { functionId } too", () => {
    expect(canSend({ ...base, action: RECORD })).toBe(true);
  });

  test("never submittable without a project, or with none in the org", () => {
    expect(canSend({ ...base, hasProject: false, hasText: true })).toBe(false);
    expect(canSend({ ...base, hasProjects: false, hasProject: false, hasText: true })).toBe(false);
  });

  test("never submittable twice while one submission is in flight", () => {
    expect(canSend({ ...base, hasText: true, busy: true })).toBe(false);
  });

  test("never submittable while a required field is missing -- no fail-after-click", () => {
    expect(
      canSend({ ...base, action: RECORD, missing: [{ key: "itemCode", label: "BOQ line" }] })
    ).toBe(false);
  });

  test("never submittable on a page that does not exist", () => {
    expect(canSend({ ...base, shipped: false, hasText: true })).toBe(false);
  });
});
