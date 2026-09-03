/// <reference types="bun-types" />
// R67 D-62 / correction C-15. The item's acceptance is a Playwright run against
// a local dev server, which this lane may not start, so the two assertions are
// made here against the rendered component with the lookup calls stubbed:
//
//   * the primary button's text is exactly "Save (needs a fiscal year and an
//     account)" -- not the 30-word sentence that used to sit inside it;
//   * a link labelled "Set up in VERIDIAN" is present in the banner above it.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
// R67 lane A merge: the real module is spread in rather than replaced. Lane A
// mounts <ObjectContext>/<ScreenContext> inside these screens, and those call
// usePathname() -- a mock that returned only useRouter made the whole module
// lose every other export and the file failed to load at all
// ("Export named 'usePathname' not found in module .../next/navigation.js").
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({ ...realNavigation, useRouter: () => ({ push }) }));

// The screen loads four lookups on mount. Every test here is about what it says
// when they come back EMPTY, which is the real demo-org state C-15 records.
const originalFetch = globalThis.fetch;

const mod = await import("./BudgetCreateClient");
const BudgetCreateClient = mod.default;
const { blockedBanner, erpSetupHref, shortBlockedReason, VERIDIAN_ERP_SETUP_PATH } = mod;

beforeEach(() => {
  globalThis.fetch = mock(async () =>
    new Response(JSON.stringify({ fiscalYears: [], costCenters: [], accounts: [], companies: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  push.mockClear();
  globalThis.fetch = originalFetch;
});

describe("shortBlockedReason", () => {
  test("both missing reads exactly as C-15 specifies", () => {
    expect(shortBlockedReason(["fiscal years", "a chart of accounts"])).toBe("needs a fiscal year and an account");
  });

  test("names only what is actually missing", () => {
    expect(shortBlockedReason(["fiscal years"])).toBe("needs a fiscal year");
    expect(shortBlockedReason(["a chart of accounts"])).toBe("needs an account");
  });

  test("the long sentence still exists -- it moved to the banner, it was not deleted", () => {
    const banner = blockedBanner(["fiscal years", "a chart of accounts"]);
    expect(banner).toContain("This organisation has no fiscal years and a chart of accounts");
    expect(banner.split(" ").length).toBeGreaterThan(20);
  });
});

describe("erpSetupHref", () => {
  test("builds the real ERP setup URL from the VERIDIAN origin", () => {
    expect(erpSetupHref("https://veridian-compliance-ai.vercel.app")).toBe(
      `https://veridian-compliance-ai.vercel.app${VERIDIAN_ERP_SETUP_PATH}`
    );
  });

  test("a trailing slash does not produce a double slash", () => {
    expect(erpSetupHref("https://example.test/")).toBe(`https://example.test${VERIDIAN_ERP_SETUP_PATH}`);
  });

  test("no origin means no link -- a link to nowhere is worse than none", () => {
    expect(erpSetupHref(null)).toBeNull();
    expect(erpSetupHref(undefined)).toBeNull();
    expect(erpSetupHref("   ")).toBeNull();
  });
});

describe("BudgetCreateClient with no fiscal years and no chart of accounts", () => {
  test("the primary button carries four words, not a paragraph", async () => {
    const view = render(<BudgetCreateClient veridianOrigin="https://veridian-compliance-ai.vercel.app" />);
    await waitFor(() => {
      const save = view.getByRole("button", { name: /^Save/ }) as HTMLButtonElement;
      expect(save.textContent).toBe("Save (needs a fiscal year and an account)");
      expect(save.disabled).toBe(true);
    });
  });

  test("the banner keeps the full explanation AND offers the way out", async () => {
    const view = render(<BudgetCreateClient veridianOrigin="https://veridian-compliance-ai.vercel.app" />);
    await waitFor(() => {
      const link = view.getByRole("link", { name: "Set up in VERIDIAN" }) as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe(
        `https://veridian-compliance-ai.vercel.app${VERIDIAN_ERP_SETUP_PATH}`
      );
      expect(view.getByRole("alert").textContent).toContain("This organisation has no fiscal years");
    });
  });

  test("the link is withheld when no VERIDIAN origin was resolvable", async () => {
    const view = render(<BudgetCreateClient veridianOrigin={null} />);
    await waitFor(() => {
      expect(view.getByRole("alert")).toBeTruthy();
    });
    expect(view.queryByRole("link", { name: "Set up in VERIDIAN" })).toBeNull();
  });
});
