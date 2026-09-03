import { describe, expect, test } from "bun:test";
import { composerSendState, sendLabelFor } from "./composer-send-state";

const EMPTY_REASON = "Type what you need, then press Send.";
const base = { emptyInputReason: EMPTY_REASON, hasSubmitHandler: true };

describe("G-04: exactly one instruction per state", () => {
  test("the caller's own reason wins -- it is the more specific fact", () => {
    expect(composerSendState({ ...base, disabledReason: "Sending…", value: "record progress" })).toEqual({
      canSubmit: false,
      reason: "Sending…",
    });
    expect(composerSendState({ ...base, disabledReason: "Pick a project or a module first", value: "" })).toEqual({
      canSubmit: false,
      reason: "Pick a project or a module first",
    });
  });

  test("a server refusal is never hidden behind the generic empty-input prompt", () => {
    const serverSaidNo = "There is no line 1.02 on Cedar Heights v3 - pick a line";
    const state = composerSendState({ ...base, disabledReason: serverSaidNo, value: "" });
    expect(state.reason).toBe(serverSaidNo);
    expect(state.reason).not.toBe(EMPTY_REASON);
  });

  test("nothing typed and nothing armed: the state the kit left silent", () => {
    expect(composerSendState({ ...base, value: "" })).toEqual({ canSubmit: false, reason: EMPTY_REASON });
    expect(composerSendState({ ...base, value: "   \n  " })).toEqual({ canSubmit: false, reason: EMPTY_REASON });
  });

  test("a live button carries no instruction at all -- one state, one message, and none when none is needed", () => {
    expect(composerSendState({ ...base, value: "log 20 m3 of concrete" })).toEqual({
      canSubmit: true,
      reason: undefined,
    });
  });
});

describe("G-04: the button and its explanation cannot drift apart", () => {
  const CASES = [
    { name: "blocked by caller, empty input", input: { ...base, disabledReason: "Sending…", value: "" } },
    { name: "blocked by caller, typed input", input: { ...base, disabledReason: "Sending…", value: "x" } },
    { name: "empty input, nothing armed", input: { ...base, value: "" } },
    { name: "empty input, module armed", input: { ...base, value: "", allowEmptySubmit: true } },
    { name: "typed input", input: { ...base, value: "x" } },
    { name: "no submit handler wired", input: { ...base, value: "x", hasSubmitHandler: false } },
  ];

  test("whenever the button is disabled there IS a reason", () => {
    for (const { name, input } of CASES) {
      const state = composerSendState(input);
      // The one exception is a caller that wired no handler at all -- that is
      // a programming error, not a user-facing state, and it cannot occur in
      // M24Shell, which always passes onSubmit.
      if (!state.canSubmit && input.hasSubmitHandler) {
        expect({ name, hasReason: Boolean(state.reason) }).toEqual({ name, hasReason: true });
      }
    }
  });

  test("whenever the button is live there is NO reason -- never two messages at once", () => {
    for (const { name, input } of CASES) {
      const state = composerSendState(input);
      if (state.canSubmit) {
        expect({ name, reason: state.reason }).toEqual({ name, reason: undefined });
      }
    }
  });
});

describe("G-04: an armed module makes the empty input a real submission", () => {
  test("Send is live with an empty input once something runnable is armed", () => {
    // The kit disabled Send here while its own placeholder said "Press send
    // to run this" -- an instruction contradicting the control.
    expect(composerSendState({ ...base, value: "", allowEmptySubmit: true })).toEqual({
      canSubmit: true,
      reason: undefined,
    });
  });

  test("...but a caller-level block still wins over it", () => {
    expect(
      composerSendState({ ...base, value: "", allowEmptySubmit: true, disabledReason: "Sending…" })
    ).toEqual({ canSubmit: false, reason: "Sending…" });
  });
});

// ---------------------------------------------------------------------------
// R67 C-15 -- the Send button names the one thing it is waiting for.
// ---------------------------------------------------------------------------

describe("sendLabelFor", () => {
  test("C-15's own label", () => {
    expect(sendLabelFor(["itemCode"])).toBe("Send (pick a BOQ line)");
  });

  test("nothing outstanding leaves the button alone", () => {
    expect(sendLabelFor([])).toBe("Send");
    expect(sendLabelFor(null)).toBe("Send");
    expect(sendLabelFor(undefined)).toBe("Send");
  });

  test("ONE question at a time -- only the first slot is named", () => {
    expect(sendLabelFor(["itemCode", "percent"])).toBe("Send (pick a BOQ line)");
  });

  test("every slot the pipeline really declares has words", () => {
    for (const slot of ["itemCode", "percent", "projectId", "hours", "task", "boqLineItemId"]) {
      expect(sendLabelFor([slot])).not.toBe("Send");
    }
  });

  test("an unnamed slot yields plain Send, never the parameter name", () => {
    const label = sendLabelFor(["someNewSlot"]);
    expect(label).toBe("Send");
    expect(label).not.toContain("someNewSlot");
  });

  test("a blank entry is not a question", () => {
    expect(sendLabelFor(["  "])).toBe("Send");
  });
});
