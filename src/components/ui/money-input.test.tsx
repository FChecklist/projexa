/// <reference types="bun-types" />
// R67 G-05, review fix. MoneyInput's whole claim is that the currency sits
// INSIDE the box, beside the caret, permanently -- a placeholder disappears on
// the first keystroke, which is exactly when the user most needs to know what
// unit they are typing. Three things have to hold for that claim to be true:
// the prefix is rendered and is the code; the prefix is NOT part of the value
// a caller POSTs; and it does not claim "no currency" before the answer has
// arrived.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MoneyInput } from "./money-input";
import { UNKNOWN_CURRENCY_GLYPH } from "@/lib/format-money";

afterEach(cleanup);

const prefixOf = (container: HTMLElement) =>
  container.querySelector('[data-testid="money-input-prefix"]')?.textContent ?? null;

describe("the fixed currency prefix", () => {
  test("shows the org's CODE, never a symbol", () => {
    const { container } = render(<MoneyInput currency="AED" aria-label="Unit Cost" />);
    expect(prefixOf(container)).toBe("AED");
    expect(prefixOf(container)).not.toContain("د.إ");
  });

  test("is hidden from assistive tech -- the label carries the currency instead", () => {
    // A screen reader should hear "Unit Cost, AED", not "AED" as a stray word
    // in front of an unlabelled box.
    const { container } = render(<MoneyInput currency="AED" aria-label="Unit Cost (AED)" />);
    const prefix = container.querySelector('[data-testid="money-input-prefix"]');
    expect(prefix?.getAttribute("aria-hidden")).toBe("true");
  });

  test("falls back to the warning glyph when the org has no currency", () => {
    const { container } = render(<MoneyInput currency={null} aria-label="Unit Cost" />);
    expect(prefixOf(container)).toBe(UNKNOWN_CURRENCY_GLYPH);
  });

  test("shows NOTHING while the currency is still loading -- the regression", () => {
    // ⚠ is a claim ("this org has no currency"). During the first paint that
    // claim has not been earned, and for most orgs it is simply false.
    const { container } = render(<MoneyInput currency={null} pending aria-label="Unit Cost" />);
    expect(container.querySelector('[data-testid="money-input-prefix"]')).toBeNull();
  });

  test("a real currency wins over `pending`", () => {
    const { container } = render(<MoneyInput currency="AED" pending aria-label="Unit Cost" />);
    expect(prefixOf(container)).toBe("AED");
  });

  test("a blank currency string is treated as no currency, not as a blank prefix", () => {
    const { container } = render(<MoneyInput currency="   " aria-label="Unit Cost" />);
    expect(prefixOf(container)).toBe(UNKNOWN_CURRENCY_GLYPH);
  });
});

describe("the prefix is decoration, not data", () => {
  test("the value the field holds is the bare number, with no currency in it", () => {
    // The claim this file exists to check: the prefix is CHROME, not content.
    // If "AED" ever leaked into the value, every call site would have to strip
    // it before POSTing -- and MaterialCreateClient / MaterialObjectClient
    // both pass the value straight to Number().
    const { getByLabelText, container } = render(
      <MoneyInput currency="AED" aria-label="Unit Cost" value="12.50" onChange={() => {}} />
    );
    const input = getByLabelText("Unit Cost") as HTMLInputElement;
    expect(input.value).toBe("12.50");
    expect(Number(input.value)).toBe(12.5);
    // ...and the prefix is a SIBLING of the field, not inside it.
    const prefix = container.querySelector('[data-testid="money-input-prefix"]');
    expect(prefix).not.toBeNull();
    expect(prefix!.contains(input)).toBe(false);
    expect(input.contains(prefix)).toBe(false);
  });

  test("the caller's props reach the FIELD, not the wrapper", () => {
    // MaterialCreateClient passes `id` so its <Label htmlFor> resolves, and
    // both call sites pass value/onChange. A wrapper component that forgot to
    // spread would break the label association and the form silently.
    const { container } = render(
      <MoneyInput currency="AED" id="material-unit-cost" placeholder="0.00" disabled value="" onChange={() => {}} />
    );
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.id).toBe("material-unit-cost");
    expect(input.getAttribute("placeholder")).toBe("0.00");
    expect(input.disabled).toBe(true);
    // The wrapper keeps none of them -- otherwise `htmlFor` would point at a
    // div and clicking the label would focus nothing.
    expect((container.firstElementChild as HTMLElement).id).toBe("");
  });

  test("it is a real number field with a 0.01 step, so a rate can carry fils", () => {
    const { getByLabelText } = render(<MoneyInput currency="AED" aria-label="Unit Cost" />);
    const input = getByLabelText("Unit Cost") as HTMLInputElement;
    expect(input.getAttribute("type")).toBe("number");
    expect(input.getAttribute("step")).toBe("0.01");
    expect(input.getAttribute("inputmode")).toBe("decimal");
  });

  test("the number is right-aligned with tabular figures, like every money CELL", () => {
    const { getByLabelText } = render(<MoneyInput currency="AED" aria-label="Unit Cost" />);
    const cls = (getByLabelText("Unit Cost") as HTMLInputElement).className;
    expect(cls).toContain("text-right");
    expect(cls).toContain("tabular-nums");
  });
});
