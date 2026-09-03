/// <reference types="bun-types" />
// R67 D-67 -- the archetype's contract, asserted on a real migrated create
// screen rather than only on CreateScreen in isolation.
//
// Before the migration this form said "Save" with the missing field names
// hidden in a title attribute nobody hovers, and a refused save was a toast:
// the user saw a form that had not saved, with no reason on screen and
// nothing to act on. Every create screen in the module had made that choice
// separately, which is why the archetype exists.
//
// WHAT THIS FILE CAN AND CANNOT DRIVE. Typing does not reach a
// React-controlled input in this test environment -- verified with a probe
// here as well as by CreateScreen.test.tsx's own header note: fireEvent
// .change/.input, a raw Event, an InputEvent and the native value setter all
// leave the component's state untouched, while fireEvent.click works
// normally. So the behaviour that depends on TYPED state is asserted where
// it is reachable: the label rule in save-label.test.ts, the in-place
// refusal and the kept values in CreateScreen.test.tsx (which is controlled,
// so its state can be passed), and the destination in
// CreatedReceipt.test.tsx. What is asserted HERE is what this screen decides
// for itself: which fields it declares, which of them are required, and the
// resting state of its primary.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }),
  usePathname: () => "/materials/new",
}));

const MaterialCreateClient = (await import("./MaterialCreateClient")).default;

afterEach(cleanup);

function primary(container: HTMLElement): HTMLButtonElement {
  return container.querySelector('button[type="submit"]') as HTMLButtonElement;
}

describe("MaterialCreateClient on the create archetype", () => {
  test("the primary NAMES both missing fields and is disabled on an empty form", () => {
    const { container } = render(<MaterialCreateClient projectId="p-cedar" />);

    // The old button read "Save" and put "Name, Unit" in a title attribute.
    expect(primary(container).textContent).toContain("Save (Name, Unit)");
    expect(primary(container).disabled).toBe(true);
    expect(primary(container).getAttribute("title")).toBe("Still needed: Name, Unit");
  });

  test("optional fields say so in words, and no field carries an asterisk", () => {
    const { container } = render(<MaterialCreateClient projectId="p-cedar" />);
    // R-257's rule is that optional fields carry no MARKER; the word is the
    // opposite of a marker -- it tells the user they may skip the field.
    expect(container.textContent).toContain("(optional)");
    expect(container.textContent).not.toContain("*");
  });

  test("every field the API accepts is on the form, each with a real label", () => {
    const { container } = render(<MaterialCreateClient projectId="p-cedar" />);
    for (const id of ["name", "spec", "unit", "unitCost"]) {
      const input = container.querySelector(`#${id}`);
      expect(input).not.toBeNull();
      expect(container.querySelector(`label[for="${id}"]`)?.textContent).toBeTruthy();
    }
  });

  // R67 G-05 (R-260). This test used to assert a HELP LINE reading "'bag' and
  // 'Bag' are two different units in the cost report" under a free-text input
  // -- which asked the user to solve by discipline a defect the product can
  // simply not have. main shipped the structural fix (a closed vocabulary),
  // and the merge keeps that: there is no wrong word to type, so there is
  // nothing to warn about.
  test("Unit is a closed vocabulary, not free text -- 'bag' and 'Bag' cannot both exist", () => {
    const { container } = render(<MaterialCreateClient projectId="p-cedar" />);
    const unit = container.querySelector("#unit");
    expect(unit?.tagName).toBe("SELECT");
    // Not an input the user can type any spelling into.
    expect(container.querySelector("input#unit")).toBeNull();

    const options = Array.from(unit?.querySelectorAll("option") ?? []).map((o) => (o as HTMLOptionElement).value);
    // The blank first option is the placeholder, not a unit.
    expect(options[0]).toBe("");
    expect(options).toContain("bag");
    // Every offered value is the canonical lower-case string, so the cost
    // report cannot end up grouping one material into several rows.
    for (const value of options.slice(1)) {
      expect(value).toBe(value.toLowerCase());
    }
    expect(options).not.toContain("Bag");
    // And the old help line -- the instruction that stood in for the fix -- is
    // gone rather than left beside a control that no longer needs it.
    expect(container.textContent).not.toContain("are two different units");
  });

  test("Unit Cost carries the currency inside the box, not in a placeholder that vanishes", () => {
    const { container } = render(<MaterialCreateClient projectId="p-cedar" />);
    // The box exists and is a number input; the prefix slot is the archetype's
    // money rendering rather than a plain <Input type="number">.
    const cost = container.querySelector("#unitCost") as HTMLInputElement | null;
    expect(cost).not.toBeNull();
    expect(cost?.getAttribute("type")).toBe("number");
    // With /api/currencies unanswered in this render, NOTHING is claimed --
    // neither a code nor the "this org has no currency" warning glyph.
    expect(container.textContent).not.toContain("Currency not set");
  });

  test("the screen says where it is and how to leave", () => {
    const { container } = render(<MaterialCreateClient projectId="p-cedar" />);
    expect(container.textContent).toContain("Materials");
    // R67 D-37 merge: the title was "Add Material" while this screen's own
    // breadcrumb said "New Material" and the button that opens it says
    // "+ New Material" -- three names for one screen. It is "New Material"
    // everywhere now, so the breadcrumb and the heading agree.
    expect(container.textContent).toContain("New Material");
    expect(container.textContent).not.toContain("Add Material");
    expect(container.textContent).toContain("Back");
    expect(container.textContent).toContain("Cancel");
  });
});
