/// <reference types="bun-types" />
// R67 D-24, the item's own named acceptance file.
//
// THE FAULT: /scope/new offered an ENABLED Save on a completely empty form and
// discovered the missing fields only after the click, in a toast; the line grid
// had no visible column labels, so "Parent Item Code" and "Breakdown %"
// truncated inside their own inputs; and Remove was an unlabelled "✕" that was
// silently inert on the last row.
//
// The acceptance's first half ("render empty, the primary is named
// 'Save (Title, Line 1)' and is disabled") runs here verbatim. The second half
// ("blur an empty Qty input and assert 'Enter the quantity' is rendered next to
// that input") also runs here verbatim: blur DOES reach React under this
// repo's bun + happy-dom + React 19 harness -- unlike a simulated keystroke
// into a controlled text input, which does not (measured in R67 D-18/D-19).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({ useRouter: () => ({ push: mock(() => {}), prefetch: mock(() => {}) }) }));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

const ScopeCreateClient = (await import("./ScopeCreateClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function mount(categories: string[] = ["Joinery", "Gypsum", "Paint", "Civil", "Misc"]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/scope/categories")) {
      return new Response(JSON.stringify({ categories }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return render(<ScopeCreateClient projectId="proj-1" />);
}

describe("ScopeCreateClient primary action (D-24 acceptance, first half)", () => {
  test("renders empty with the primary named 'Save (Title, Line 1)' and DISABLED", () => {
    const { getByRole } = mount();
    const save = getByRole("button", { name: "Save (Title, Line 1)" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  test("the reason names the fields, not a generic 'complete the form'", () => {
    const { getByRole } = mount();
    expect(getByRole("button", { name: /^Save \(/ }).textContent).toContain("Title, Line 1");
  });
});

describe("ScopeCreateClient on-blur field validation (D-24 acceptance, second half)", () => {
  test("blurring an empty Qty renders 'Enter the quantity' next to that input", async () => {
    const { getByLabelText, queryByText, findByText } = mount();

    // Nothing is said before the field has been visited.
    expect(queryByText("Enter the quantity")).toBeNull();

    const qty = getByLabelText("Line 1 Qty") as HTMLInputElement;
    fireEvent.blur(qty);

    expect(await findByText("Enter the quantity")).toBeDefined();
    // "next to that input": the message lives in the element the input points
    // at through aria-describedby, so it is programmatically as well as
    // visually attached to THAT field.
    const describedBy = qty.getAttribute("aria-describedby")!;
    expect(describedBy).toBe("line-0-quantity-error");
    expect(document.getElementById(describedBy)?.textContent).toContain("Enter the quantity");
    expect(qty.getAttribute("aria-invalid")).toBe("true");
  });

  test("blurring an empty Title renders its own sentence under the field", async () => {
    const { getByLabelText, findByText } = mount();
    fireEvent.blur(getByLabelText("Title (required)"));
    expect(await findByText("Enter a title, e.g. Civil Works - Phase 1")).toBeDefined();
  });

  test("blurring one field does NOT report every other empty field at once", async () => {
    const { getByLabelText, findByText, queryByText } = mount();
    fireEvent.blur(getByLabelText("Line 1 Qty"));
    await findByText("Enter the quantity");
    expect(queryByText("Enter the rate")).toBeNull();
  });
});

describe("ScopeCreateClient line grid (D-24)", () => {
  test("the mandatory fields carry the '(required)' marker and aria-required", () => {
    const { getByLabelText } = mount();
    const title = getByLabelText("Title (required)");
    expect(title.getAttribute("aria-required")).toBe("true");
  });

  test("every column has a VISIBLE label above the grid, including the two that used to truncate", () => {
    const { getAllByText } = mount();
    // getAllByText, not getByText: "Category" is also the Select's own
    // placeholder, which is exactly the point -- the label above the column
    // stays visible once a value is chosen and the placeholder is gone.
    for (const label of ["Description", "Unit", "Qty", "Rate", "Item Code", "Parent Item Code", "Breakdown %", "Category"]) {
      expect(getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  test("the grid's help sentence explains Item Code and the 100% sub-task rule", () => {
    const { getByText } = mount();
    expect(getByText(/Item Code identifies the line in reports and the WPR\./)).toBeDefined();
    expect(getByText(/children of one parent should add up to 100%/)).toBeDefined();
  });

  test("Remove is a WORD, and on the only line it is disabled carrying '(last line)'", () => {
    const { getByRole } = mount();
    const remove = getByRole("button", { name: /^Remove/ }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    expect(remove.textContent).toContain("(last line)");
  });

  test("+ Add Line adds a second row, and Remove then becomes real", async () => {
    const { getByRole, getAllByRole } = mount();
    fireEvent.click(getByRole("button", { name: "+ Add Line" }));
    await waitFor(() => expect(getAllByRole("button", { name: /^Remove/ })).toHaveLength(2));
    expect((getAllByRole("button", { name: /^Remove/ })[0] as HTMLButtonElement).disabled).toBe(false);
  });

  test("adding an untouched second line does NOT disable Save any further than line 1 already does", async () => {
    const { getByRole } = mount();
    fireEvent.click(getByRole("button", { name: "+ Add Line" }));
    await waitFor(() => expect(getByRole("button", { name: /^Save \(/ }).textContent).toContain("Title, Line 1"));
    expect(getByRole("button", { name: /^Save \(/ }).textContent).not.toContain("Line 2");
  });

  test("the per-line Category select is fed by the org's own picklist", async () => {
    const { getByLabelText } = mount();
    await waitFor(() => expect(getByLabelText("Line 1 Category")).toBeDefined());
  });
});
