/// <reference types="bun-types" />
// R67 WS-A (A-18) -- EVERY CONTROL IN THE COMPOSER'S TWO STRIPS CARRIES A WORD.
//
// A-18's own acceptance is in two halves. The first -- "rendering PillStrip and
// ControlStrip and dumping the accessibility tree yields no button whose
// accessible name is empty or a single non-letter glyph" -- is a component test
// and is run here, for real, against the real components.
//
// The second half is a Playwright bounding-box assertion against a dev server
// this lane may not start. happy-dom does no layout, so a bounding box here
// would be 0 x 0 whatever the CSS says and asserting one would be theatre. What
// IS asserted is the thing that produces the box: the inline minimum on the
// element itself. A rendered box smaller than that is then a stylesheet
// override, which is a different defect from the one this item is about.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process. Register only if no DOM is installed yet.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ControlStrip } from "./ControlStrip";
import { PillStrip, type CardView } from "./PillStrip";
import { ALL_PROJECTS_LABEL, TopRail } from "./TopRail";

afterEach(cleanup);

const CHAIN = {
  mode: "projects" as const,
  segments: [
    { id: "p1", label: "Cedar Heights Villa - Phase 1", kind: "root" as const },
    { id: "permits", label: "Permits", kind: "action" as const },
    { id: "permits.new", label: "New", kind: "step" as const },
  ],
};

const CARDS: readonly CardView[] = [
  {
    id: "work-progress.entry",
    label: "Record progress",
    kindWord: "Record",
    kindGlyph: "✎",
    pinned: false,
    disabledReason: null,
  },
  { id: "work-progress.report", label: "Run WPR", kindWord: "Run", kindGlyph: "▶", pinned: true, disabledReason: null },
];

function renderControlStrip(loaded = false) {
  return render(
    <ControlStrip
      chain={CHAIN}
      onCutFrom={() => {}}
      onBack={() => {}}
      onHome={() => {}}
      onReset={() => {}}
      prompt=""
      loaded={loaded ? { from: "Work Progress", pinned: false, onTogglePin: () => {} } : null}
    />
  );
}

function renderPillStrip() {
  return render(
    <PillStrip
      cards={CARDS}
      onSelect={() => {}}
      onTogglePin={() => {}}
      expanded={false}
      onToggleExpanded={() => {}}
      allModules={[{ id: "permits", label: "Permits", shortcut: "Alt+P" }]}
      onSelectModule={() => {}}
    />
  );
}

/** The accessible name as the two components can actually produce one: an
 *  explicit aria-label, else the button's own text. */
function accessibleName(button: HTMLElement): string {
  return (button.getAttribute("aria-label") ?? button.textContent ?? "").trim();
}

const LETTER = /\p{L}/u;

describe("A-18's own acceptance: no button is named by a glyph alone", () => {
  test("the control strip's buttons all have real names", () => {
    const { container } = renderControlStrip(true);
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(3);
    for (const button of buttons) {
      const name = accessibleName(button);
      expect(name.length).toBeGreaterThan(0);
      // "a single non-letter glyph" -- ×, ↺, ☆ -- is exactly what this rules out.
      expect(name.length === 1 && !LETTER.test(name)).toBe(false);
    }
  });

  test("the pill strip's buttons all have real names", () => {
    const { container } = renderPillStrip();
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons.length).toBeGreaterThan(3);
    for (const button of buttons) {
      const name = accessibleName(button);
      expect(name.length).toBeGreaterThan(0);
      expect(name.length === 1 && !LETTER.test(name)).toBe(false);
    }
  });
});

