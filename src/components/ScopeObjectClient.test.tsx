/// <reference types="bun-types" />
// R67 D-22. THE FAULT: the kit's ObjectScreen renders Edit only when onEdit
// exists and Delete only when onDelete exists, and this screen passed onDelete
// for drafts only and onEdit never. So on every approved or superseded BOQ --
// the majority of rows once a project is running -- the footer showed neither
// control and no reason, and a user could not tell a withheld action from a
// broken one.
//
// These tests render the real component against the PROJEXA-local ObjectScreen
// fork (src/components/screens/ObjectScreen.tsx) and assert the visible
// outcome, not the props.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in
// ONE process -- same guard PayrollClient.test.tsx documents.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

// Mocked BEFORE the component is imported below. ScopeObjectClient calls
// useRouter() for Back/Create Revision/Compare, and toasts on a failed inline
// budget save -- neither has a real provider outside a Next.js app tree.
mock.module("next/navigation", () => ({ useRouter: () => ({ push: mock(() => {}) }) }));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

const ScopeObjectClient = (await import("./ScopeObjectClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function boq(status: string) {
  return {
    id: "boq-1", projectId: "proj-1", version: 3, title: "Villa 21 - Interior Fit-out",
    status, parentBoqId: "boq-0", createdAt: "2026-08-28T00:00:00.000Z", lineItems: [],
  };
}

/** Routes the fake global fetch by which /api path the request targets. */
function router(handlers: Record<string, () => Response>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, handler] of Object.entries(handlers)) {
      if (url.includes(path)) return handler();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

function mountWithStatus(status: string) {
  globalThis.fetch = router({
    "/api/scope/boq-1": () => jsonRes(boq(status)),
    "/api/vendors": () => jsonRes({ vendors: [] }),
    "/api/currencies": () => jsonRes({ currencies: [] }),
  });
  return render(<ScopeObjectClient boqId="boq-1" />);
}

describe("ScopeObjectClient footer actions (D-22: rendered and disabled, never absent)", () => {
  test("a superseded BOQ shows BOTH Edit and Delete, both disabled, with the delete reason as visible text", async () => {
    const { getByRole, getByText } = mountWithStatus("superseded");

    await waitFor(() => expect(getByText("Villa 21 - Interior Fit-out")).toBeDefined());

    const edit = getByRole("button", { name: /^Edit/ }) as HTMLButtonElement;
    const del = getByRole("button", { name: /^Delete/ }) as HTMLButtonElement;
    expect(edit).toBeDefined();
    expect(del).toBeDefined();
    expect(edit.disabled).toBe(true);
    expect(del.disabled).toBe(true);

    // The exact sentence the item requires, on screen rather than in a tooltip.
    expect(getByText(/Only a draft BOQ can be deleted/)).toBeDefined();
    expect(getByText(/Lines change through a revision - use Create Revision/)).toBeDefined();
  });

  test("an approved BOQ -- the other majority case -- behaves identically", async () => {
    const { getByRole, getByText } = mountWithStatus("approved");
    await waitFor(() => expect(getByText("Villa 21 - Interior Fit-out")).toBeDefined());

    expect((getByRole("button", { name: /^Delete/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(getByText(/Only a draft BOQ can be deleted/)).toBeDefined();
  });

  test("a draft BOQ has a REAL, enabled Delete with no reason printed beside it", async () => {
    const { getByRole, queryByText, getByText } = mountWithStatus("draft");
    await waitFor(() => expect(getByText("Villa 21 - Interior Fit-out")).toBeDefined());

    const del = getByRole("button", { name: /^Delete/ }) as HTMLButtonElement;
    expect(del.disabled).toBe(false);
    expect(queryByText(/Only a draft BOQ can be deleted/)).toBeNull();
  });

  test("the workflow toolbar is untouched -- Create Revision still renders beside the disabled Delete", async () => {
    const { getByRole, getByText } = mountWithStatus("superseded");
    await waitFor(() => expect(getByText("Villa 21 - Interior Fit-out")).toBeDefined());
    expect(getByRole("button", { name: "Create Revision" })).toBeDefined();
    expect(getByRole("button", { name: "Compare to Previous" })).toBeDefined();
  });
});
