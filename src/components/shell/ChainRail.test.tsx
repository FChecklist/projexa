/// <reference types="bun-types" />
// New file, 2026-09-07 -- ChainRail.tsx itself had no test until now (it was
// shipped, then extended with Back, in the same session that added this
// suite). Mirrors ControlStrip.test.tsx's own conventions (same chain
// fixture shape, same by-title segment lookup, same word-not-glyph rule)
// since the two are meant to read as one system shown in two places, not
// two different visual languages -- see ChainRail.tsx's own header.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Chain } from "@fchecklist/veridian-ui-kit/shell";
import { ChainRail } from "./ChainRail";

afterEach(cleanup);

const ROOT_ONLY: Chain = {
  mode: "projects",
  segments: [{ id: "p1", label: "Harbor View Corporate HQ - Interior Fit-out", kind: "root" }],
};

const CHAIN: Chain = {
  mode: "projects",
  segments: [
    { id: "p1", label: "Harbor View Corporate HQ - Interior Fit-out", kind: "root" },
    { id: "a1", label: "Work Progress", kind: "action" },
  ],
};

const noop = () => {};

function renderRail(chain: Chain, overrides: { onCutFrom?: (i: number) => void; onBack?: () => void } = {}) {
  return render(
    <ChainRail chain={chain} onCutFrom={overrides.onCutFrom ?? noop} onBack={overrides.onBack ?? noop} />
  );
}

describe("renders nothing on the common path -- no in-progress composer chain", () => {
  test("a bare root (project only, nothing built past it yet) renders nothing", () => {
    const { container } = renderRail(ROOT_ONLY);
    expect(container.firstChild).toBeNull();
  });

  test("a genuinely empty chain renders nothing either", () => {
    const { container } = renderRail({ mode: "projects", segments: [] });
    expect(container.firstChild).toBeNull();
  });
});

describe("once the composer has built something past the root, the chain appears", () => {
  test("both segments are on screen, root first", () => {
    const { getByText } = renderRail(CHAIN);
    expect(getByText("Harbor View Corporate HQ - Interior Fit-out")).toBeTruthy();
    expect(getByText("Work Progress")).toBeTruthy();
  });

  test("the root carries no Remove -- the project can never be cut from here either", () => {
    const { queryByLabelText, getByLabelText } = renderRail(CHAIN);
    expect(
      queryByLabelText("Remove Harbor View Corporate HQ - Interior Fit-out and everything after it")
    ).toBeNull();
    expect(getByLabelText("Remove Work Progress and everything after it")).toBeTruthy();
  });

  test("clicking Remove on a segment calls onCutFrom with that segment's index", () => {
    const seen: number[] = [];
    const { getByLabelText } = renderRail(CHAIN, { onCutFrom: (i) => seen.push(i) });
    fireEvent.click(getByLabelText("Remove Work Progress and everything after it"));
    expect(seen).toEqual([1]);
  });

  test("every control is a word, not a bare glyph -- same rule as ControlStrip", () => {
    const { container } = renderRail(CHAIN);
    for (const btn of Array.from(container.querySelectorAll("button"))) {
      const name = (btn.textContent ?? "").replace(/[✕×↺›‹]/g, "").trim();
      expect(name.length).toBeGreaterThan(0);
    }
  });

  // 2026-09-07 -- found in a full-checklist screenshot/AI-vision re-review:
  // this file originally sized Remove/Back at 32x24, smaller than the 44px
  // minimum R67 A-18 sets and ControlStrip.tsx's own (x)/HOME/Reset/Back all
  // meet -- the same "remove a chain segment" action having two different
  // minimum touch targets depending on which side of the screen it's
  // clicked from. Locks the fix in.
  test("Remove meets the same 44px minimum touch target as ControlStrip's own (R67 A-18)", () => {
    const { getByLabelText } = renderRail(CHAIN);
    const remove = getByLabelText("Remove Work Progress and everything after it") as HTMLButtonElement;
    expect(remove.style.minWidth).toBe("44px");
    expect(remove.style.minHeight).toBe("44px");
  });
});

describe("Back -- the same second entry point ControlStrip.tsx offers", () => {
  test("enabled and calls onBack when there is a segment behind the current one", () => {
    let calls = 0;
    const { getByLabelText } = renderRail(CHAIN, { onBack: () => { calls += 1; } });
    const back = getByLabelText("Back one step") as HTMLButtonElement;
    expect(back.disabled).toBe(false);
    fireEvent.click(back);
    expect(calls).toBe(1);
  });

  test("meets the same 44px minimum touch target as ControlStrip's own Back (R67 A-18)", () => {
    const { getByLabelText } = renderRail(CHAIN);
    const back = getByLabelText("Back one step") as HTMLButtonElement;
    expect(back.style.minWidth).toBe("44px");
    expect(back.style.minHeight).toBe("44px");
  });

  // Root-only/empty chains render nothing at all (see above), so Back is
  // only ever reachable when there is genuinely something behind it --
  // unlike ControlStrip, which always renders and must disable Back itself.
  test("is not reachable at all on the bare-root/empty chains, since the whole rail hides then", () => {
    const { queryByLabelText: q1 } = renderRail(ROOT_ONLY);
    expect(q1("Back one step")).toBeNull();
    const { queryByLabelText: q2 } = renderRail({ mode: "projects", segments: [] });
    expect(q2("Back one step")).toBeNull();
  });
});
