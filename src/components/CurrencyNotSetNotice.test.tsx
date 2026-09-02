/// <reference types="bun-types" />
// R67 G-05, review fix. The notice has three jobs and exactly one of them is
// to appear: it must say CURRENCY_NOT_SET_NOTICE verbatim when the org has no
// currency, render NOTHING when it has one, and -- the regression this suite
// was added for -- render nothing while the answer is still in flight. Without
// that third state it asserted "Currency not set" on every page load, for
// every org, including the ones that have a currency.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { CurrencyNotSetNotice } from "./CurrencyNotSetNotice";
import { CURRENCY_NOT_SET_NOTICE } from "@/lib/format-money";

afterEach(cleanup);

describe("CurrencyNotSetNotice", () => {
  test("says the sentence R-260 words, verbatim, when the org has no currency", () => {
    const { container } = render(<CurrencyNotSetNotice currencySet={false} />);
    // Normalised, because the sentence is split around a real <Link>.
    expect(container.textContent?.replace(/\s+/g, " ").trim()).toBe(CURRENCY_NOT_SET_NOTICE);
    expect(CURRENCY_NOT_SET_NOTICE).toBe("Currency not set → Settings");
  });

  test("the destination is a real link to /settings, not a dead word", () => {
    const { getByRole } = render(<CurrencyNotSetNotice currencySet={false} />);
    const link = getByRole("link", { name: "Settings" });
    expect(link.getAttribute("href")).toBe("/settings");
  });

  test("renders nothing at all once the org HAS a currency", () => {
    const { container } = render(<CurrencyNotSetNotice currencySet />);
    expect(container.innerHTML).toBe("");
  });

  test("renders nothing while the currency is still loading -- the regression", () => {
    // currencySet is false during the whole in-flight window, so without the
    // `loaded` flag this is the render every screen made on every page load.
    const { container } = render(<CurrencyNotSetNotice currencySet={false} loaded={false} />);
    expect(container.innerHTML).toBe("");
  });

  test("loaded defaults to true, so a Server Component needs no flag", () => {
    // DashboardHomeView resolves the currency server-side and has no loading
    // window at all; it must keep working with the two-argument call.
    const { container } = render(<CurrencyNotSetNotice currencySet={false} />);
    expect(container.textContent).toContain("Currency not set");
  });

  test("paints from a status token, so dark mode follows it", () => {
    const { container } = render(<CurrencyNotSetNotice currencySet={false} />);
    const p = container.querySelector("p");
    expect(p?.getAttribute("style")).toContain("var(--status-needs-you-text)");
  });
});
