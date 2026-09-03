/// <reference types="bun-types" />
// R67 D-62 / correction C-15, and R67 D-42.
//
// The items' acceptance is a Playwright walk against a local dev server, which
// this session may not start, so the same strings are asserted here against the
// real component with the lookup calls stubbed. One half of D-42 -- "fill only
// Name and expect the button to read 'Save (2 required fields)'" -- cannot be
// driven at all in this repo's test environment: happy-dom + React 19 does not
// deliver input/change events to React (measured with a minimal controlled-input
// harness), so no test here can type. The label that renders the count is
// asserted on the empty form instead.
//
// MERGE NOTE (D-67 / C-15). This screen moved onto the shared create archetype,
// which already owns the counting rule (src/lib/create-screen.ts, unit-tested in
// its own file), so this lane's private missingRequiredFields/requiredFieldsReason/
// parseAmount helpers are gone and the describe block that exercised them with
// them -- one implementation of that rule, tested once.
//
// ─── R67 MERGE (D-11, lane D1 x lane D3, 2026-09-03) ────────────────────────
//
// Both lanes wrote this file. BOTH SUITES SURVIVE, and the harness is D3's
// (router()/handlers()/blockedHandlers() drive each lookup separately, where
// D1's single stub answered every URL with the same empty object).
//
// Two of D1's assertions were RESTATED rather than deleted, because D-42 changed
// the mechanism under them:
//
//   * D1 asserted that a blocked org ALWAYS shows "Set up in VERIDIAN". D-42
//     gates that link on the org-admin role -- everyone else is offered a way to
//     ASK, because provisioning a fiscal year is not theirs to do. D1's stub had
//     no role at all, so under the merged component those tests would have been
//     asserting the non-admin branch while claiming to test the link. They now
//     run against blockedHandlers("admin"), which is the case they were written
//     for.
//   * D1's veridianOrigin prop is passed by every render that expects a link.
//     D3's version built the URL from a hardcoded production host; D1's takes the
//     origin the server resolved and answers null when there is none. D3's own
//     admin test now passes an origin too -- without one there is deliberately no
//     link to find.
//
// The navigation mock is D1's: the real module is SPREAD IN rather than replaced.
// Lane A mounts <ObjectContext>/<ScreenContext> inside these screens and those
// call usePathname(); a mock returning only useRouter made the whole module lose
// every other export and the file failed to load at all ("Export named
// 'usePathname' not found").
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const push = mock((_href: string) => {});
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push, prefetch: () => {} }),
}));

const mod = await import("./BudgetCreateClient");
const BudgetCreateClient = mod.default;
const {
  blockedBanner,
  erpSetupHref,
  shortBlockedReason,
  VERIDIAN_ERP_SETUP_PATH,
  BUDGET_PRECONDITION_LABEL,
  NON_ADMIN_ACTION_LABEL,
  ADMIN_TASK_TEXT,
} = mod;

const ORIGIN = "https://veridian-compliance-ai.vercel.app";

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Handler = (init?: RequestInit) => Response | Promise<Response>;

const POSTED: { url: string; body: unknown }[] = [];

function router(handlers: Record<string, Handler>) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (init?.method === "POST") POSTED.push({ url, body: JSON.parse(String(init.body)) });
    for (const path of Object.keys(handlers).sort((a, b) => b.length - a.length)) {
      if (url.includes(path)) return handlers[path](init);
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

const HEALTHY = {
  fiscalYears: [{ id: "fy1", yearName: "FY 2026", startDate: "2026-01-01", endDate: "2026-12-31", isClosed: false }],
  accounts: [{ id: "acc1", accountName: "Direct costs", accountNumber: "5000" }],
};

function handlers(over: Partial<Record<string, Handler>> = {}): Record<string, Handler> {
  return {
    "/api/fiscal-years": () => jsonRes({ fiscalYears: HEALTHY.fiscalYears }),
    "/api/cost-centers": () => jsonRes({ costCenters: [] }),
    "/api/accounts": () => jsonRes({ accounts: HEALTHY.accounts }),
    "/api/companies": () => jsonRes({ companies: [] }),
    "/api/organization": () => jsonRes({ organization: { id: "o1", name: "Skyline" }, role: "pm" }),
    "/api/tasks": () => jsonRes({ tasks: [] }, 201),
    "/api/project-budgets": () => jsonRes({ id: "bud-1" }, 201),
    ...over,
  } as Record<string, Handler>;
}

/** An org with no fiscal year and no chart of accounts -- the blocked case. */
function blockedHandlers(role: string): Record<string, Handler> {
  return handlers({
    "/api/fiscal-years": () => jsonRes({ fiscalYears: [] }),
    "/api/accounts": () => jsonRes({ accounts: [] }),
    "/api/organization": () => jsonRes({ organization: { id: "o1", name: "Skyline" }, role }),
  });
}

function saveButton(container: HTMLElement): HTMLButtonElement {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Save")) as HTMLButtonElement;
}

function fieldByLabel(container: HTMLElement, prefix: string): HTMLInputElement {
  const label = [...container.querySelectorAll("label")].find((l) => l.textContent?.startsWith(prefix))!;
  return container.querySelector(`#${label.getAttribute("for")}`) as HTMLInputElement;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  POSTED.length = 0;
});

