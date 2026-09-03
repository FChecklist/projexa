/// <reference types="bun-types" />
// R67 G-04 / WS-G, review fix. PROJEXA's fork of the kit's Composer makes two
// changes, and until this suite existed neither was verified in a render --
// composer-send-state.test.ts covers only the pure helper.
//
//   1. SEND WAS WHITE ON SAFFRON: 2.60:1, a WCAG AA failure on the single
//      most-clicked control in the product. It keeps the saffron fill and
//      takes navy text (5.55:1). It sets its colour INLINE rather than through
//      the shadcn Button variant, so the one-line --primary-foreground fix in
//      globals.css does not reach it -- which is exactly why it needs its own
//      assertion here.
//   2. THE DISABLED REASON WAS EASY TO MISS AND SOMETIMES ABSENT. The kit
//      rendered it at 11px in the bottom-left of the viewport, where Next
//      parks its development badge; and in the "nothing typed" state there was
//      no sentence at all -- a dead control with no words. It now renders at
//      12px immediately left of Send, with role="status", and the textarea
//      points at it via aria-describedby.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { Chain } from "@fchecklist/veridian-ui-kit/shell";
import { Composer, type ComposerProps } from "./Composer";

afterEach(cleanup);

const CHAIN: Chain = {
  mode: "projects",
  segments: [{ id: "p1", label: "Cedar Heights Villa", kind: "root" }],
};

const noop = () => {};

// REBASE NOTE (r67 lane A onto this lane G suite): the fork's prop surface
// changed. onModeChange/history/onLoadChain are gone with the mode row (A-22)
// and the HISTORY drop (A-01); `instruction` and `canSend` replace the
// disabledReason/emptyInputReason/allowEmptySubmit trio (A-19). See the
// describes below for why each of G's rules survives the swap.
function renderComposer(overrides: Partial<ComposerProps> = {}) {
  const props: ComposerProps = {
    chain: CHAIN,
    onCutFrom: noop,
    onHome: noop,
    onReset: noop,
    instruction: "",
    canSend: true,
    value: "",
    onChange: noop,
    onSubmit: noop,
    ...overrides,
  };
  return render(<Composer {...props} />);
}

/** The Send button, found by role rather than by the exact word "Send": A-19
 *  renames it for what it will do ("Save progress", "Run") and appends what is
 *  missing ("Send (pick a project)"), so an equality on "Send" would silently
 *  stop finding it. It is the last button in the composer's footer row. */
const sendButton = (container: HTMLElement) => {
  const buttons = Array.from(container.querySelectorAll("button"));
  const found = buttons[buttons.length - 1];
  if (!found) throw new Error("no Send button rendered");
  return found as HTMLButtonElement;
};

const textarea = (container: HTMLElement) => container.querySelector("textarea") as HTMLTextAreaElement;

describe("Send is navy on saffron, not white on saffron", () => {
  test("the button paints from the two tokens that measure 5.55:1", () => {
    const { container } = renderComposer({ value: "log 2 hours" });
    const style = sendButton(container).getAttribute("style") ?? "";
    expect(style).toContain("var(--color-ct-saffron)");
    expect(style).toContain("var(--color-ct-navy)");
    // The failure this replaced. If white ever comes back, this fails.
    expect(style).not.toContain("#fff");
    expect(style.toLowerCase()).not.toContain("white");
  });

  test("the colour is set on Send itself, because the shadcn fix cannot reach it", () => {
    const { container } = renderComposer({ value: "log 2 hours" });
    const btn = sendButton(container);
    // It is a bare <button>, not the shadcn <Button> -- so `bg-primary
    // text-primary-foreground` never applies and the inline pair is the only
    // thing carrying the contrast.
    expect(btn.className).not.toContain("bg-primary");
    expect(btn.getAttribute("style")).toContain("background");
  });
});

// G'S RULE, KEPT; G'S MECHANISM, REPLACED (rebase reconciliation).
//
// G-04 said: a disabled Send must never be a dead control with no words, and
// there must be exactly one instruction, not two. G bought that with a
// separate sentence rendered next to the button (role=status + a
// aria-describedby from the textarea).
//
// Lane A's A-19 removed that slot and put the missing thing INSIDE the
// button's own label -- "Send (pick a project, say what you need)" -- which
// keeps G's rule and makes it stronger in three ways: the words are the
// control's own accessible name, so they are announced on focus rather than
// through an indirection; there is structurally nowhere for a second sentence
// to appear; and the empty-input state G had to add `emptyInputReason` for is
// just one of the things missingThings() lists.
//
// So these assert the RULE against the new mechanism. The end-to-end proof
// that no blocked state is ever silent lives in chain-status.test.ts (every
// state maps to a label) and composer-send.test.tsx ("every label chain-status
// can produce reaches the button unchanged").
describe("a disabled Send still always has words -- now IN the button", () => {
  test("the reason is the button's visible label AND its accessible name", () => {
    const { container } = renderComposer({
      value: "",
      canSend: false,
      sendLabel: "Send (pick a project, say what you need)",
      instruction: "Which project? Choose one in the top rail",
    });
    const btn = sendButton(container);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Send (pick a project, say what you need)");
    // A-19: the accessible name is EXACTLY the label, with nothing appended --
    // the button can never announce one sentence and read another.
    expect(btn.getAttribute("aria-label")).toBe("Send (pick a project, say what you need)");
  });

  test("the state the kit left SILENT still has a sentence", () => {
    // Empty textarea, nothing armed. The kit disabled Send and said nothing;
    // G gave it a sentence beside the button; A-19 gives it one ON the button.
    const { container } = renderComposer({ value: "", canSend: false, sendLabel: "Send (say what you need)" });
    const btn = sendButton(container);
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Send (say what you need)");
  });

  test("EXACTLY ONE instruction -- the old reason slot is gone, not duplicated", () => {
    const { container } = renderComposer({
      value: "",
      canSend: false,
      sendLabel: "Send (pick a project)",
      instruction: "Which project? Choose one in the top rail",
    });
    // The slot G introduced no longer exists...
    expect(container.querySelector("#veri-composer-send-reason")).toBeNull();
    expect(textarea(container).getAttribute("aria-describedby")).toBeNull();
    // ...and the strip's question is carried as the hover title rather than
    // printed a second time in the footer, so it appears once on screen.
    expect(sendButton(container).getAttribute("title")).toBe("Which project? Choose one in the top rail");
    const printed = Array.from(container.querySelectorAll("p, span")).filter(
      (n) => n.textContent === "Which project? Choose one in the top rail"
    );
    expect(printed.length).toBeLessThanOrEqual(1);
  });

  test("the words sit ON the control, at a 44px target, not at 11px in the corner", () => {
    // G's finding was that the kit put the reason at 11px in the bottom-left
    // of the viewport, behind Next's dev badge. It is now the button's label,
    // which A-18 sizes as a real touch target.
    const { container } = renderComposer({ value: "", canSend: false, sendLabel: "Send (say what you need)" });
    const btn = sendButton(container);
    const style = btn.getAttribute("style") ?? "";
    expect(style).toContain("min-height: 44px");
    expect(btn.className).not.toContain("text-[11px]");
  });
});

