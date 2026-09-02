/// <reference types="bun-types" />
// R67 D-42 acceptance.
//
// The item's acceptance is a Playwright walk against http://localhost:3100 and
// this session may not start a dev server, so the same strings are asserted
// against the real component. One half of it -- "fill only Name and expect the
// button to read 'Save (2 required fields)'" -- cannot be driven at all in this
// repo's test environment: happy-dom + React 19 does not deliver input/change
// events to React (measured with a minimal controlled-input harness), so no
// test here can type. The counting rule itself is therefore exercised directly
// through the exported pure helpers, and the label that renders it is asserted
// on the empty form.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const push = mock((_href: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push, prefetch: () => {} }) }));

const mod = await import("./BudgetCreateClient");
const BudgetCreateClient = mod.default;
const { missingRequiredFields, parseAmount, requiredFieldsReason } = mod;

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

afterEach(() => {
  cleanup();
  push.mockClear();
  POSTED.length = 0;
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("BudgetCreateClient -- the blocked org (D-42)", () => {
  test("the button carries the SHORT reason, not a paragraph", async () => {
    globalThis.fetch = router(blockedHandlers("pm"));
    const { container } = render(<BudgetCreateClient />);

    await waitFor(() => expect(saveButton(container).textContent).toBe("Save (needs fiscal year and account)"));
    expect(saveButton(container).disabled).toBe(true);
  });

  test("the explanation lives in an alert, once, with a way forward", async () => {
    globalThis.fetch = router(blockedHandlers("pm"));
    const { getByText } = render(<BudgetCreateClient />);

    await waitFor(() =>
      expect(getByText("This organisation has no fiscal year or chart of accounts yet, so a budget cannot be saved.")).toBeDefined()
    );
    // A site engineer / PM cannot provision an ERP fiscal year, so they are not
    // sent to a screen their role rejects.
    expect(getByText("Ask your administrator")).toBeDefined();
  });

  test("an admin is sent to Accounting instead of being told to ask themselves", async () => {
    globalThis.fetch = router(blockedHandlers("admin"));
    const { getByText, queryByText } = render(<BudgetCreateClient />);

    await waitFor(() => expect(getByText("Set up in Accounting →")).toBeDefined());
    expect(queryByText("Ask your administrator")).toBeNull();

    fireEvent.click(getByText("Set up in Accounting →"));
    expect(push).toHaveBeenCalledWith("/accounting");
  });

  test("'Ask your administrator' files a real task and says it was sent", async () => {
    globalThis.fetch = router(blockedHandlers("site_engineer"));
    const { getByText } = render(<BudgetCreateClient />);

    await waitFor(() => expect(getByText("Ask your administrator")).toBeDefined());
    fireEvent.click(getByText("Ask your administrator"));

    await waitFor(() => expect(getByText("Sent — your administrator has been asked")).toBeDefined());
    const task = POSTED.find((p) => p.url.includes("/api/tasks"));
    expect(task).toBeDefined();
    expect((task!.body as { rawInput: string }).rawInput).toBe("Set up fiscal year — needs admin");
  });

  test("a failed request says so and does not claim the administrator was asked", async () => {
    globalThis.fetch = router({
      ...blockedHandlers("site_engineer"),
      "/api/tasks": () => jsonRes({ error: "The task service didn't answer" }, 502),
    });
    const { getByText, queryByText } = render(<BudgetCreateClient />);

    await waitFor(() => expect(getByText("Ask your administrator")).toBeDefined());
    fireEvent.click(getByText("Ask your administrator"));

    await waitFor(() => expect(getByText("Couldn't send that request: The task service didn't answer")).toBeDefined());
    expect(queryByText("Sent — your administrator has been asked")).toBeNull();
  });

  test("the two text fields are disabled with the short reason, so nothing typed can be lost", async () => {
    globalThis.fetch = router(blockedHandlers("pm"));
    const { container, getByText } = render(<BudgetCreateClient />);

    await waitFor(() => expect(getByText("Ask your administrator")).toBeDefined());
    const nameField = fieldByLabel(container, "Budget Name");
    const amountField = fieldByLabel(container, "Annual Amount");
    expect(nameField.disabled).toBe(true);
    expect(nameField.getAttribute("title")).toBe("needs fiscal year and account");
    expect(amountField.disabled).toBe(true);
    expect(amountField.getAttribute("title")).toBe("needs fiscal year and account");
  });

  test("the form never flips from enabled to blocked: the fields start disabled while the lookups are in flight", async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    globalThis.fetch = router(handlers({
      "/api/fiscal-years": async () => { await gate; return jsonRes({ fiscalYears: HEALTHY.fiscalYears }); },
    }));

    const { container } = render(<BudgetCreateClient />);
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
    const { container } = render(<BudgetCreateClient />);

    await waitFor(() => expect(fieldByLabel(container, "Budget Name").disabled).toBe(false));
    expect(saveButton(container).textContent).toBe("Save (4 required fields)");
  });

  test("the org currency is a fixed prefix on Annual Amount, not something to type", async () => {
    globalThis.fetch = router(handlers());
    const { container, getByText } = render(<BudgetCreateClient />);

    await waitFor(() => expect(fieldByLabel(container, "Budget Name").disabled).toBe(false));
    // No currency rows are served here, so the code comes from the deployment's
    // own NEXT_PUBLIC_DEFAULT_CURRENCY_CODE -- which may be unset in a test
    // process, and an unlabelled number is the documented honest fallback.
    const amount = fieldByLabel(container, "Annual Amount");
    expect(amount.className).toContain("tabular-nums");
    expect(getByText("Annual Amount")).toBeDefined();
  });
});

describe("BudgetCreateClient -- the pure rules behind the label (D-42)", () => {
  test("an empty form is missing 4; Name alone leaves 3; the acceptance's 'only Name and Amount' leaves 2", () => {
    expect(missingRequiredFields({ name: "", fiscalYearId: "", accountId: "", annualAmount: "" })).toHaveLength(4);
    expect(missingRequiredFields({ name: "Site budget", fiscalYearId: "", accountId: "", annualAmount: "" })).toHaveLength(3);
    expect(
      missingRequiredFields({ name: "Site budget", fiscalYearId: "", accountId: "", annualAmount: "150000" })
    ).toHaveLength(2);
  });

  test("whitespace is not a value", () => {
    expect(missingRequiredFields({ name: "   ", fiscalYearId: "fy1", accountId: "acc1", annualAmount: "  " })).toEqual([
      "name",
      "annualAmount",
    ]);
  });

  test("the reason reads as a sentence and disappears when nothing is missing", () => {
    expect(requiredFieldsReason(2)).toBe("2 required fields");
    expect(requiredFieldsReason(1)).toBe("1 required field");
    expect(requiredFieldsReason(0)).toBeUndefined();
  });

  test("a grouped amount round-trips, and a non-number is null rather than 0", () => {
    expect(parseAmount("150,000.00")).toBe(150000);
    expect(parseAmount("150000")).toBe(150000);
    expect(parseAmount("0")).toBe(0);
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
  });
});