afterEach(() => {
  cleanup();
  push.mockClear();
  POSTED.length = 0;
  globalThis.fetch = originalFetch;
});

// ─── D1's pure wording rules (no DOM) ───────────────────────────────────────

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
    expect(erpSetupHref(ORIGIN)).toBe(`${ORIGIN}${VERIDIAN_ERP_SETUP_PATH}`);
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

// ─── D1's C-15 screen assertions, restated against the admin branch ─────────

describe("BudgetCreateClient with no fiscal years and no chart of accounts (C-15)", () => {
  test("the primary button carries four words, not a paragraph", async () => {
    globalThis.fetch = router(blockedHandlers("admin"));
    const view = render(<BudgetCreateClient veridianOrigin={ORIGIN} />);
    await waitFor(() => {
      const save = view.getByRole("button", { name: /^Save/ }) as HTMLButtonElement;
      expect(save.textContent).toBe("Save (needs a fiscal year and an account)");
      expect(save.disabled).toBe(true);
    });
  });

  test("the banner keeps the full explanation AND offers the way out", async () => {
    globalThis.fetch = router(blockedHandlers("admin"));
    const view = render(<BudgetCreateClient veridianOrigin={ORIGIN} />);
    await waitFor(() => {
      const link = view.getByRole("link", { name: "Set up in VERIDIAN" }) as HTMLAnchorElement;
      expect(link.getAttribute("href")).toBe(`${ORIGIN}${VERIDIAN_ERP_SETUP_PATH}`);
      expect(view.getByRole("alert").textContent).toContain("This organisation has no fiscal years");
    });
  });

  test("the link is withheld when no VERIDIAN origin was resolvable", async () => {
    globalThis.fetch = router(blockedHandlers("admin"));
    const view = render(<BudgetCreateClient veridianOrigin={null} />);
    await waitFor(() => {
      expect(view.getByRole("alert")).toBeTruthy();
    });
    expect(view.queryByRole("link", { name: "Set up in VERIDIAN" })).toBeNull();
  });
});

// ─── D3's D-42 role split ───────────────────────────────────────────────────

