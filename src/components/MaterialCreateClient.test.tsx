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

  test("the unit field explains the trap that split the cost report", () => {
    // 'bag' and 'Bag' were two units in the same project, and the cost
    // report added them up separately.
    const { container } = render(<MaterialCreateClient projectId="p-cedar" />);
    expect(container.textContent).toContain("'bag' and 'Bag' are two different units");
  });

  test("the screen says where it is and how to leave", () => {
    const { container } = render(<MaterialCreateClient projectId="p-cedar" />);
    expect(container.textContent).toContain("Materials");
    expect(container.textContent).toContain("Add Material");
    expect(container.textContent).toContain("Back");
    expect(container.textContent).toContain("Cancel");
  });
});
