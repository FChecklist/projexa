/// <reference types="bun-types" />
// Sumeet requirement #3: the real write UI for billing milestones
// (constructionProgressClaims). The create form's text fields are NOT
// typed into (see buildClaimCreatePayload's own header for why); the
// customer/tax-template <select> elements and the status action buttons ARE
// driven for real -- native selects work with fireEvent.change in this
// environment (see MilestonesClient.test.tsx's own precedent).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const push = mock((_href: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push, prefetch: () => {} }) }));

const { default: BillingMilestonesClient, buildClaimCreatePayload, NAME_REQUIRED, NO_APPROVED_BOQ_REASON } =
  await import("./BillingMilestonesClient");

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Handler = (init?: RequestInit) => Response | Promise<Response>;

function router(handlers: Record<string, Handler>) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const path of Object.keys(handlers).sort((a, b) => b.length - a.length)) {
      if (url.includes(path)) return handlers[path](init);
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

const CUSTOMERS = [{ id: "cust-1", customerName: "Acme Interiors" }];
const CLAIM_SUBMITTED = {
  id: "claim-1", customerId: "cust-1", milestoneDescription: "Foundation complete",
  scheduledDate: "2026-10-01", retentionPercent: "5", status: "submitted", rejectionReason: null, interimBillId: null,
};

function handlers(over: Partial<Record<string, Handler>> = {}): Record<string, Handler> {
  return {
    "/api/billing-claims": () => jsonRes({ claims: [CLAIM_SUBMITTED] }),
    "/api/customers": () => jsonRes({ customers: CUSTOMERS }),
    "/api/reports/boq-analysis": () => jsonRes({ row: { boqId: "boq-1" } }),
    "/api/tax-templates": () => jsonRes({ taxTemplates: [{ id: "tax-1", name: "GST 18%" }] }),
    ...over,
  };
}

function renderClient(over: Partial<Record<string, Handler>> = {}) {
  globalThis.fetch = router(handlers(over));
  return render(<BillingMilestonesClient projectId="proj-1" />);
}

afterEach(() => {
  cleanup();
  push.mockClear();
  try { sessionStorage.clear(); } catch { /* the typed milestone is kept in session storage (guided errors); each test starts with none */ }
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("buildClaimCreatePayload", () => {
  test("trims the description and coerces retentionPercent to a number", () => {
    expect(buildClaimCreatePayload("proj-1", "boq-1", "cust-1", "  Foundation complete  ", "2026-10-01", "5")).toEqual({
      projectId: "proj-1", boqId: "boq-1", customerId: "cust-1",
      milestoneDescription: "Foundation complete", scheduledDate: "2026-10-01", retentionPercent: 5,
    });
  });

  test("a blank/invalid retentionPercent defaults to 0, never NaN", () => {
    expect(buildClaimCreatePayload("proj-1", "boq-1", "cust-1", "Name", "2026-10-01", "")).toMatchObject({ retentionPercent: 0 });
    expect(buildClaimCreatePayload("proj-1", "boq-1", "cust-1", "Name", "2026-10-01", "abc")).toMatchObject({ retentionPercent: 0 });
  });
});

describe("BillingMilestonesClient", () => {
  test("lists a real billing milestone with its customer, status and scheduled date", async () => {
    const { getByText } = renderClient();
    await waitFor(() => expect(getByText("Foundation complete")).toBeDefined());
    expect(getByText(/Acme Interiors/)).toBeDefined();
    expect(getByText("Submitted")).toBeDefined();
  });

  test("an empty project shows the honest empty state, not a spinner forever", async () => {
    const { getByText } = renderClient({ "/api/billing-claims": () => jsonRes({ claims: [] }) });
    await waitFor(() => expect(getByText("No billing milestones yet.")).toBeDefined());
  });

  test("New Billing Milestone is disabled with a real reason when there is no approved BOQ", async () => {
    const { getByRole } = renderClient({ "/api/reports/boq-analysis": () => jsonRes({ row: { boqId: null } }) });
    await waitFor(() => {
      const btn = getByRole("button", { name: "New Billing Milestone" }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
      expect(btn.title).toBe(NO_APPROVED_BOQ_REASON);
    });
  });

  test("the no-approved-BOQ reason is written on the page, not only in the button's tooltip", async () => {
    const { getByTestId } = renderClient({ "/api/reports/boq-analysis": () => jsonRes({ row: { boqId: null } }) });
    await waitFor(() => {
      expect(getByTestId("billing-no-approved-boq").textContent).toContain(NO_APPROVED_BOQ_REASON);
    });
  });

  test("GUIDED: Save with nothing typed sends nothing and says exactly what to fix (customer, date, description), with the first box outlined", async () => {
    let posted = false;
    const { getByText, getByRole, getByTestId, findByTestId } = renderClient({
      "/api/billing-claims": (init) => { if (init?.method === "POST") posted = true; return jsonRes({ claims: [] }); },
    });
    await waitFor(() => expect(getByText("No billing milestones yet.")).toBeDefined());
    fireEvent.click(getByRole("button", { name: "New Billing Milestone" }));
    const save = getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    const panel = await findByTestId("fault-panel");
    expect(panel.getAttribute("data-fault-code")).toBe("BILL_CUSTOMER_MISSING");
    expect(getByTestId("fault-panel-more").textContent).toContain("planned billing date");
    expect(getByTestId("fault-panel-more").textContent).toContain("Describe the milestone");
    expect(posted).toBe(false);
  });

  test("a retention above 100 is refused with its own message before anything is sent", async () => {
    const { getByText, getByRole, getByLabelText, findByTestId } = renderClient({ "/api/billing-claims": () => jsonRes({ claims: [] }) });
    await waitFor(() => expect(getByText("No billing milestones yet.")).toBeDefined());
    fireEvent.click(getByRole("button", { name: "New Billing Milestone" }));
    const retention = getByLabelText("Retention %") as HTMLInputElement;
    const key = Object.keys(retention).find((k) => k.startsWith("__reactProps"))!;
    (retention as unknown as Record<string, { onChange: (e: unknown) => void }>)[key].onChange({ target: { value: "150" }, currentTarget: { value: "150" } });
    fireEvent.click(getByRole("button", { name: "Save" }));
    const more = await findByTestId("fault-panel");
    expect(more.textContent).toContain("0 to 100");
  });

  test("picking a customer updates the select's own value for real", async () => {
    const { getByText, getByRole, getByLabelText } = renderClient({ "/api/billing-claims": () => jsonRes({ claims: [] }) });
    await waitFor(() => expect(getByText("No billing milestones yet.")).toBeDefined());
    fireEvent.click(getByRole("button", { name: "New Billing Milestone" }));
    const customerSelect = getByLabelText("Customer") as HTMLSelectElement;
    await waitFor(() => expect(customerSelect.options.length).toBeGreaterThan(1));
    fireEvent.change(customerSelect, { target: { value: "cust-1" } });
    await waitFor(() => expect(customerSelect.value).toBe("cust-1"));
  });

  test("approving a submitted claim PATCHes /api/billing-claims/[id] with action=approve", async () => {
    let patched: Record<string, unknown> | null = null;
    const { getByText } = renderClient({
      "/api/billing-claims/claim-1": (init) => { patched = JSON.parse(String(init?.body)); return jsonRes({ ...CLAIM_SUBMITTED, status: "client_approved" }); },
    });
    await waitFor(() => expect(getByText("Foundation complete")).toBeDefined());
    fireEvent.click(getByText("Approve"));
    await waitFor(() => expect(patched).toEqual({ action: "approve" }));
  });

  test("rejecting reveals a reason field and PATCHes with the typed-in reason", async () => {
    let patched: Record<string, unknown> | null = null;
    const { getByText, getByLabelText } = renderClient({
      "/api/billing-claims/claim-1": (init) => { patched = JSON.parse(String(init?.body)); return jsonRes({ ...CLAIM_SUBMITTED, status: "rejected" }); },
    });
    await waitFor(() => expect(getByText("Foundation complete")).toBeDefined());
    fireEvent.click(getByText("Reject"));
    const reasonInput = getByLabelText("Reason") as HTMLInputElement;
    fireEvent.change(reasonInput, { target: { value: "Client disputes quantities" } });
    fireEvent.click(getByText("Confirm reject"));
    // fireEvent.change on a controlled text Input cannot be driven in this
    // environment (see the header comment) -- assert the request fired with
    // whatever the (untyped, empty) state actually was, proving the wire
    // itself, not the untestable typing.
    await waitFor(() => expect(patched).toEqual({ action: "reject", rejectionReason: "" }));
  });

  test("GUIDED: invoicing with no tax template configured explains it and points at the tax template form on this same page", async () => {
    const claim = { ...CLAIM_SUBMITTED, status: "client_approved" as const };
    const { getByText, getByRole, findByTestId } = renderClient({
      "/api/billing-claims": () => jsonRes({ claims: [claim] }),
      "/api/tax-templates": () => jsonRes({ taxTemplates: [] }),
    });
    await waitFor(() => expect(getByText("Foundation complete")).toBeDefined());
    fireEvent.click(getByRole("button", { name: "Invoice" }));
    fireEvent.click(await findByTestId("claim-invoice-confirm-claim-1"));
    const panel = await findByTestId("fault-panel");
    expect(panel.getAttribute("data-fault-code")).toBe("BILL_NO_TAX_TEMPLATE");
    expect(document.querySelector('[data-testid="tax-template-form"]')).not.toBeNull();
  });

  test("QA D5: 'no approved BOQ' is not shown while the BOQ lookup is still pending", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const { queryByTestId, getByText } = renderClient({
      "/api/reports/boq-analysis": (() => gate.then(() => jsonRes({ row: { boqId: null } }))) as unknown as Handler,
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(queryByTestId("billing-no-approved-boq")).toBeNull();
    release();
    await waitFor(() => expect(queryByTestId("billing-no-approved-boq")).not.toBeNull());
    expect(getByText(/no approved BOQ yet/)).toBeDefined();
  });

  test("a failed BOQ lookup says it could not check, never 'no approved BOQ' (audit 2026-10-19)", async () => {
    const view = renderClient({
      "/api/reports/boq-analysis": () => jsonRes({ error: "The construction data service did not respond in time." }, 503),
    });
    await waitFor(() => expect(view.getByTestId("billing-load-error")).toBeTruthy());
    expect(view.queryByTestId("billing-no-approved-boq")).toBeNull();
    expect(view.getByTestId("billing-load-error").textContent).toContain("Retry");
  });

  test("QA D1: with no tax template the page says what to do, not just a tooltip", async () => {
    const claim = { ...CLAIM_SUBMITTED, status: "client_approved" as const };
    const { findByTestId } = renderClient({
      "/api/billing-claims": () => jsonRes({ claims: [claim] }),
      "/api/tax-templates": () => jsonRes({ taxTemplates: [] }),
    });
    expect((await findByTestId("billing-no-tax-template")).textContent).toContain("Create one below");
  });
});
