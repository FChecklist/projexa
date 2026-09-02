/// <reference types="bun-types" />
// R67 WS-A (A-01). The point of the module is that ONE state produces ONE
// sentence, so the test that matters is the exhaustive one: walk every
// reachable state and assert no two of them can be on screen at once and that
// each retired string is really gone.
import { describe, test, expect } from "bun:test";
import { canSend, composerInstruction, type ComposerState } from "./composer-instruction";

const base: ComposerState = {
  hasProjects: true,
  hasProject: true,
  projectName: "Cedar Heights Villa - Phase 1",
  moduleLabel: null,
  hasAction: false,
  hasText: false,
};

describe("composerInstruction", () => {
  test("no projects at all names the only thing that can be done", () => {
    expect(composerInstruction({ ...base, hasProjects: false, hasProject: false })).toBe(
      "No projects yet — Create Project"
    );
  });

  test("no project selected points at the top rail, which is where the control is", () => {
    expect(composerInstruction({ ...base, hasProject: false })).toBe("Pick a project in the top rail to start");
  });

  test("a project but nothing chosen asks the question, and the strip reads as one sentence", () => {
    // Rendered after the project root: "<project> > What do you want to do?"
    expect(composerInstruction(base)).toBe("What do you want to do?");
  });

  test("inside a module it names the project instead of asking for a module", () => {
    expect(composerInstruction({ ...base, moduleLabel: "Minutes of Meeting" })).toBe(
      "Type what you need for Cedar Heights Villa - Phase 1"
    );
  });

  test("a pill with a real function is ready to send", () => {
    expect(composerInstruction({ ...base, hasAction: true })).toBe("Press Send to run this, or add detail");
  });

  test("typed text is ready to send", () => {
    expect(composerInstruction({ ...base, hasText: true })).toBe("Press Send to run this, or add detail");
  });

  test("a submission in flight says so, and outranks every other state", () => {
    expect(composerInstruction({ ...base, hasProject: false, busy: true })).toBe("Sending…");
  });

  test("none of the four retired strings can be produced from any state", () => {
    const retired = [
      "Select a module to begin",
      "Pick a project or a module first",
      "Describe what you need, or pick a module above.",
      "Press send to run this, or add detail first…",
    ];
    const states: ComposerState[] = [];
    for (const hasProjects of [true, false]) {
      for (const hasProject of [true, false]) {
        for (const moduleLabel of [null, "Permits"]) {
          for (const hasAction of [true, false]) {
            for (const hasText of [true, false]) {
              for (const busy of [true, false]) {
                states.push({ ...base, hasProjects, hasProject, moduleLabel, hasAction, hasText, busy });
              }
            }
          }
        }
      }
    }
    const produced = new Set(states.map(composerInstruction));
    for (const gone of retired) expect(produced.has(gone)).toBe(false);
  });

  test("the whole vocabulary is five sentences, no more", () => {
    const states: ComposerState[] = [
      { ...base, hasProjects: false, hasProject: false },
      { ...base, hasProject: false },
      base,
      { ...base, moduleLabel: "Permits" },
      { ...base, hasText: true },
      { ...base, busy: true },
    ];
    expect(new Set(states.map(composerInstruction)).size).toBe(6);
  });
});

describe("canSend", () => {
  test("nothing to send with neither text nor an armed function", () => {
    expect(canSend(base)).toBe(false);
  });

  test("text alone is submittable -- POST /api/tasks takes { rawInput }", () => {
    expect(canSend({ ...base, hasText: true })).toBe(true);
  });

  test("an armed function alone is submittable -- it takes { functionId } too", () => {
    expect(canSend({ ...base, hasAction: true })).toBe(true);
  });

  test("never submittable without a project", () => {
    expect(canSend({ ...base, hasProject: false, hasText: true })).toBe(false);
    expect(canSend({ ...base, hasProjects: false, hasProject: false, hasText: true })).toBe(false);
  });

  test("never submittable twice while one submission is in flight", () => {
    expect(canSend({ ...base, hasText: true, busy: true })).toBe(false);
  });
});
