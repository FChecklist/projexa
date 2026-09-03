/// <reference types="bun-types" />
// R67 D-36 acceptance (audit R-105) on the client half: the void states its
// blast radius in this receipt's own numbers, refuses to run without a
// reason, is soft (the row survives, marked), and the page never prints a
// raw user id.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const push = mock(() => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push }) }));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

const receiptModule = await import("./MaterialReceiptObjectClient");
const MaterialReceiptObjectClient = receiptModule.default;
const { VoidConfirm } = receiptModule;

const RECEIPT = {
  id: "rec-1",
  projectId: "p1",
  materialId: "mat-cement",
  receivedDate: "2026-08-28",
  quantity: "50",
  unitCost: "435",
  vendorId: "v1",
  reference: "R60T2",
  notes: null,
  voidedAt: null,
  voidReason: null,
  voidedBy: null,
  recordedByName: "Sana Iqbal",
  voidedByName: null,
  material: { id: "mat-cement", name: "Cement OPC 53", unit: "bag" },
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
function router(handlers: Record<string, (init?: RequestInit) => Response>) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, handler] of Object.entries(handlers)) {
      if (url.includes(path)) return handler(init);
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

const DEFAULTS: Record<string, (init?: RequestInit) => Response> = {
  "/api/materials/rec-1": () => jsonRes(RECEIPT),
  "/api/vendors": () => jsonRes({ vendors: [{ id: "v1", vendorName: "Gulf Cement Trading" }] }),
  "/api/currencies": () => jsonRes({ currencies: [{ id: "c1", code: "AED", name: "Dirham", symbol: null, isBaseCurrency: true }] }),
};

afterEach(() => {
  cleanup();
  push.mockClear();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("the receipt object page", () => {
  test("the breadcrumb identifies the receipt by date, reference and material", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText } = render(<MaterialReceiptObjectClient receiptId="rec-1" />);
    await waitFor(() => expect(getByText("Materials / Receipts / 28-08-2026 R60T2 Cement OPC 53")).toBeDefined());
  });

  test("the details name the vendor, the reference, the line total and the person who recorded it", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText } = render(<MaterialReceiptObjectClient receiptId="rec-1" />);

    await waitFor(() => expect(getByText("Details")).toBeDefined());
    const details = getByText("Details").closest("section")!;
    expect(details.textContent).toContain("Vendor: Gulf Cement Trading");
    expect(details.textContent).toContain("Reference: R60T2");
    expect(details.textContent).toContain("Quantity: 50 bag");
    expect(details.textContent).toContain("Unit Cost: AED 435.00");
    expect(details.textContent).toContain("Line total: AED 21,750.00");
    expect(details.textContent).toContain("Recorded by: Sana Iqbal");
  });

  test("an unresolvable recorder renders the en-dash, never a raw id", async () => {
    globalThis.fetch = router({ ...DEFAULTS, "/api/materials/rec-1": () => jsonRes({ ...RECEIPT, recordedByName: null }) });
    const { getByText, queryByText } = render(<MaterialReceiptObjectClient receiptId="rec-1" />);

    await waitFor(() => expect(getByText("Details")).toBeDefined());
    expect(getByText("Details").closest("section")!.textContent).toContain("Recorded by: —");
    expect(queryByText(/apikey-/)).toBeNull();
  });

  test("the material is a link back to the master", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText } = render(<MaterialReceiptObjectClient receiptId="rec-1" />);

    await waitFor(() => expect(getByText("Details")).toBeDefined());
    const details = getByText("Details").closest("section")!;
    fireEvent.click(within(details).getByText("Cement OPC 53"));
    expect(push).toHaveBeenCalledWith("/materials/mat-cement");
  });
});

