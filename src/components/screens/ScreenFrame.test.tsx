/// <reference types="bun-types" />
// R67 D-44's acceptance, asserted on the component that actually implements it.
//
// D-44 says: "the Schedule header band renders Filter | Export | Import | + New
// in that fixed order, and their accessible names are exactly Filter, Export,
// Import, + New". Both halves of that live in this ScreenFrame fork, not in
// ScheduleTabsClient -- the order comes from the fixed slot layout here, and
// the accessible name comes from this file's one behavioural divergence from
// the kit. Until now the acceptance was only exercised indirectly, through a
// consumer test that could pass for the wrong reason (e.g. a consumer that
// happened to pass its actions in the right order into a frame that re-sorted
// them). These pin the frame itself.
//
// WHY THE ACCESSIBLE NAME MATTERS ENOUGH TO FORK FOR. The kit renders a
// disabled action's reason INSIDE the button, so the button's accessible name
// becomes "Import (Not available yet)" -- a screen-reader user hears the reason
// as part of the control's identity, and no acceptance test can name the
// control any more. The fork keeps the reason VISIBLE beside the label (the
// programme's "a greyed-out control must say why" rule) but moves it out of the
// name and into the description, which is where a reason belongs.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

const { ScreenFrame } = await import("./ScreenFrame");

afterEach(() => cleanup());

function renderFrame(overrides: Record<string, unknown> = {}) {
  return render(
    <ScreenFrame
      breadcrumb="Schedule › Cedar Heights Villa - Phase 1"
      filterAction={{ label: "Filter", onClick: () => {} }}
      exportAction={{ label: "Export", onClick: () => {} }}
      extraActions={[{ label: "Import", disabledReason: "Not available yet" }]}
      newAction={{ label: "+ New", onClick: () => {} }}
      messages={[]}
      {...overrides}
    >
      <p>body</p>
    </ScreenFrame>
  );
}

describe("ScreenFrame -- D-44's header band", () => {
  test("renders Filter | Export | Import | + New in that DOM order", () => {
    const { container } = renderFrame();
    const labels = [...container.querySelectorAll("header button")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Filter", "Export", "Import", "+ New"]);
  });

  test("the accessible name of a DISABLED action is the bare label, with the reason as its description", () => {
    const { getByLabelText, container } = renderFrame();
    const importButton = getByLabelText("Import") as HTMLButtonElement;
    expect(importButton.disabled).toBe(true);

    // The name is the label alone -- not "Import (Not available yet)".
    expect(importButton.getAttribute("aria-label")).toBe("Import");

    // ...and the reason is still announced, as the DESCRIPTION.
    const describedBy = importButton.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(container.querySelector(`#${describedBy}`)?.textContent).toBe("(Not available yet)");

    // ...and still VISIBLE, which is the programme's own rule for a greyed-out
    // control, plus repeated in the title for a mouse user.
    expect(importButton.textContent).toContain("Not available yet");
    expect(importButton.getAttribute("title")).toBe("Not available yet");
  });

  test("an ENABLED action carries no reason and no description", () => {
    const { getByLabelText } = renderFrame();
    const filter = getByLabelText("Filter") as HTMLButtonElement;
    expect(filter.disabled).toBe(false);
    expect(filter.getAttribute("aria-describedby")).toBeNull();
    expect(filter.textContent).toBe("Filter");
  });

  test("a disabled action does not fire its onClick", () => {
    let clicks = 0;
    const { getByLabelText } = renderFrame({
      extraActions: [{ label: "Import", disabledReason: "Not available yet", onClick: () => { clicks += 1; } }],
    });
    fireEvent.click(getByLabelText("Import"));
    expect(clicks).toBe(0);
  });

  test("extraActions render in the order GIVEN, and always between Export and + New", () => {
    const { container } = renderFrame({
      extraActions: [
        { label: "Import", disabledReason: "Not available yet" },
        { label: "Baseline", onClick: () => {} },
      ],
    });
    const labels = [...container.querySelectorAll("header button")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Filter", "Export", "Import", "Baseline", "+ New"]);
  });

  test("omitted slots simply do not render -- the order of what is left is unchanged", () => {
    const { container } = renderFrame({ exportAction: undefined, extraActions: undefined });
    const labels = [...container.querySelectorAll("header button")].map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual(["Filter", "+ New"]);
  });

  test("the footer bar is present even with no actions at all, because it carries the message area", () => {
    const { container } = render(
      <ScreenFrame breadcrumb="Schedule" messages={[]}>
        <p>body</p>
      </ScreenFrame>
    );
    expect(container.querySelector("footer")).not.toBeNull();
  });
});