describe("the three named controls carry their word, visibly", () => {
  test("Reset is the word, not '↺'", () => {
    const { getByText } = renderControlStrip();
    const reset = getByText("Reset").closest("button")!;
    expect(reset).not.toBeNull();
    // The glyph survives beside the word, as decoration only.
    expect(reset.textContent).toContain("Reset");
    expect(reset.querySelector("[aria-hidden]")?.textContent).toBe("↺");
    // The hover title is supplementary now, never the sole label.
    expect(reset.getAttribute("title")).toBe("Reset the chain");
  });

  test("Remove is the word, and its accessible name still says what will happen", () => {
    const { getAllByText } = renderControlStrip();
    const removes = getAllByText("Remove").map((el) => el.closest("button")!);
    // The root is never cuttable, so only the two user-built segments get one.
    expect(removes.length).toBe(2);
    expect(removes[0].getAttribute("aria-label")).toBe("Remove Permits and everything after it");
    // "label in name": the visible word is the first word of the name.
    expect(removes[0].getAttribute("aria-label")!.startsWith("Remove")).toBe(true);
  });

  // 2026-09-07 -- VISUAL-ONLY re-skin to match the frozen mock (owner
  // direction): the pill strip's own Pin is now a small star icon, matching
  // the mock, not a visible "Pin"/"Pinned" text button. The word is NOT
  // gone -- it is still the full accessible name and the hover title,
  // exactly what a screen reader and a mouse-hover both already read from
  // before. This test now asserts the accessible name carries the word,
  // which is A-18's actual rule; the CONTROL STRIP's own separate
  // loaded-chain Pin (below) is unchanged and still visible text, since the
  // mock never depicted that state.
  test("the pill strip's Pin carries the word in its accessible name, in both states", () => {
    const { container } = renderPillStrip();
    const pin = [...container.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Pin Record progress so it never drops off"
    )!;
    expect(pin).not.toBeUndefined();
    expect(pin.getAttribute("aria-pressed")).toBe("false");

    const pinned = [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Pinned: Run WPR")!;
    expect(pinned).not.toBeUndefined();
    expect(pinned.getAttribute("aria-pressed")).toBe("true");
  });

  test("the loaded-chain pin carries the word too", () => {
    const { getByText } = renderControlStrip(true);
    const pin = getByText("Pin").closest("button")!;
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    expect(pin.getAttribute("aria-label")).toBe("Pin this loaded chain so it survives navigation");
  });

  // 2026-09-07 -- updated for the same reason as the Pin test above: the
  // pill strip's Pin and its per-card kind indicator are now icon-only by
  // design (matching the mock), so "some visible text" is no longer the
  // right invariant for every button. What still must hold, everywhere,
  // is A-18's actual rule -- a real accessible name, not a bare glyph as
  // the NAME -- which is exactly what the describe block above this one
  // already asserts. This test is narrowed to what the mock did not
  // change: every card's own LABEL (its subject -- "Record progress",
  // "Run WPR") still prints as real visible words, never hidden behind an
  // icon alone.
  test("every card's own label still prints as visible words, never hidden behind an icon alone", () => {
    const { getByText } = renderPillStrip();
    expect(getByText("Record progress")).not.toBeUndefined();
    expect(getByText("Run WPR")).not.toBeUndefined();
  });
});

describe("44 px minimums, on the elements that produce the box", () => {
  const atLeast44 = (button: HTMLElement) => {
    expect(button.style.minWidth).toBe("44px");
    expect(button.style.minHeight).toBe("44px");
  };

  test("Reset, Remove and Home", () => {
    const { getByText, getAllByText } = renderControlStrip();
    atLeast44(getByText("Reset").closest("button")!);
    // 2026-09-07: "HOME" -> "Home", sentence case per the frozen mock.
    atLeast44(getByText("Home").closest("button")!);
    for (const remove of getAllByText("Remove")) atLeast44(remove.closest("button")!);
  });

  // 2026-09-07 -- the pill strip's Pin now overrides `.veri-icon-btn`'s
  // normal fixed 30x30 with an explicit width/height (not min-width/
  // min-height -- an explicit `width` on the class would otherwise ignore
  // a min-width), so this asserts THAT property instead of `atLeast44`'s
  // min-width/min-height, on the same two states as before.
  test("Pin, in both of its states", () => {
    const { container } = renderPillStrip();
    const buttons = [...container.querySelectorAll("button")];
    const pin = buttons.find((b) => b.getAttribute("aria-label") === "Pin Record progress so it never drops off")!;
    const pinned = buttons.find((b) => b.getAttribute("aria-label") === "Pinned: Run WPR")!;
    for (const button of [pin, pinned]) {
      expect(button.style.width).toBe("44px");
      expect(button.style.height).toBe("44px");
    }
  });

  test("and the loaded-chain pin", () => {
    const { getByText } = renderControlStrip(true);
    atLeast44(getByText("Pin").closest("button")!);
  });
});

// R67 WS-A (A-16), review fix -- THE THIRD FORK GETS A RENDER TEST.
//
// TopRail was forked for ONE reason: the kit types `organisationName` as a
// string, so the slot could not hold "Organisation unavailable" AND the control
// that retries it -- which is why the bare em-dash was on screen in the first
// place. organisationLabel()'s three states are already asserted in
// shell-resilience.test.ts; what was not asserted anywhere is that the widened
// slot really renders a control, which is the entire point of the fork.
describe("TopRail's organisation slot is a node, not a string", () => {
  test("a message and its Retry control both render, and Retry is reachable", () => {
    let retried = 0;
    const { getByText, getByRole } = render(
      <TopRail
        brand={<span>PROJEXA</span>}
        organisation={
          <>
            <span>Organisation unavailable</span>
            <button type="button" onClick={() => retried++}>
              Retry
            </button>
          </>
        }
        project={null}
        onSwitchProject={() => {}}
      />
    );
    expect(getByText("Organisation unavailable")).toBeDefined();
    const retry = getByRole("button", { name: "Retry" });
    retry.click();
    expect(retried).toBe(1);
    // M24's null state survives beside it: org-level work stays reachable.
    expect(getByText(ALL_PROJECTS_LABEL)).toBeDefined();
  });

  test("a plain organisation name still renders as a name", () => {
    const { getByText } = render(
      <TopRail
        brand={<span>PROJEXA</span>}
        organisation={<span>Skyline Builders</span>}
        project={{ id: "p1", name: "Cedar Heights Villa - Phase 1" }}
        onSwitchProject={() => {}}
      />
    );
    expect(getByText("Skyline Builders")).toBeDefined();
    expect(getByText("Cedar Heights Villa - Phase 1")).toBeDefined();
  });
});