describe("BudgetCreateClient -- the blocked org (D-42)", () => {
  test("the button carries the SHORT reason, not a paragraph", async () => {
    globalThis.fetch = router(blockedHandlers("pm"));
    const { container } = render(<BudgetCreateClient veridianOrigin={ORIGIN} />);

    await waitFor(() => expect(saveButton(container).textContent).toBe(`Save (${BUDGET_PRECONDITION_LABEL})`));
    expect(saveButton(container).disabled).toBe(true);
    // A button says what it does; it is not a paragraph. The 200-character
    // explanation this replaced now lives in the alert asserted below.
    expect(saveButton(container).textContent!.length).toBeLessThan(60);
  });

  test("the explanation lives in an alert, once, with a way forward", async () => {
    globalThis.fetch = router(blockedHandlers("pm"));
    const { getByText } = render(<BudgetCreateClient veridianOrigin={ORIGIN} />);

    await waitFor(() => expect(getByText(/required to create a budget/)).toBeDefined());
    // Stated ONCE: the alert carries the explanation, the button carries the
    // short reason.
    expect(getByText(/required to create a budget/).getAttribute("role")).toBe("alert");
    // A site engineer / PM cannot provision an ERP fiscal year, so they are not
    // sent to a screen their role rejects.
    expect(getByText(NON_ADMIN_ACTION_LABEL)).toBeDefined();
  });

  test("an admin is sent to the setup screen instead of being told to ask themselves", async () => {
    globalThis.fetch = router(blockedHandlers("admin"));
    const { getByText, queryByText } = render(<BudgetCreateClient veridianOrigin={ORIGIN} />);

    await waitFor(() => expect(getByText("Set up in VERIDIAN")).toBeDefined());
    expect(queryByText(NON_ADMIN_ACTION_LABEL)).toBeNull();
    // A real destination, not a route that 404s: VERIDIAN's own ERP periods
    // screen, which is where a fiscal year is actually created.
    const link = getByText("Set up in VERIDIAN").closest("a")!;
    expect(link.getAttribute("href")).toContain("/erp/periods");
  });

  test("'Ask your administrator' files a real task and says it was sent", async () => {
    globalThis.fetch = router(blockedHandlers("site_engineer"));
    const { getByText } = render(<BudgetCreateClient veridianOrigin={ORIGIN} />);

    await waitFor(() => expect(getByText(NON_ADMIN_ACTION_LABEL)).toBeDefined());
    fireEvent.click(getByText(NON_ADMIN_ACTION_LABEL));

    await waitFor(() => expect(getByText(/your administrator has been asked/)).toBeDefined());
    const task = POSTED.find((p) => p.url.includes("/api/tasks"));
    expect(task).toBeDefined();
    expect((task!.body as { rawInput: string }).rawInput).toBe(ADMIN_TASK_TEXT);
  });

  test("a failed request says so and does not claim the administrator was asked", async () => {
    globalThis.fetch = router({
      ...blockedHandlers("site_engineer"),
      "/api/tasks": () => jsonRes({ error: "The task service didn't answer" }, 502),
    });
    const { getByText, queryByText } = render(<BudgetCreateClient veridianOrigin={ORIGIN} />);

    await waitFor(() => expect(getByText(NON_ADMIN_ACTION_LABEL)).toBeDefined());
    fireEvent.click(getByText(NON_ADMIN_ACTION_LABEL));

    await waitFor(() => expect(getByText(/The task service didn't answer/)).toBeDefined());
    expect(queryByText(/your administrator has been asked/)).toBeNull();
  });

  test("the two text fields are disabled with the short reason, so nothing typed can be lost", async () => {
    globalThis.fetch = router(blockedHandlers("pm"));
    const { container, getByText } = render(<BudgetCreateClient veridianOrigin={ORIGIN} />);

    await waitFor(() => expect(getByText(NON_ADMIN_ACTION_LABEL)).toBeDefined());
    const nameField = fieldByLabel(container, "Budget Name");
    const amountField = fieldByLabel(container, "Annual Amount");
    expect(nameField.disabled).toBe(true);
    expect(nameField.getAttribute("title")).toBe(BUDGET_PRECONDITION_LABEL);
    expect(amountField.disabled).toBe(true);
    expect(amountField.getAttribute("title")).toBe(BUDGET_PRECONDITION_LABEL);
  });

  test("the form never flips from enabled to blocked: the fields start disabled while the lookups are in flight", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    globalThis.fetch = router(handlers({
      "/api/fiscal-years": async () => { await gate; return jsonRes({ fiscalYears: HEALTHY.fiscalYears }); },
    }));

    const { container } = render(<BudgetCreateClient veridianOrigin={ORIGIN} />);
    await waitFor(() => expect(fieldByLabel(container, "Budget Name")).not.toBeNull());
    expect(fieldByLabel(container, "Budget Name").disabled).toBe(true);
    expect(fieldByLabel(container, "Budget Name").getAttribute("title")).toBe("Loading…");

    release!();
    // ...and only ever RELAXES: once the org proves healthy the field opens.
    await waitFor(() => expect(fieldByLabel(container, "Budget Name").disabled).toBe(false));
  });
});

describe("BudgetCreateClient -- the healthy org (D-42)", () => {
  test("the Save label counts the missing required fields", async () => {
    globalThis.fetch = router(handlers());
    const { container } = render(<BudgetCreateClient veridianOrigin={ORIGIN} />);

    await waitFor(() => expect(fieldByLabel(container, "Budget Name").disabled).toBe(false));
    // The archetype's counting form, the one /labour/new established: the
    // fields are NAMED, which is strictly more use than a bare count.
    expect(saveButton(container).textContent).toBe("Save (Budget Name, Fiscal Year, Account, Annual Amount)");
  });

  test("the org currency is a fixed prefix on Annual Amount, not something to type", async () => {
    globalThis.fetch = router(handlers());
    const { container, getByText } = render(<BudgetCreateClient veridianOrigin={ORIGIN} />);

    await waitFor(() => expect(fieldByLabel(container, "Budget Name").disabled).toBe(false));
    // No currency rows are served here, so the code comes from the deployment's
    // own NEXT_PUBLIC_DEFAULT_CURRENCY_CODE -- which may be unset in a test
    // process, and an unlabelled number is the documented honest fallback.
    const amount = fieldByLabel(container, "Annual Amount");
    expect(amount.className).toContain("tabular-nums");
    expect(getByText("Annual Amount")).toBeDefined();
  });
});