describe("Void: a soft correction with a stated blast radius", () => {
  test("the single action is Void, not Delete", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText, queryByText } = render(<MaterialReceiptObjectClient receiptId="rec-1" />);

    await waitFor(() => expect(getByText("Void")).toBeDefined());
    expect(queryByText("Delete")).toBeNull();
  });

  test("the confirm states what the void removes, in this receipt's own numbers", async () => {
    globalThis.fetch = router(DEFAULTS);
    const { getByText, getByRole } = render(<MaterialReceiptObjectClient receiptId="rec-1" />);

    await waitFor(() => expect(getByText("Void")).toBeDefined());
    fireEvent.click(getByText("Void"));

    const confirm = await waitFor(() => getByRole("alertdialog"));
    expect(confirm.textContent).toContain(
      "Voiding removes 50 bag from Received to date and AED 21,750.00 from the Cost Report."
    );
    expect(within(confirm).getByText("Reason:")).toBeDefined();
  });

  test("with no reason typed, the confirm's own button says so, is disabled, and no PATCH is sent", async () => {
    let patched: unknown = null;
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/materials/rec-1": (init) => {
        if (init?.method === "PATCH") { patched = JSON.parse(String(init.body)); return jsonRes({ ...RECEIPT, voidedAt: "2026-09-03T00:00:00.000Z" }); }
        return jsonRes(RECEIPT);
      },
    });
    const { getByText, getByRole } = render(<MaterialReceiptObjectClient receiptId="rec-1" />);

    await waitFor(() => expect(getByText("Void")).toBeDefined());
    fireEvent.click(getByText("Void"));
    const confirm = await waitFor(() => getByRole("alertdialog"));

    const voidButton = within(confirm).getByText("Void (A reason is required)") as HTMLButtonElement;
    expect(voidButton.disabled).toBe(true);
    fireEvent.click(voidButton);
    expect(patched).toBeNull();
  });

  test("Cancel closes the confirm without writing anything", async () => {
    let patched: unknown = null;
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/materials/rec-1": (init) => {
        if (init?.method === "PATCH") { patched = JSON.parse(String(init.body)); return jsonRes(RECEIPT); }
        return jsonRes(RECEIPT);
      },
    });
    const { getByText, getByRole, queryByRole } = render(<MaterialReceiptObjectClient receiptId="rec-1" />);

    await waitFor(() => expect(getByText("Void")).toBeDefined());
    fireEvent.click(getByText("Void"));
    const confirm = await waitFor(() => getByRole("alertdialog"));
    fireEvent.click(within(confirm).getByText("Cancel"));

    await waitFor(() => expect(queryByRole("alertdialog")).toBeNull());
    expect(patched).toBeNull();
  });

  test("an already-voided receipt says who voided it and why, keeps the row, and offers no second void", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/materials/rec-1": () =>
        jsonRes({ ...RECEIPT, voidedAt: "2026-09-03T00:00:00.000Z", voidReason: "Quantity keyed wrong", voidedBy: "user-9", voidedByName: "Rohit Verma" }),
    });
    const { getByText, queryByText } = render(<MaterialReceiptObjectClient receiptId="rec-1" />);

    await waitFor(() => expect(getByText(/Voided by Rohit Verma on 03-09-2026/)).toBeDefined());
    expect(getByText(/Quantity keyed wrong/)).toBeDefined();
    expect(getByText(/the row is kept/)).toBeDefined();
    expect(queryByText("Void")).toBeNull();
  });

});

// The confirm itself, driven directly. This environment (happy-dom + React
// 19) cannot deliver a change/input event to a CONTROLLED text field -- a
// verified limitation, not a defect in this component, and the reason no
// other test in this repo types into one -- so the "a reason has been typed"
// state is exercised by rendering the confirm with that reason as a prop.
// The component is the same one the object page renders.
describe("VoidConfirm", () => {
  const BLAST = "Voiding removes 50 bag from Received to date and AED 21,750.00 from the Cost Report.";

  function renderConfirm(reason: string, overrides: Partial<Parameters<typeof VoidConfirm>[0]> = {}) {
    const onConfirm = mock(() => {});
    const onCancel = mock(() => {});
    const view = render(
      <VoidConfirm
        blastRadius={BLAST}
        reason={reason}
        onReasonChange={() => {}}
        onConfirm={onConfirm}
        onCancel={onCancel}
        busy={false}
        error={null}
        {...overrides}
      />
    );
    return { ...view, onConfirm, onCancel };
  }

  test("with a reason typed the button is plain 'Void', enabled, and confirming calls through", () => {
    const { getByText, onConfirm } = renderConfirm("Quantity keyed wrong");
    const button = getByText("Void") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("whitespace is not a reason", () => {
    const { getByText } = renderConfirm("   ");
    expect((getByText("Void (A reason is required)") as HTMLButtonElement).disabled).toBe(true);
  });

  test("while the void is in flight the label says so and both buttons are disabled", () => {
    const { getByText } = renderConfirm("Quantity keyed wrong", { busy: true });
    expect((getByText("Voiding…") as HTMLButtonElement).disabled).toBe(true);
    expect((getByText("Cancel") as HTMLButtonElement).disabled).toBe(true);
  });

  test("a failed void keeps the confirm open and shows the reason it failed", () => {
    const { getByRole, getByText } = renderConfirm("Duplicate", {
      error: "Couldn't void this receipt: This receipt is already voided",
    });
    expect(getByRole("alertdialog")).toBeDefined();
    expect(getByText(/This receipt is already voided/)).toBeDefined();
  });

  test("the blast radius is always shown above the reason field", () => {
    const { getByText } = renderConfirm("");
    expect(getByText(BLAST)).toBeDefined();
    expect(getByText("Reason:")).toBeDefined();
  });
});
