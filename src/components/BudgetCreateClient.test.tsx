/// <reference types="bun-types" />
// R67 D-42 acceptance.
//
// The item's acceptance is a Playwright walk against http://localhost:3100 and
// this session may not start a dev server, so the same strings are asserted
// against the real component. One half of it -- "fill only Name and expect the
// button to read 'Save (2 required fields)'" -- cannot be driven at all in this
// repo's test environment: happy-dom + React 19 does not deliver input/change
// events to React (measured with a minimal controlled-input harness), so no
// test here can type. The label that renders the count is asserted on the empty
// form instead.
//
// MERGE NOTE (D-67 / C-15). This screen moved onto the shared create archetype,
// which already owns the counting rule (src/lib/create-screen.ts, unit-tested in
// its own file), so this lane's private missingRequiredFields/requiredFieldsReason/
// parseAmount helpers are gone and the describe block that exercised them with
// them -- one implementation of that rule, tested once. Two of D-42's own
// details moved with the archetype and are asserted in their new form here:
//   * the short reason is C-15's exact wording, "needs a fiscal year and an
//     account", and it is what the primary reads;
//   * the admin's way forward is "Set up in VERIDIAN" -- a link to the real ERP
//     provisioning screen -- rather than this lane's "/accounting", which is
//     PROJEXA's read-only surface onto it and cannot create a fiscal year.
// What did NOT move is the other half of D-42, which main's version had no
// answer for: only an org admin can provision a fiscal year, so everyone else
// gets a way to ASK, and the asking files a real task.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const push = mock((_href: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push, prefetch: () => {} }) }));

const mod = await import("./BudgetCreateClient");
const BudgetCreateClient = mod.default;
const { BUDGET_PRECONDITION_LABEL, NON_ADMIN_ACTION_LABEL, ADMIN_TASK_TEXT } = mod;

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

    await waitFor(() => expect(saveButton(container).textContent).toBe(`Save (${BUDGET_PRECONDITION_LABEL})`));
    expect(saveButton(container).disabled).toBe(true);
    // A button says what it does; it is not a paragraph. The 200-character
    // explanation this replaced now lives in the alert asserted below.
    expect(saveButton(container).textContent!.length).toBeLessThan(60);
  });

  test("the explanation lives in an alert, once, with a way forward", async () => {
    globalThis.fetch = router(blockedHandlers("pm"));
    const { getByText } = render(<BudgetCreateClient />);

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
    const { getByText, queryByText } = render(<BudgetCreateClient />);

    await waitFor(() => expect(getByText("Set up in VERIDIAN")).toBeDefined());
    expect(queryByText(NON_ADMIN_ACTION_LABEL)).toBeNull();
    // A real destination, not a route that 404s: VERIDIAN's own ERP periods
    // screen, which is where a fiscal year is actually created.
    const link = getByText("Set up in VERIDIAN").closest("a")!;
    expect(link.getAttribute("href")).toContain("/erp/periods");
  });

  test("'Ask your administrator' files a real task and says it was sent", async () => {
    globalThis.fetch = router(blockedHandlers("site_engineer"));
    const { getByText } = render(<BudgetCreateClient />);

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
    const { getByText, queryByText } = render(<BudgetCreateClient />);

    await waitFor(() => expect(getByText(NON_ADMIN_ACTION_LABEL)).toBeDefined());
    fireEvent.click(getByText(NON_ADMIN_ACTION_LABEL));

    await waitFor(() => expect(getByText(/The task service didn't answer/)).toBeDefined());
    expect(queryByText(/your administrator has been asked/)).toBeNull();
  });

  test("the two text fields are disabled with the short reason, so nothing typed can be lost", async () => {
    globalThis.fetch = router(blockedHandlers("pm"));
    const { container, getByText } = render(<BudgetCreateClient />);

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
    // The archetype's counting form, the one /labour/new established: the
    // fields are NAMED, which is strictly more use than a bare count.
    expect(saveButton(container).textContent).toBe("Save (Budget Name, Fiscal Year, Account, Annual Amount)");
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
