/// <reference types="bun-types" />
// R-63 (final audit 2026-10-22): the laptop-first Settings screen showed no currency line when the currencies list had not synced.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

let money: { currency: string | null; loaded: boolean } = { currency: null, loaded: true };
mock.module("@/lib/use-org-money", () => ({ useOrgMoney: () => money }));

const SettingsLocalScreen = (await import("./SettingsLocalScreen")).default;

const base = { name: "A", email: "a@x.com", role: "owner", orgId: "o1", projectCount: 1, categories: { state: "not_synced" }, team: { state: "not_synced" } };
function view(currency: unknown, connectivity: "online" | "offline" = "online") {
  const Screen = SettingsLocalScreen as unknown as (p: unknown) => JSX.Element;
  return render(<Screen data={{ ...base, currency }} shell={{ connectivity }} params={{}} query={new URLSearchParams()} />);
}
afterEach(() => cleanup());

describe("Settings (laptop-first) currency line", () => {
  test("list not synced: falls back to the organisation currency and says who can change it", () => {
    money = { currency: "AED", loaded: true };
    const { getByTestId } = view({ state: "not_synced" });
    expect(getByTestId("settings-currency-code").textContent).toBe("Currency: AED — only an owner or administrator can change it.");
  });
  test("role not allowed to read the list: still shows the currency", () => {
    money = { currency: "AED", loaded: true };
    expect(view({ state: "not_allowed" }).getByTestId("settings-currency-code").textContent).toContain("Currency: AED");
  });
  test("copy has no base row and the server has none either: 'not set yet' with who can set it", () => {
    money = { currency: null, loaded: true };
    const t = view({ state: "local", value: null }).getByTestId("settings-currency-code").textContent ?? "";
    expect(t).toContain("Currency: not set yet");
    expect(t).toContain("owner or administrator");
  });
  test("offline with nothing known: says it is not known on this laptop yet, never a blank", () => {
    money = { currency: null, loaded: true };
    expect(view({ state: "not_synced" }, "offline").getByTestId("settings-currency-code").textContent).toContain("not known on this laptop yet");
  });
  test("the synced value is used when present (no fallback needed)", () => {
    money = { currency: "XXX", loaded: true };
    expect(view({ state: "local", value: { id: "c", code: "INR", name: "Rupee", symbol: null } }).getByTestId("settings-currency-code").textContent).toContain("Currency: INR (Rupee)");
  });
});
