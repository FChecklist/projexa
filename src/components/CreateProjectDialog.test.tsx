/// <reference types="bun-types" />
// R62 B7 regression test for R48_PROJECT_CREATE_NO_PRODUCTS_01 (Critical).
//
// THE DEFECT (R48 UAT session 2): the mandatory "Product" select in the
// "Create Project" dialog opened but rendered ZERO options for every user in
// every organisation, with no error shown -- so no project could ever be
// created through the UI. Root cause: onOpenChange() parsed the /api/products
// response body WITHOUT reading res.ok, and `data?.products ?? []` silently
// turned a real backend failure (this org has no VERIDIAN credentials, AR-04)
// into an empty, success-shaped product list. A blank picker where an error
// belonged.
//
// THE FIX (projexa#154 / a3ff16e): the status is read before the body, and
// the render distinguishes the two genuinely different states explicitly --
// a real backend error renders in role="alert" with the backend's own words,
// and a genuinely empty list renders a named "no products configured" notice
// (role="status") instead of leaving the Select silently empty.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

// CreateProjectDialog calls useRouter() from next/navigation, which throws
// outside a real Next.js App Router tree ("invariant expected app router to
// be mounted"). Mocked before the component is imported, same mock.module
// pattern the API route tests in this repo already use. bun:test's
// mock.module is process-global (bun test runs every file in one process),
// so this exports the same full shape every other test file's
// next/navigation mock in this repo uses -- whichever mock.module call
// happens to win the race must still satisfy every component under test.
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

const { CreateProjectDialog } = await import("./CreateProjectDialog");

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function openDialog(getByRole: ReturnType<typeof render>["getByRole"]) {
  fireEvent.click(getByRole("button", { name: /Create Project/i }));
}

describe("CreateProjectDialog (R48_PROJECT_CREATE_NO_PRODUCTS_01)", () => {
  test("a failed /api/products (real VERIDIAN error, non-2xx) shows the backend's own message, not a silently empty picker", async () => {
    globalThis.fetch = (async () =>
      jsonRes({ error: "No VERIDIAN credentials configured for organization 9165 (AR-04)" }, 502)) as typeof fetch;

    const { getByRole, queryByRole } = render(<CreateProjectDialog />);
    await openDialog(getByRole);

    // The regression: this used to render an open, empty Select with no
    // explanation at all -- no alert, no status, nothing, because the error
    // body was coerced into `products ?? []`.
    await waitFor(() =>
      expect(getByRole("alert").textContent).toMatch(/No VERIDIAN credentials configured/)
    );
    // A real error must not also be disguised as the "no products" empty
    // state (role="status") -- the fix keeps these two states distinct.
    expect(queryByRole("status")).toBeNull();
    // No product Select should render at all while the load itself failed.
    expect(queryByRole("combobox")).toBeNull();
  });

  test("a genuinely empty product list (2xx, zero products) is named as empty, not confused with a load failure", async () => {
    globalThis.fetch = (async () => jsonRes({ products: [] })) as typeof fetch;

    const { getByRole, queryByRole } = render(<CreateProjectDialog />);
    await openDialog(getByRole);

    await waitFor(() =>
      expect(getByRole("status").textContent).toMatch(/No products are set up for this organisation yet/)
    );
    expect(queryByRole("alert")).toBeNull();
  });

  test("a healthy product list renders real, selectable options", async () => {
    globalThis.fetch = (async () =>
      jsonRes({ products: [{ id: "p1", name: "Residential Fit-Out" }] })) as typeof fetch;

    const { getByRole, queryByRole, getByText } = render(<CreateProjectDialog />);
    await openDialog(getByRole);

    await waitFor(() => expect(getByRole("combobox")).toBeDefined());
    expect(queryByRole("alert")).toBeNull();
    expect(queryByRole("status")).toBeNull();

    fireEvent.click(getByRole("combobox"));
    await waitFor(() => expect(getByText("Residential Fit-Out")).toBeDefined());
  });
});
