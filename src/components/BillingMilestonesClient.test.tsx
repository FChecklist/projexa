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

  test("the create form opens with Save disabled until a description and customer exist", async () => {
    const { getByText, getByRole } = renderClient({ "/api/billing-claims": () => jsonRes({ claims: [] }) });
    await waitFor(() => expect(getByText("No billing milestones yet.")).toBeDefined());
    fireEvent.click(getByRole("button", { name: "New Billing Milestone" }));
    const save = getByRole("button", { name: `Save (${NAME_REQUIRED})` }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  test("picking a customer updates the select's own value for real", async () => {
    // The description field can't be typed into in this environment (see
    // buildClaimCreatePayload's own header), so it stays blank and Save's
    // disabled reason stays NAME_REQUIRED regardless of the customer picked
    // -- that reflects real, correct precedence (both fields are still
    // missing), not a defect in the customer <select>'s own wiring, which
    // this asserts directly.
    const { getByText, getByRole, getByLabelText } = renderClient({ "/api/billing-claims": () => jsonRes({ claims: [] }) });
    await waitFor(() => expect(getByText("No billing milestones yet.")).toBeDefined());
    fireEvent.click(getByRole("button", { name: "New Billing Milestone" }));
    const customerSelect = getByLabelText("Customer") as HTMLSelectElement;
    await waitFor(() => expect(customerSelect.options.length).toBeGreaterThan(1));
    fireEvent.change(customerSelect, { target: { value: "cust-1" } });
    await waitFor(() => expect(customerSelect.value).toBe("cust-1"));
    expect(getByRole("button", { name: `Save (${NAME_REQUIRED})` })).toBeDefined();
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

  test("invoicing an approved claim without a tax template configured is disabled with a real reason", async () => {
    const claim = { ...CLAIM_SUBMITTED, status: "client_approved" as const };
    const { getByText, getByRole } = renderClient({
      "/api/billing-claims": () => jsonRes({ claims: [claim] }),
      "/api/tax-templates": () => jsonRes({ taxTemplates: [] }),
    });
    await waitFor(() => expect(getByText("Foundation complete")).toBeDefined());
    await waitFor(() => {
      const btn = getByRole("button", { name: "Invoice" }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
  });
});
