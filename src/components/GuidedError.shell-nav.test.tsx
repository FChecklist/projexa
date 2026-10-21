/// <reference types="bun-types" />
// The guided panel on a screen that is NOT drawn by the Next router (the laptop shell, or a test with no router mounted): it must still render,
// and "Fix it now" must move by the shell's own navigate -- never ask the Next router for a page, never throw.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { GuidedError, GuidedNavigationContext } from "./GuidedError";
import { setUnmatchedLogger } from "@/lib/error-guide/match";
import type { GuideContext } from "@/lib/error-guide/types";

// NOTE: next/navigation is deliberately NOT mocked here: there is no app router, which is the situation this file is about.
const ctx = (over: Partial<GuideContext> = {}): GuideContext => ({ route: "/permits/new", search: "?projectId=p1", projectId: "p1", method: "POST", apiPath: "/api/permits", status: 404, serverMessage: "That could not be found", ...over });

beforeEach(() => {
  sessionStorage.clear();
  setUnmatchedLogger(() => {});
});
afterEach(() => cleanup());

describe("GuidedError without a Next router", () => {
  test("renders the whole panel instead of crashing the screen", () => {
    const { getByTestId } = render(<GuidedError ctx={ctx()} />);
    expect(getByTestId("guided-error-title").textContent).not.toBe("");
    expect(getByTestId("guided-error-steps")).toBeTruthy();
    expect(getByTestId("guided-error-fix")).toBeTruthy();
  });

  test("Fix it now moves by the shell's navigate when the shell provides one, carrying the way back", () => {
    const moved: string[] = [];
    const { getByTestId } = render(
      <GuidedNavigationContext.Provider value={(href) => moved.push(href)}>
        <GuidedError ctx={ctx()} />
      </GuidedNavigationContext.Provider>
    );
    fireEvent.click(getByTestId("guided-error-fix"));
    expect(moved).toHaveLength(1);
    expect(moved[0]).toContain("returnTo=");
    expect(moved[0].startsWith("/permits")).toBe(true);
  });
});
