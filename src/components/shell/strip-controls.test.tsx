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

  test("Pin reads 'Pin', and 'Pinned' once it is set", () => {
    const { getByText } = renderPillStrip();
    const pin = getByText("Pin").closest("button")!;
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    expect(pin.getAttribute("aria-label")).toBe("Pin Record progress so it never drops off");

    const pinned = getByText("Pinned").closest("button")!;
    expect(pinned.getAttribute("aria-pressed")).toBe("true");
    expect(pinned.getAttribute("aria-label")).toBe("Pinned: Run WPR");
  });

  test("the loaded-chain pin carries the word too", () => {
    const { getByText } = renderControlStrip(true);
    const pin = getByText("Pin").closest("button")!;
    expect(pin.getAttribute("aria-pressed")).toBe("false");
    expect(pin.getAttribute("aria-label")).toBe("Pin this loaded chain so it survives navigation");
  });

  test("no button anywhere in either strip renders a bare glyph as its text", () => {
    const strips = [renderControlStrip(true).container, renderPillStrip().container];
    for (const container of strips) {
      for (const button of container.querySelectorAll("button")) {
        const visible = (button.textContent ?? "").replace(/[^\p{L}\p{N}]/gu, "").trim();
        expect(visible.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("44 px minimums, on the elements that produce the box", () => {
  const atLeast44 = (button: HTMLElement) => {
    expect(button.style.minWidth).toBe("44px");
    expect(button.style.minHeight).toBe("44px");
  };

  test("Reset, Remove and HOME", () => {
    const { getByText, getAllByText } = renderControlStrip();
    atLeast44(getByText("Reset").closest("button")!);
    atLeast44(getByText("HOME").closest("button")!);
    for (const remove of getAllByText("Remove")) atLeast44(remove.closest("button")!);
  });

  test("Pin, in both of its states", () => {
    const { getByText } = renderPillStrip();
    atLeast44(getByText("Pin").closest("button")!);
    atLeast44(getByText("Pinned").closest("button")!);
  });

  test("and the loaded-chain pin", () => {
    const { getByText } = renderControlStrip(true);
    atLeast44(getByText("Pin").closest("button")!);
  });
});
