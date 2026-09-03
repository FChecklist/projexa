/// <reference types="bun-types" />
// R67 WS-A (A-19). The acceptance is a Playwright sweep over the pass-2 tab
// routes plus a screenshot diff, neither of which this lane can run. What it
// asserts about the COMPONENT, though, is exactly assertable here, against the
// real forked Composer:
//
//   * the Send button's accessible name IS the label -- not the label plus the
//     strip's question appended to it, which is what it used to be whenever
//     Send was disabled, and which is what made the reason appear twice;
//   * no separate reason text node sits beside the button;
//   * the placeholder and a real value are told apart by CLASS, never by what
//     the words happen to say;
//   * a value the user did not type is selected on focus, and one they did type
//     is left exactly where their cursor was.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { useState } from "react";
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Composer } from "./Composer";
import { sendLabel, type ComposerState } from "@/lib/chain-status";

afterEach(cleanup);

const CHAIN = { mode: "projects" as const, segments: [] };

function renderComposer(props: Partial<Parameters<typeof Composer>[0]> = {}) {
  return render(
    <Composer
      chain={CHAIN}
      onCutFrom={() => {}}
      onHome={() => {}}
      onReset={() => {}}
      instruction="Which project? Choose one in the top rail"
      sendLabel="Send (pick a project, say what you need)"
      canSend={false}
      value=""
      onChange={() => {}}
      onSubmit={() => {}}
      {...props}
    />
  );
}

const sendButton = (container: HTMLElement) =>
  [...container.querySelectorAll("button")].find((b) =>
    (b.getAttribute("aria-label") ?? "").startsWith("Send")
  ) ?? [...container.querySelectorAll("button")].pop()!;

describe("the Send button's name is the whole of the reason", () => {
  test("disabled: the accessible name is exactly the label, with nothing appended", () => {
    const { container } = renderComposer();
    const send = sendButton(container);
    expect(send.getAttribute("aria-label")).toBe("Send (pick a project, say what you need)");
    expect(send.textContent).toBe("Send (pick a project, say what you need)");
    expect((send as HTMLButtonElement).disabled).toBe(true);
    // The strip's own question survives as the hover title -- supplementary
    // text (A-18), never a second sentence inside the accessible name.
    expect(send.getAttribute("title")).toBe("Which project? Choose one in the top rail");
  });

  test("enabled: the accessible name is exactly the label too", () => {
    const { container } = renderComposer({ canSend: true, sendLabel: "Send", instruction: "", value: "abc" });
    const send = sendButton(container);
    expect(send.getAttribute("aria-label")).toBe("Send");
    expect((send as HTMLButtonElement).disabled).toBe(false);
  });

  test("no separate reason text node sits beside the button", () => {
    const { container } = renderComposer();
    const row = sendButton(container).parentElement!;
    // Every text node in that row belongs to the button itself.
    expect(row.textContent).toBe("Send (pick a project, say what you need)");
    expect(row.querySelector("[role='alert']")).toBeNull();
  });

  test("a real FAILURE is a different thing and keeps its own line", () => {
    // A-10 put the failure on this row deliberately, in red, with role=alert.
    // A-19 removes the grey REASON, not the report of something that went
    // wrong -- and it renders only when something actually did.
    const { container } = renderComposer({ errorMessage: "Nothing was saved" });
    const alert = container.querySelector("[role='alert']");
    expect(alert?.textContent).toBe("Nothing was saved");
  });

  test("every label chain-status can produce reaches the button unchanged", () => {
    const base: ComposerState = { hasProjects: true, hasProject: false, hasText: false };
    for (const state of [
      base,
      { ...base, hasSegment: true },
      { ...base, hasProject: true },
      { ...base, hasProject: true, hasText: true },
    ]) {
      const label = sendLabel(state);
      const { container, unmount } = renderComposer({ sendLabel: label });
      expect(sendButton(container).getAttribute("aria-label")).toBe(label);
      unmount();
    }
  });
});

describe("ink versus grey is a class, not the content", () => {
  test("the value colour and the placeholder colour are separate classes", () => {
    const { container } = renderComposer({ placeholder: "e.g. mark all masons present today" });
    const textarea = container.querySelector("textarea")!;
    const className = textarea.className;
    expect(className).toContain("text-[var(--color-ct-navy)]");
    expect(className).toContain("placeholder:text-[var(--color-ct-muted)]");
    // ...and the element no longer sets a single inline colour for both.
    expect(textarea.style.color).toBe("");
  });

  test("the two are the same classes whether or not there is a value", () => {
    const empty = renderComposer({ value: "" }).container.querySelector("textarea")!.className;
    const filled = renderComposer({ value: "excavation 50%" }).container.querySelector("textarea")!.className;
    expect(filled).toBe(empty);
  });
});

describe("a value the user did not type reads as a draft they may replace", () => {
  /** A controlled host, so the "programmatic" set is a real prop change. */
  function Host({ initial }: { initial: string }) {
    const [value, setValue] = useState(initial);
    return (
      <>
        <button type="button" onClick={() => setValue("record 50% on excavation")}>
          prefill
        </button>
        <Composer
          chain={CHAIN}
          onCutFrom={() => {}}
          onHome={() => {}}
          onReset={() => {}}
          instruction=""
          sendLabel="Send"
          canSend
          value={value}
          onChange={setValue}
          onSubmit={() => {}}
        />
      </>
    );
  }

  test("a prefilled sentence is selected on focus", () => {
    const { container, getByText } = render(<Host initial="" />);
    fireEvent.click(getByText("prefill"));
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("record 50% on excavation");
    fireEvent.focus(textarea);
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe("record 50% on excavation".length);
  });

  test("a sentence the user typed is NOT selected -- their cursor is theirs", () => {
    const { container } = render(<Host initial="" />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "excavation 50%" } });
    textarea.setSelectionRange(3, 3);
    fireEvent.focus(textarea);
    expect(textarea.selectionStart).toBe(3);
    expect(textarea.selectionEnd).toBe(3);
  });

  test("an empty box is never selected, because there is nothing to replace", () => {
    const { container } = render(<Host initial="" />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.focus(textarea);
    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(0);
  });
});