describe("a live Send has no extra words at all", () => {
  test("when the sentence is complete the button is plain and the footer empty", () => {
    const { container } = renderComposer({ value: "log 2 hours", canSend: true, sendLabel: "Send", instruction: "" });
    const btn = sendButton(container);
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("Send");
    expect(container.querySelector("#veri-composer-send-reason")).toBeNull();
    expect(textarea(container).getAttribute("aria-describedby")).toBeNull();
    // Nothing failed, so the footer's alert line is absent entirely.
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  test("an armed card makes an EMPTY input a legitimate submission", () => {
    // G's point, unchanged and still true: once a module card is armed, telling
    // the user to press a button you have disabled is worse than saying
    // nothing. `allowEmptySubmit` is gone as a prop -- canSend now carries the
    // whole decision, computed by chain-status from the armed action.
    const { container } = renderComposer({ value: "", canSend: true, sendLabel: "Save progress" });
    expect(sendButton(container).disabled).toBe(false);
    expect(sendButton(container).textContent).toBe("Save progress");
  });

  test("a real FAILURE is a different thing and keeps its own line", () => {
    // The one case that still prints words in the footer: something went wrong.
    const { container } = renderComposer({ value: "x", canSend: true, errorMessage: "Nothing was saved" });
    const alert = container.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe("Nothing was saved");
    // ...and it does not rename the button (A-10 follow-up).
    expect(sendButton(container).textContent).toBe("Send");
  });
});

describe("the fork still assembles the kit's own composer", () => {
  test("the forked ControlStrip is the one mounted, chain and all", () => {
    const { getByTitle, getByText, queryByText } = renderComposer({ value: "x" });
    // The chain's root segment, rendered by the strip with its full name.
    expect(getByTitle("Cedar Heights Villa")).toBeDefined();
    // WAS: expect(getByText("HISTORY")).toBeDefined(). A-01 deleted the
    // composer's HISTORY button so the Task Master's History tab is the only
    // control by that name (correction C-03), and nothing in this repo ever
    // wrote the drop's storage key -- it listed nothing for its whole life.
    // HOME is the strip control that proves the fork is mounted, and HISTORY's
    // absence is now itself the assertion.
    expect(getByText("HOME")).toBeDefined();
    expect(queryByText("HISTORY")).toBeNull();
  });

  test("the pills and conversation bands render only when given content", () => {
    const withBands = renderComposer({ value: "x", pills: <span>PILLS</span>, conversation: <span>CHAT</span> });
    expect(withBands.getByText("PILLS")).toBeDefined();
    expect(withBands.getByText("CHAT")).toBeDefined();
    cleanup();
    const without = renderComposer({ value: "x" });
    expect(without.queryByText("PILLS")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// R67 C-15 -- the Send button names what it is waiting for.
// ---------------------------------------------------------------------------

describe("the Send label", () => {
  test("plain by default", () => {
    const { container } = renderComposer({ value: "record 50%" });
    expect(sendButton(container)).toBeTruthy();
  });

  test("it carries the outstanding answer when the caller supplies one", () => {
    const { container } = renderComposer({ value: "record 50%", sendLabel: "Send (pick a BOQ line)" });
    const labels = Array.from(container.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toContain("Send (pick a BOQ line)");
    // The old label is GONE, not sitting beside it -- two Send buttons would
    // be two answers to the same question.
    expect(labels.filter((l) => l === "Send")).toHaveLength(0);
  });

  test("the message region renders above the box, outside it", () => {
    const { container } = renderComposer({
      value: "x",
      messages: <p data-testid="region">Saved — Permit P-12</p>,
    });
    const region = container.querySelector("[data-testid='region']");
    const box = container.querySelector(".rounded-xl");
    expect(region).toBeTruthy();
    expect(box).toBeTruthy();
    expect(box!.contains(region)).toBe(false);
  });

  test("with no message the region contributes nothing at all", () => {
    const { container } = renderComposer({ value: "x" });
    expect(container.querySelector("[data-testid='region']")).toBeNull();
  });
});
