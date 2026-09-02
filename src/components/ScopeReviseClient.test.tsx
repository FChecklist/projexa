/// <reference types="bun-types" />
// R67 D-27, the item's own named acceptance file.
//
// THE FAULT: the backend has always blocked a revision that reduces or removes
// work already recorded on site, but it said so only in a paragraph. The screen
// printed that paragraph and offered "Apply anyway (override)" -- a destructive
// button naming neither what it overrides nor how much of it -- so a user could
// accept it without ever seeing which lines were affected. Separately, the site
// instruction that authorises a revision had nowhere to be attached at all:
// /api/site-instructions had zero UI callers.
//
// The acceptance runs verbatim below: stub the submit with a 409 body carrying
// one conflict, and assert the rendered card contains "R60SK-A" and "12" and
// that the override button's accessible name is
// "Apply anyway - override 1 completed line".
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const push = mock(() => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push, prefetch: mock(() => {}) }) }));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

const ScopeReviseClient = (await import("./ScopeReviseClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const BOQ = {
  id: "boq-1", projectId: "proj-1", version: 2, title: "Villa 21 Fit-out",
  status: "approved", parentBoqId: "boq-0", createdAt: "2026-08-10T00:00:00.000Z",
  lineItems: [
    { id: "li-1", itemCode: "R60SK-A", description: "R60 skiphop sub", unit: "m2", quantity: "20", rate: "10", amount: "200", activityId: null, category: "Civil" },
  ],
};

const ONE_CONFLICT = {
  error: "Scope reduction blocked -- this revision would remove or reduce work already completed on site.",
  conflicts: [
    { itemCode: "R60SK-A", description: "R60 skiphop sub", recordedQty: 12, unit: "m2", lastRecordedAt: "2026-08-28" },
  ],
};

function mount(revisionResponse: () => Response) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/revisions")) return revisionResponse();
    if (url.includes("/api/site-instructions")) return jsonRes({ siteInstruction: { id: "si-1", siNumber: 14 }, fileName: "SI-2026-014.pdf" }, 201);
    if (url.includes("/api/scope/categories")) return jsonRes({ categories: ["Civil"] });
    if (url.includes("/api/scope/boq-1")) return jsonRes(BOQ);
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return render(<ScopeReviseClient boqId="boq-1" />);
}

describe("ScopeReviseClient 409 conflicts (D-27 acceptance)", () => {
  test("a 409 carrying one conflict renders it as a real row and labels the override with the count", async () => {
    const { findByText, getByRole } = mount(() => jsonRes(ONE_CONFLICT, 409));
    await findByText(/New Revision — from/);

    fireEvent.click(getByRole("button", { name: "Save" }));

    // The card names the line and the quantity actually recorded on site.
    expect(await findByText("R60SK-A")).toBeDefined();
    expect(await findByText("12 m2")).toBeDefined();
    expect(await findByText("28 Aug 2026")).toBeDefined();

    // The destructive action says how much it overrides, in the singular.
    await waitFor(() =>
      expect(getByRole("button", { name: "Apply anyway - override 1 completed line" })).toBeDefined()
    );
  });

  test("three conflicts pluralise and each gets its own row", async () => {
    const three = {
      error: ONE_CONFLICT.error,
      conflicts: [
        ONE_CONFLICT.conflicts[0],
        { itemCode: "A2", description: "Blockwork", recordedQty: 5, unit: "sqm", lastRecordedAt: "2026-08-20" },
        { itemCode: null, description: "Unnumbered extra", recordedQty: 1, unit: "nos", lastRecordedAt: "2026-08-21" },
      ],
    };
    const { findByText, getByRole } = mount(() => jsonRes(three, 409));
    await findByText(/New Revision — from/);
    fireEvent.click(getByRole("button", { name: "Save" }));

    await waitFor(() => expect(getByRole("button", { name: "Apply anyway - override 3 completed lines" })).toBeDefined());
    // A line with no item code still identifies itself.
    expect(await findByText("Unnumbered extra")).toBeDefined();
  });

  test("a 409 with NO conflicts array still blocks, and the label degrades honestly to zero", async () => {
    const { findByText, getByRole } = mount(() => jsonRes({ error: "Scope reduction blocked" }, 409));
    await findByText(/New Revision — from/);
    fireEvent.click(getByRole("button", { name: "Save" }));
    expect(await findByText("Scope reduction blocked")).toBeDefined();
    await waitFor(() => expect(getByRole("button", { name: /^Apply anyway - override 0 completed lines/ })).toBeDefined());
  });

  test("NOTHING is written before the user accepts the override -- the 409 is the only request made", async () => {
    const urls: string[] = [];
    const { findByText, getByRole } = mount(() => jsonRes(ONE_CONFLICT, 409));
    await findByText(/New Revision — from/);
    const inner = globalThis.fetch;
    globalThis.fetch = (async (i: RequestInfo | URL, init?: RequestInit) => {
      urls.push(`${init?.method ?? "GET"} ${typeof i === "string" ? i : i.toString()}`);
      return inner(i, init);
    }) as typeof fetch;

    fireEvent.click(getByRole("button", { name: "Save" }));
    await findByText("R60SK-A");
    expect(urls.filter((u) => u.startsWith("POST"))).toEqual(["POST /api/scope/boq-1/revisions"]);
  });
});

describe("ScopeReviseClient site instruction (D-27)", () => {
  test("offers the optional file field with the exact label and the sentence explaining it", async () => {
    const { findByText, getByLabelText } = mount(() => jsonRes({ id: "boq-2" }, 201));
    await findByText(/New Revision — from/);
    expect(getByLabelText("Site instruction (optional) - PDF or photo")).toBeDefined();
    expect(await findByText("Attach the client's instruction that authorises this change")).toBeDefined();
  });

  test("the field accepts a PDF or a photo, and nothing else", async () => {
    const { findByText, getByLabelText } = mount(() => jsonRes({ id: "boq-2" }, 201));
    await findByText(/New Revision — from/);
    expect((getByLabelText("Site instruction (optional) - PDF or photo") as HTMLInputElement).getAttribute("accept")).toBe(".pdf,image/*");
  });

  test("with no file chosen, saving lands on the new revision and never touches /api/site-instructions", async () => {
    push.mockClear();
    const urls: string[] = [];
    const { findByText, getByRole } = mount(() => jsonRes({ id: "boq-2", projectId: "proj-1" }, 201));
    await findByText(/New Revision — from/);
    const inner = globalThis.fetch;
    globalThis.fetch = (async (i: RequestInfo | URL, init?: RequestInit) => {
      urls.push(typeof i === "string" ? i : i.toString());
      return inner(i, init);
    }) as typeof fetch;

    fireEvent.click(getByRole("button", { name: "Save" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/scope/boq-2"));
    expect(urls.some((u) => u.includes("site-instructions"))).toBe(false);
  });
});
