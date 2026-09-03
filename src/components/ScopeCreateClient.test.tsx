/// <reference types="bun-types" />
// R67 D-24, the item's own named acceptance file.
//
// THE FAULT: /scope/new offered an ENABLED Save on a completely empty form and
// discovered the missing fields only after the click, in a toast; the line grid
// had no visible column labels, so "Parent Item Code" and "Breakdown %"
// truncated inside their own inputs; and Remove was an unlabelled "✕" that was
// silently inert on the last row.
//
// R67 INTEGRATION TRAIN. D-24 and D-67 both rewrote this screen. D-67's
// CreateScreen archetype won the SHAPE (decision D-11's rule of thumb: the
// version already on main is canonical), and D-24's capabilities were folded
// onto it -- including the per-field blur messages, which the archetype's grid
// did not have and which this file exists to hold to. Two assertions are
// CORRECTED to the merged reality rather than dropped, and each says so where
// it is made:
//
//   * the primary's label. The archetype names the grid's own columns --
//     "Save (Title, Description, Qty, Rate)" -- rather than D-24's coarser
//     "Save (Title, Line 1)". It is the same rule (name what is missing, never
//     "complete the form") stated more precisely, so the assertion follows it.
//   * the column labels. They are a real <th> header row now, in the header's
//     own wording ("Item code", "Parent code"), instead of labels above a
//     div grid.
//
// The acceptance's second half ("blur an empty Qty input and assert 'Enter the
// quantity' is rendered next to that input") runs here verbatim: blur DOES
// reach React under this repo's bun + happy-dom + React 19 harness -- unlike a
// simulated keystroke into a controlled text input, which does not (measured
// in R67 D-18/D-19).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), replace: mock(() => {}), prefetch: mock(() => {}) }),
}));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

const ScopeCreateClient = (await import("./ScopeCreateClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

// The org's EDITABLE category list, in the shape /api/scope/categories really
// returns since R67 lane I: rows of compliance.construction_boq_categories,
// not bare strings. The grid reads that one table -- there is no second
// vocabulary anywhere in the product.
const ORG_CATEGORIES = ["Civil", "Gypsum", "Joinery", "Paint", "Electrical", "Plumbing", "Misc"].map((name, i) => ({
  id: `cat-${i + 1}`, name, isActive: true,
}));

function mount(categories: { id: string; name: string; isActive: boolean }[] = ORG_CATEGORIES) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/scope/categories")) {
      return new Response(JSON.stringify({ categories }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/api/currencies")) {
      return new Response(JSON.stringify({ currencies: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return render(<ScopeCreateClient projectId="proj-1" />);
}

describe("ScopeCreateClient primary action (D-24 acceptance, first half)", () => {
  test("renders empty with the primary NAMING what is missing, and DISABLED", () => {
    const { getByRole } = mount();
    // CORRECTED wording, same rule: the archetype names the grid's own columns.
    const save = getByRole("button", { name: "Save (Title, Description, Qty, Rate)" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  test("the reason names the fields, not a generic 'complete the form'", () => {
    const { getByRole } = mount();
    const label = getByRole("button", { name: /^Save \(/ }).textContent ?? "";
    expect(label).toContain("Title");
    expect(label).toContain("Description");
    expect(label).not.toContain("complete the form");
  });
});

describe("ScopeCreateClient on-blur field validation (D-24 acceptance, second half)", () => {
  test("blurring an empty Qty renders 'Enter the quantity' next to that input", async () => {
    const { getByLabelText, queryByText, findByText } = mount();

    // Nothing is said before the field has been visited.
    expect(queryByText("Enter the quantity")).toBeNull();

    const qty = getByLabelText("Qty, line 1") as HTMLInputElement;
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

  test("blurring one field does NOT report every other empty field at once", async () => {
    const { getByLabelText, findByText, queryByText } = mount();
    fireEvent.blur(getByLabelText("Qty, line 1"));
    await findByText("Enter the quantity");
    expect(queryByText("Enter the rate")).toBeNull();
  });

  test("blurring an empty Description renders its own sentence under the field", async () => {
    const { getByLabelText, findByText } = mount();
    fireEvent.blur(getByLabelText("Description, line 1"));
    expect(await findByText(/Enter a description/)).toBeDefined();
  });
});

describe("ScopeCreateClient line grid (D-24)", () => {
  test("Title is required and says so by NOT being marked optional", () => {
    const { container } = mount();
    const label = container.querySelector("label[for='title']")?.textContent ?? "";
    expect(label).toContain("Title");
    expect(label).not.toContain("(optional)");
  });

  test("every column has a VISIBLE header, including the two that used to truncate", () => {
    const { container } = mount();
    const headers = Array.from(container.querySelectorAll("th")).map((h) => h.textContent?.trim());
    // CORRECTED to the header row's own wording -- shortened precisely so the
    // two that used to truncate no longer can.
    for (const label of ["Description", "Category", "Unit", "Qty", "Rate", "Item code", "Parent code", "Breakdown %"]) {
      expect(headers).toContain(label);
    }
  });

  test("the grid's help sentences explain Item Code and the 100% sub-task rule", () => {
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
    const { getByRole, getAllByRole } = mount();
    const before = getByRole("button", { name: /^Save \(/ }).textContent;
    fireEvent.click(getByRole("button", { name: "+ Add Line" }));
    await waitFor(() => expect(getAllByRole("button", { name: /^Remove/ })).toHaveLength(2));
    // An empty row a user has not touched is not a demand: the label is the
    // same after adding it as it was before.
    expect(getByRole("button", { name: /^Save \(/ }).textContent).toBe(before);
  });

  test("the per-line Category control is fed by the org's own editable picklist, not a list this screen invents", async () => {
    const { getByLabelText } = mount();
    // Lane I's BoqCategorySelect labels its trigger through the same per-row
    // aria-label convention the rest of the grid uses.
    await waitFor(() => expect(getByLabelText(/Category, line 1/)).toBeDefined());
  });

  test("an org that has retired every category still renders the control -- Category is optional, never a blocker", async () => {
    const { getByLabelText, queryByText } = mount([]);
    await waitFor(() => expect(getByLabelText(/Category, line 1/)).toBeDefined());
    expect(queryByText(/Couldn't load/)).toBeNull();
  });
});
