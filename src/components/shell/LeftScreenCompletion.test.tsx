/// <reference types="bun-types" />
// LEFT SCREEN COMPLETION -- unit coverage for the presentational Box 1
// component (LeftScreenCompletion.tsx) on its own, independent of
// M24Shell's real bootstrap. See M24Shell.left-screen-completion.test.tsx
// for the real, integrated drill-down/Back/right-pane-sync coverage per
// view -- this file only proves the component's own contract: exactly one
// content region, the 6 selectable views plus Back/Reset, and the chain-
// sentence/"Loaded from history" banner.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { LeftScreenCompletion, LEFT_VIEWS, type LeftViewId } from "./LeftScreenCompletion";

afterEach(cleanup);

function renderLeft(active: LeftViewId, overrides: Partial<Parameters<typeof LeftScreenCompletion>[0]> = {}) {
  const onSelect = mock((_v: LeftViewId) => {});
  const onBack = mock(() => {});
  const onReset = mock(() => {});
  const utils = render(
    <LeftScreenCompletion active={active} onSelect={onSelect} onBack={onBack} onReset={onReset} {...overrides}>
      <p>VIEW CONTENT</p>
    </LeftScreenCompletion>
  );
  return { ...utils, onSelect, onBack, onReset };
}

describe("the 6 selectable views are real tabs, exactly one selected", () => {
  test("all 6 owner-named views render as role=tab, plus Back and Reset as plain buttons", () => {
    const { container } = renderLeft("frequent");
    const tablist = container.querySelector('[role="tablist"]')!;
    expect(tablist).toBeTruthy();
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(LEFT_VIEWS.map((v) => v.label));
    // Back and Reset are real buttons in the same row, but NOT tabs -- neither
    // one is a panel that stays "selected".
    const backBtn = [...tablist.querySelectorAll("button")].find((b) => b.textContent?.includes("Back"));
    const resetBtn = [...tablist.querySelectorAll("button")].find((b) => b.textContent?.includes("Reset"));
    expect(backBtn?.getAttribute("role")).not.toBe("tab");
    expect(resetBtn?.getAttribute("role")).not.toBe("tab");
  });

  test("exactly one tab carries aria-selected=true, matching `active`", () => {
    for (const view of LEFT_VIEWS) {
      const { container, unmount } = renderLeft(view.id);
      const tabs = [...container.querySelectorAll('[role="tab"]')];
      const selected = tabs.filter((t) => t.getAttribute("aria-selected") === "true");
      expect(selected).toHaveLength(1);
      expect(selected[0]!.textContent).toBe(view.label);
      unmount();
    }
  });

  test("clicking a tab reports that view's id, and only that one", () => {
    const { container, onSelect } = renderLeft("frequent");
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    const reportsTab = tabs.find((t) => t.textContent === "Reports")!;
    fireEvent.click(reportsTab);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("reports");
  });

  test("Back and Reset call their own callbacks, never onSelect", () => {
    const { container, onBack, onReset, onSelect } = renderLeft("modules");
    fireEvent.click([...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Back one step") || b.textContent === "‹Back")!);
    fireEvent.click([...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Reset the chain")!);
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  // Back is deliberately never `disabled` -- see LeftScreenCompletion.tsx's
  // own doc comment on the `onBack` prop: the new Back is ALWAYS a
  // meaningful action (step back through a chain, a Tasks sub-tab, or the
  // view history, falling back to Home), never a well-explained dead end.
  test("Back is never disabled", () => {
    const { container } = renderLeft("home");
    const backBtn = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Back one step")!;
    expect(backBtn.hasAttribute("disabled")).toBe(false);
  });
});

describe("exactly one content region -- the structural fix for the overlap bug class", () => {
  test("the caller's children render inside a single content region, once", () => {
    const { container, getAllByText } = renderLeft("frequent");
    expect(container.querySelectorAll('[data-testid="left-view-content"]')).toHaveLength(1);
    expect(getAllByText("VIEW CONTENT")).toHaveLength(1);
  });
});

describe("the chain sentence and 'Loaded from history' banner", () => {
  test("neither renders when there is nothing to say", () => {
    const { queryByTestId, queryByText } = renderLeft("frequent");
    expect(queryByTestId("left-chain-sentence")).toBeNull();
    expect(queryByText("Loaded from history")).toBeNull();
  });

  test("the sentence renders verbatim, with a title for the untruncated words", () => {
    const { getByTestId } = renderLeft("modules", { chainSentence: "Cedar Heights Villa - Phase 1 › Permits › New" });
    const el = getByTestId("left-chain-sentence");
    expect(el.textContent).toBe("Cedar Heights Villa - Phase 1 › Permits › New");
    expect(el.getAttribute("title")).toBe("Cedar Heights Villa - Phase 1 › Permits › New");
  });

  test("a loaded chain says so, and the pin toggles it", () => {
    const onTogglePin = mock(() => {});
    const { getByText, getByLabelText } = renderLeft("modules", {
      loaded: { from: "Work Progress", pinned: false, onTogglePin },
    });
    expect(getByText("Loaded from history")).toBeDefined();
    fireEvent.click(getByLabelText("Pin this loaded chain so it survives navigation"));
    expect(onTogglePin).toHaveBeenCalledTimes(1);
  });

  test("a real backend-failure banner renders above everything, regardless of the active view", () => {
    const { getByText, container } = renderLeft("tasks", { banner: <p>This panel is showing less than it should.</p> });
    const banner = getByText("This panel is showing less than it should.");
    const tablist = container.querySelector('[role="tablist"]')!;
    // The banner is a DOM sibling that comes BEFORE the tablist -- rendered
    // unconditionally above the nav row, not tucked inside one view.
    expect(banner.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
