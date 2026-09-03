/// <reference types="bun-types" />
// R67 G-04 (R-231), review fix. PROJEXA's fork of the kit's ControlStrip
// exists for exactly ONE behaviour change, so that behaviour is what this
// suite asserts: the chain's ROOT segment wraps to two lines instead of
// truncating, and every LATER segment still truncates.
//
// Why the root specifically. It used to carry the same `max-w-[22ch] truncate`
// as everything else, so the project the user had just chosen rendered as
// "Cedar Heights Villa - Phas...". That is the answer to "which project am I
// working in", it is the one segment (x) may never remove, and two projects on
// one estate can share their first 22 characters -- so the strip could show an
// identical string for two different roots.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { Chain } from "@fchecklist/veridian-ui-kit/shell";
import { ControlStrip } from "./ControlStrip";

afterEach(cleanup);

const LONG_PROJECT = "Cedar Heights Villa - Phase 2 Structural Works";

const CHAIN: Chain = {
  mode: "projects",
  segments: [
    { id: "p1", label: LONG_PROJECT, kind: "root" },
    { id: "a1", label: "Scope", kind: "action" },
    { id: "s1", label: "Import BOQ from the September revision", kind: "step" },
  ],
};

const noop = () => {};

// REBASE NOTE: onModeChange and onToggleHistory are no longer props. Lane A
// deleted the mode row (A-22) and the composer's HISTORY drop (A-01), so the
// fork's prop surface no longer carries their handlers -- passing them here
// would not merely be dead, it would be a type error.
function renderStrip(chain: Chain = CHAIN) {
  return render(<ControlStrip chain={chain} onCutFrom={noop} onHome={noop} onReset={noop} />);
}

/** The segment buttons, in chain order. HOME/(reset)/Remove are excluded.
 *
 * REBASE NOTE: this used to find a segment by its VISIBLE TEXT. That only
 * worked while every segment rendered its label in full, and the whole point
 * of the tests below is that they no longer do -- a non-root segment is
 * abbreviated on purpose. The lookup is by `title`, which is the full label on
 * every segment and is itself asserted below; the Remove buttons carry a
 * different title ("Remove <label> and everything after it"), so this cannot
 * match one of those by accident. */
function segmentButtons(container: HTMLElement): HTMLButtonElement[] {
  return CHAIN.segments.map((seg) => {
    const found = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("title") === seg.label
    );
    if (!found) throw new Error(`No segment button rendered for "${seg.label}"`);
    return found as HTMLButtonElement;
  });
}

describe("the root segment wraps instead of truncating (G-04)", () => {
  test("the root gets a two-line clamp and NOT `truncate`", () => {
    const { container } = renderStrip();
    const [root] = segmentButtons(container);
    expect(root.className).toContain("[-webkit-line-clamp:2]");
    expect(root.className).toContain("[display:-webkit-box]");
    expect(root.className).not.toContain("truncate");
  });

  test("the root's full name is on hover, so nothing is unreachable", () => {
    const { container } = renderStrip();
    const [root] = segmentButtons(container);
    expect(root.getAttribute("title")).toBe(LONG_PROJECT);
    // The whole name is in the DOM, not an ellipsised copy of it.
    expect(root.textContent).toBe(LONG_PROJECT);
  });

  test("two lines is a CAP -- the strip cannot grow without bound", () => {
    // Beyond two lines the strip would push the composer's own bands down,
    // which is the reflow class R48_LAYOUT_REFLOW_01 was fixed to eliminate.
    const { container } = renderStrip();
    const [root] = segmentButtons(container);
    expect(root.className).not.toContain("[-webkit-line-clamp:3]");
    expect(root.className).toContain("max-w-[34ch]");
    // Left-aligned: a wrapped button's default centring would make a two-line
    // project name read as a heading rather than as a chain segment.
    expect(root.className).toContain("text-left");
  });
});

describe("later segments keep the kit's truncation", () => {
  test("every non-root segment still truncates at 22ch", () => {
    const { container } = renderStrip();
    const [, action, step] = segmentButtons(container);
    for (const seg of [action, step]) {
      expect(seg.className).toContain("truncate");
      expect(seg.className).toContain("max-w-[22ch]");
      expect(seg.className).not.toContain("[-webkit-line-clamp:2]");
    }
  });

  test("they keep their hover title too", () => {
    const { container } = renderStrip();
    const [, , step] = segmentButtons(container);
    expect(step.getAttribute("title")).toBe("Import BOQ from the September revision");
  });
});

describe("the fork changed nothing else about the strip", () => {
  test("the root carries no (x) -- the project cannot be removed", () => {
    // canCutAt() is still the kit's, and this is the rule M24 calls
    // safety-critical: "a user who resets and silently loses project context
    // will act on the wrong project."
    const { queryByLabelText, getByLabelText } = renderStrip();
    expect(queryByLabelText(`Remove ${LONG_PROJECT} and everything after it`)).toBeNull();
    expect(getByLabelText("Remove Scope and everything after it")).toBeDefined();
  });

  // REBASE RECONCILIATION (r67 lane A onto this lane G suite). Lane A removed
  // two of the controls this group asserted. The RULE each assertion was
  // protecting is kept below and now covers the controls that actually exist;
  // what changed is the control set, not the standard.
  test("every control on the strip is a word, not a bare glyph", () => {
    // M24: "NOTHING ON THE STRIP IS AN ICON-ONLY CONTROL." Originally written
    // as HISTORY + HOME + (reset). HISTORY IS GONE, deleted by lane A's A-01:
    // the composer's drop and the Task Master's tab were two controls named
    // History on one screen (the duplicate-control finding correction C-03
    // left standing), and nothing in this repo ever wrote the drop's storage
    // key, so it rendered an empty list for its whole life. The rule itself is
    // now stronger than when G wrote it -- A-18 turned the remaining glyph-only
    // controls into words too -- so this asserts it over the whole strip
    // instead of over three named buttons.
    const { getByText, getByLabelText, getAllByText, container } = renderStrip();
    expect(getByText("HOME")).toBeDefined();
    expect(getByLabelText("Reset the chain")).toBeDefined();
    // One per cuttable segment -- two here, so this must not be getByText.
    expect(getAllByText("Remove").length).toBeGreaterThan(0);
    // No control anywhere on the strip is labelled by a glyph alone.
    for (const btn of Array.from(container.querySelectorAll("button"))) {
      const name = (btn.textContent ?? "").replace(/[✕×↺›]/g, "").trim();
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test("an empty chain prompts rather than looking broken", () => {
    const { getByText } = renderStrip({ mode: "projects", segments: [] });
    expect(getByText("Select a module to begin")).toBeDefined();
  });

  test("no control on the strip is named for an entity mode", () => {
    // WAS: "the three mode pills come from the kit's CHAIN_MODES, unchanged".
    // Lane A's A-22 DELETED that row under owner approval D-10, and the reason
    // is measured rather than aesthetic: on PROJEXA the three pills changed
    // nothing but their own colour, so they were a control that appeared to
    // choose something and did not. The mode is now DERIVED from the chain
    // (deriveMode) and still travels to the server, so nothing downstream
    // changed -- the value travels, the control does not. Asserting their
    // ABSENCE is what keeps them from coming back.
    const { queryByText } = renderStrip();
    for (const label of ["Projects", "Customers", "Vendors"]) {
      expect(queryByText(label)).toBeNull();
    }
  });
});
