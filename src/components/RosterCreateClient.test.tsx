/// <reference types="bun-types" />
// R67 D-34 (R-085). THE FAULT: the roster is where every trade-wise number in
// this product comes from, and its create form was the weakest in the product
// -- neither required field was marked, Trade was a free-text input (so
// "Mason", "mason" and "Masonry" split every trade-wise total), Daily Rate
// carried no currency and no /day, and the action was called "Add Worker" while
// every other create action in the product is a verb+object.
//
// These render the real screen and assert what a user sees. NOTE the harness
// limitation this lane measured and documented: a simulated keystroke into a
// CONTROLLED text input never reaches React's onChange under bun +
// happy-dom + React 19, so the "type a name and watch the button enable" half
// is asserted against the exact functions the component calls, in
// src/lib/roster-form.test.ts, rather than pretended at here.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const pushed: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => { pushed.push(href); }, refresh: () => {} }),
}));
mock.module("@/lib/currency", () => ({
  currencyLabel: () => "AED ",
  useCurrencies: () => [],
}));

const RosterCreateClient = (await import("./RosterCreateClient")).default;

afterEach(() => {
  cleanup();
  pushed.length = 0;
  postedBodies.length = 0;
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

const postedBodies: unknown[] = [];

function mount() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (init?.method === "POST") {
      postedBodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ id: "roster-1", employeeCode: "W-0042", name: "Ali" }), { status: 201, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/api/labour-roster/trades")) {
      return new Response(JSON.stringify({ trades: ["Mason", "Carpenter", "Electrician"] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/api/vendors")) {
      return new Response(JSON.stringify({ vendors: [{ id: "v1", vendorName: "Skyline Labour" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return render(<RosterCreateClient projectId="proj-1" />);
}

describe("RosterCreateClient (R67 D-34)", () => {
  test("the primary is disabled and NAMES both missing fields, in the /labour/new convention", async () => {
    const { getByRole } = mount();
    const save = await waitFor(() => getByRole("button", { name: /^Save/ }) as HTMLButtonElement);
    expect(save.disabled).toBe(true);
    expect(save.textContent).toContain("Name, Daily Rate");
  });

  test("both required fields are marked required, not left for the user to discover on submit", async () => {
    const { getByLabelText } = mount();
    // The visible asterisk is decorative; aria-required is what actually
    // conveys this, and it is what a screen reader gets.
    await waitFor(() => expect(getByLabelText(/^Name/).getAttribute("aria-required")).toBe("true"));
    expect(getByLabelText(/^Daily Rate/).getAttribute("aria-required")).toBe("true");
  });

  test("leaving Name empty renders its exact sentence under the field AND in the footer band", async () => {
    const { getByLabelText, getAllByText } = mount();
    const name = await waitFor(() => getByLabelText(/^Name/));
    fireEvent.blur(name);
    // Once under the field, once in the ObjectScreen messages band -- the item
    // asks for both, and this proves it is not only one.
    await waitFor(() => expect(getAllByText(/Enter the worker's name/).length).toBeGreaterThanOrEqual(2));
  });

  test("leaving Daily Rate empty names the org's own currency in the message", async () => {
    const { getByLabelText, getAllByText } = mount();
    const rate = await waitFor(() => getByLabelText(/^Daily Rate/));
    fireEvent.blur(rate);
    await waitFor(() => expect(getAllByText(/Enter a daily rate in AED, e\.g\. 120/).length).toBeGreaterThanOrEqual(2));
  });

  test("Daily Rate carries the currency prefix and the '/ day' suffix, and accepts decimals", async () => {
    const { getByLabelText, getAllByText, container } = mount();
    const rate = await waitFor(() => getByLabelText(/^Daily Rate/) as HTMLInputElement);
    expect(rate.getAttribute("inputmode")).toBe("decimal");
    expect(rate.getAttribute("min")).toBe("0");
    expect(getAllByText("/ day").length).toBeGreaterThan(0);
    expect((container.textContent ?? "").includes("AED")).toBe(true);
  });

  test("Trade is a picklist, not a free-text box -- the thing that split every trade-wise total", async () => {
    const { getByLabelText } = mount();
    const trade = await waitFor(() => getByLabelText(/^Trade/));
    // A Radix Select trigger is a button with a combobox role; a free-text
    // input would be an <input>.
    expect(trade.tagName.toLowerCase()).not.toBe("input");
    expect(trade.getAttribute("role")).toBe("combobox");
  });

  test("the screen is called New Worker, matching every other create action in the product", async () => {
    const { getAllByText } = mount();
    await waitFor(() => expect(getAllByText("New Worker").length).toBeGreaterThan(0));
  });

  test("nothing is POSTed while a required field is missing -- the button cannot fail after the click", async () => {
    const { getByRole } = mount();
    const save = await waitFor(() => getByRole("button", { name: /^Save/ }) as HTMLButtonElement);
    fireEvent.click(save);
    expect(postedBodies).toHaveLength(0);
  });
});
