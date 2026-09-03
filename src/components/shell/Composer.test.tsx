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

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  const props: ComposerProps = {
    chain: CHAIN,
    onModeChange: noop,
    onCutFrom: noop,
    onHome: noop,
    onReset: noop,
    // R67 C-10: the composer no longer owns a history drop, so it no longer
    // takes a history list or a chain loader -- only the word's handler.
    onHistory: noop,
    value: "",
    onChange: noop,
    onSubmit: noop,
    ...overrides,
  };
  return render(<Composer {...props} />);
}

const sendButton = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Send") as HTMLButtonElement;

const reasonNode = (container: HTMLElement) => container.querySelector("#veri-composer-send-reason");

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

describe("a disabled Send always has words beside it", () => {
  test("the caller's reason renders with role=status, and the textarea points at it", () => {
    const { container } = renderComposer({ value: "log 2 hours", disabledReason: "Sending…" });
    const reason = reasonNode(container)!;
    expect(reason).not.toBeNull();
    expect(reason.textContent).toBe("Sending…");
    expect(reason.getAttribute("role")).toBe("status");
    expect(sendButton(container).disabled).toBe(true);
    expect(textarea(container).getAttribute("aria-describedby")).toBe("veri-composer-send-reason");
  });

  test("the state the kit left SILENT now has a sentence", () => {
    // Empty textarea, nothing armed: the kit disabled Send and said nothing.
    const { container } = renderComposer({ value: "" });
    expect(sendButton(container).disabled).toBe(true);
    expect(reasonNode(container)?.textContent).toBe("Type what you need, then press Send.");
  });

  test("the caller's own reason wins over the empty-input one -- exactly one instruction", () => {
    const { container } = renderComposer({ value: "", disabledReason: "Pick a project first" });
    expect(container.querySelectorAll("#veri-composer-send-reason")).toHaveLength(1);
    expect(reasonNode(container)?.textContent).toBe("Pick a project first");
  });

  test("the reason sits at 12px, immediately LEFT of Send, in the same group", () => {
    // The kit put it at 11px at the far left of the row -- the bottom-left
    // corner of the viewport, behind Next's dev badge.
    const { container } = renderComposer({ value: "", disabledReason: "Sending…" });
    const reason = reasonNode(container)! as HTMLElement;
    expect(reason.className).toContain("text-[12px]");
    expect(reason.className).not.toContain("text-[11px]");

    const group = reason.parentElement!;
    expect(group.className).toContain("ml-auto");
    // Same parent as Send, and BEFORE it in document order.
    expect(sendButton(container).parentElement).toBe(group);
    expect(reason.compareDocumentPosition(sendButton(container)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("a live Send has no words at all", () => {
  test("typed input enables the button and removes the instruction", () => {
    const { container } = renderComposer({ value: "log 2 hours" });
    expect(sendButton(container).disabled).toBe(false);
    expect(reasonNode(container)).toBeNull();
    expect(textarea(container).getAttribute("aria-describedby")).toBeNull();
  });

  test("allowEmptySubmit makes an EMPTY input a legitimate submission", () => {
    // The kit's contradiction: once a module pill was picked, the placeholder
    // read "Press send to run this…" while Send was disabled. Telling the user
    // to press a button you have disabled is worse than saying nothing.
    const { container } = renderComposer({
      value: "",
      allowEmptySubmit: true,
      placeholder: "Press send to run this, or add detail first…",
    });
    expect(sendButton(container).disabled).toBe(false);
    expect(reasonNode(container)).toBeNull();
    expect(textarea(container).getAttribute("placeholder")).toBe("Press send to run this, or add detail first…");
  });

  test("whitespace alone is not input", () => {
    const { container } = renderComposer({ value: "   \n  " });
    expect(sendButton(container).disabled).toBe(true);
    expect(reasonNode(container)?.textContent).toBe("Type what you need, then press Send.");
  });
});

describe("the fork still assembles the kit's own composer", () => {
  test("the forked ControlStrip is the one mounted, chain and all", () => {
    const { getByTitle, getByText } = renderComposer({ value: "x" });
    expect(getByTitle("Cedar Heights Villa")).toBeDefined();
    expect(getByText("HISTORY")).toBeDefined();
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
