/// <reference types="bun-types" />
// R-63 (final audit 2026-10-22): the laptop-first Settings screen showed no currency line when the currencies list had not synced.
// The screen must also make NO request by itself (e2e/lf-lifecycle-vercel-budget.spec.ts: a daily walk stays off Vercel).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

let asked = 0;
let answer: { id: string; code: string; name: string; symbol: string | null; isBaseCurrency: boolean }[] = [];
mock.module("@/lib/currency", () => ({ loadCurrencies: async () => { asked += 1; return answer; } }));

const SettingsLocalScreen = (await import("./SettingsLocalScreen")).default;
const { rememberOrgCurrency, forgetOrgCurrency, recalledOrgCurrency } = await import("@/lib/org-currency-memory");

const base = { name: "A", email: "a@x.com", role: "owner", orgId: "o1", projectCount: 1, categories: { state: "not_synced" }, team: { state: "not_synced" } };
function view(currency: unknown, connectivity: "online" | "offline" = "online") {
  const Screen = SettingsLocalScreen as unknown as (p: unknown) => JSX.Element;
  return render(<Screen data={{ ...base, currency }} shell={{ connectivity }} params={{}} query={new URLSearchParams()} />);
}
beforeEach(() => { asked = 0; answer = []; forgetOrgCurrency(); });
afterEach(() => cleanup());

describe("Settings (laptop-first) currency line", () => {
  test("list not synced but this browser was told the currency before: shows it with who can change it, and asks nobody", async () => {
    rememberOrgCurrency("AED");
    const { getByTestId } = view({ state: "not_synced" });
    await waitFor(() => expect(getByTestId("settings-currency-code").textContent).toBe("Currency: AED — only an owner or administrator can change it."));
    expect(asked).toBe(0);
  });
  test("nothing known, online: says it is not copied yet, makes NO request by itself, and one button asks the server once", async () => {
    answer = [{ id: "c", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }];
    const { getByTestId } = view({ state: "not_allowed" });
    expect(getByTestId("settings-currency-code").textContent).toContain("not copied to this laptop yet");
    expect(getByTestId("settings-currency-code").textContent).toContain("owner or administrator");
    expect(asked).toBe(0);
    fireEvent.click(getByTestId("settings-currency-show"));
    await waitFor(() => expect(getByTestId("settings-currency-code").textContent).toContain("Currency: AED"));
    expect(asked).toBe(1);
  });
  test("the server has no base currency either: 'not set yet' with who can set it", async () => {
    const { getByTestId } = view({ state: "local", value: null });
    fireEvent.click(getByTestId("settings-currency-show"));
    await waitFor(() => expect(getByTestId("settings-currency-code").textContent).toContain("Currency: not set yet"));
  });
  test("offline with nothing known: says so, no button", () => {
    const { getByTestId, queryByTestId } = view({ state: "not_synced" }, "offline");
    expect(getByTestId("settings-currency-code").textContent).toContain("not known on this laptop yet");
    expect(queryByTestId("settings-currency-show")).toBeNull();
  });
  test("the synced value is shown, and remembered for the next time the list is missing", async () => {
    const { getByTestId } = view({ state: "local", value: { id: "c", code: "INR", name: "Rupee", symbol: null } });
    expect(getByTestId("settings-currency-code").textContent).toContain("Currency: INR (Rupee)");
    await waitFor(() => expect(recalledOrgCurrency()).toBe("INR"));
    expect(asked).toBe(0);
  });
});
