/// <reference types="bun-types" />
// F_008 ("screen readers cannot associate the visible label text with its
// field") and F_002 ("submit gives zero feedback -- no error text, no
// aria-invalid, no required attribute") are the two halves of one gap. This
// suite proves the shared primitive closes both, in the terms the fault rows
// were actually written in: label association, aria-invalid, required, and a
// message the user can see.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws ("Failed to execute append..." /
// re-registration), and `bun test` runs every file in ONE process -- which is
// why these component suites pass in isolation but blow up in the whole-suite
// run. Register only if no DOM is installed yet.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { FormField, hasErrors } from "./form-field";
import { Input } from "./input";

afterEach(cleanup);

describe("FormField label association (F_008)", () => {
  test("the visible label resolves to its own control", () => {
    const { getByLabelText } = render(
      <FormField label="Title">{(f) => <Input {...f} defaultValue="CO-1" />}</FormField>
    );
    // getByLabelText is exactly the association the fault says is missing: it
    // resolves label -> control through htmlFor/id, nothing else.
    expect((getByLabelText("Title") as HTMLInputElement).value).toBe("CO-1");
  });

  test("two fields on the same screen get distinct ids, so labels don't cross-wire", () => {
    const { getByLabelText } = render(
      <>
        <FormField label="Cost Impact">{(f) => <Input {...f} defaultValue="100" />}</FormField>
        <FormField label="Schedule Impact">{(f) => <Input {...f} defaultValue="7" />}</FormField>
      </>
    );
    const cost = getByLabelText(/Cost Impact/) as HTMLInputElement;
    const schedule = getByLabelText(/Schedule Impact/) as HTMLInputElement;
    expect(cost.id).not.toBe(schedule.id);
    expect(cost.value).toBe("100");
    expect(schedule.value).toBe("7");
  });

  test("a required field is announced as required, not just decorated with an asterisk", () => {
    const { getByLabelText, getByText } = render(
      <FormField label="Name" required>{(f) => <Input {...f} />}</FormField>
    );
    expect(getByLabelText(/Name/).getAttribute("aria-required")).toBe("true");
    // The asterisk itself is hidden from the a11y tree; the sr-only word carries it.
    expect(getByText("(required)")).toBeDefined();
    expect(getByText("*").getAttribute("aria-hidden")).toBe("true");
  });
});

describe("FormField validation feedback (F_002)", () => {
  test("no error means no aria-invalid and no message -- a clean field stays clean", () => {
    const { getByLabelText, queryByRole } = render(
      <FormField label="Unit">{(f) => <Input {...f} />}</FormField>
    );
    expect(getByLabelText("Unit").getAttribute("aria-invalid")).toBeNull();
    expect(queryByRole("alert")).toBeNull();
  });

  test("an error sets aria-invalid, renders the message, and points the field at it", () => {
    const { getByLabelText, getByRole } = render(
      <FormField label="Unit" required error="Unit is required (e.g. bag, cum, kg).">
        {(f) => <Input {...f} />}
      </FormField>
    );
    const input = getByLabelText(/Unit/);
    expect(input.getAttribute("aria-invalid")).toBe("true");

    const alert = getByRole("alert");
    expect(alert.textContent).toBe("Unit is required (e.g. bag, cum, kg).");
    // role="alert" alone is not enough -- the field must reference the message
    // so a screen reader reads them together, not as two unrelated things.
    expect(input.getAttribute("aria-describedby")).toContain(alert.id);
  });

  test("hint text is associated too, and coexists with an error", () => {
    const { getByLabelText, getByText } = render(
      <FormField label="Annual Amount" hint="Whole currency units." error="Annual amount is required.">
        {(f) => <Input {...f} />}
      </FormField>
    );
    const describedBy = getByLabelText(/Annual Amount/).getAttribute("aria-describedby") ?? "";
    expect(describedBy.split(" ")).toContain(getByText("Whole currency units.").id);
    expect(describedBy.split(" ")).toContain(getByText("Annual amount is required.").id);
  });
});

describe("hasErrors", () => {
  test("an empty map means go ahead", () => {
    expect(hasErrors({})).toBe(false);
  });
  test("an explicitly-undefined key is not an error", () => {
    expect(hasErrors({ name: undefined })).toBe(false);
  });
  test("any message present blocks submit", () => {
    expect(hasErrors({ name: "Name is required." })).toBe(true);
  });
});
