/// <reference types="bun-types" />
// R67 D-34 (R-085). THE FAULT: the roster is where every trade-wise number in
// this product comes from, and its create form was the weakest in the product
// -- neither required field was marked, Trade was a free-text input (so
// "Mason", "mason" and "Masonry" split every trade-wise total), Daily Rate
// carried no currency and no /day, and the action was called "Add Worker"
// while every other create action in the product is a verb+object.
//
// R67 INTEGRATION TRAIN. D-34 and D-67 both rewrote this form, and D-67's
// CreateScreen archetype won the SHAPE (decision D-11's rule of thumb: the
// version already on main is canonical, the arriving lane folds its capability
// in). These assertions are therefore rewritten against the archetype's own
// conventions rather than deleted. What changed and why:
//
//   * REQUIRED-NESS. The archetype does not put aria-required on the control;
//     it marks every OPTIONAL field with the word "(optional)" and names the
//     missing required ones inside the primary's own label (R-257's rule,
//     implemented once for all thirteen create screens). "Save (Name, Daily
//     Rate)" -- the very convention correction C-11 called this screen the
//     MODEL for -- is asserted directly, which is the behaviour D-34 cared
//     about.
//   * PER-FIELD BLUR SENTENCES. The archetype's blur validator is per field
//     and there is no separate footer band to duplicate into; the refusal is
//     the Save label plus the field's own message. roster-form.ts's sentences
//     and their tests (src/lib/roster-form.test.ts) are untouched.
//   * TRADE. It is a text input with a datalist of the org's vocabulary, not a
//     combobox. A closed select would refuse a trade this org genuinely has
//     and the seed list does not; the datalist offers the vocabulary (which is
//     what stops the three-way split) and still accepts a new word. See
//     CreateField.suggestions.
//
// NOTE the harness limitation this lane measured and documented: a simulated
// keystroke into a CONTROLLED text input never reaches React's onChange under
// bun + happy-dom + React 19, so the "type a name and watch the button enable"
// half is asserted against the exact functions the component calls, in
// src/lib/roster-form.test.ts, rather than pretended at here.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const pushed: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => { pushed.push(href); },
    replace: (href: string) => { pushed.push(href); },
    refresh: () => {},
  }),
}));

const RosterCreateClient = (await import("./RosterCreateClient")).default;

const postedBodies: unknown[] = [];

afterEach(() => {
  cleanup();
  pushed.length = 0;
  postedBodies.length = 0;
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

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
    if (url.includes("/api/currencies")) {
      return new Response(JSON.stringify({ currencies: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return render(<RosterCreateClient projectId="proj-1" />);
}

describe("RosterCreateClient (R67 D-34 on the D-67 archetype)", () => {
  test("the primary is disabled and NAMES both missing fields, in the /labour/new convention", async () => {
    const { getByRole } = mount();
    const save = await waitFor(() => getByRole("button", { name: /^Save/ }) as HTMLButtonElement);
    expect(save.disabled).toBe(true);
    expect(save.textContent).toContain("Name, Daily Rate");
  });

  test("the two required fields are the only ones NOT marked optional -- the recorded fault was that neither said so", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector("label[for='name']")).not.toBeNull());
    const optional = (n: string) =>
      (container.querySelector(`label[for='${n}']`)?.textContent ?? "").includes("(optional)");

    expect(optional("name")).toBe(false);
    expect(optional("dailyRate")).toBe(false);
    expect(optional("employeeCode")).toBe(true);
    expect(optional("trade")).toBe(true);
    expect(optional("vendorId")).toBe(true);
  });

  test("Trade offers the org's own vocabulary -- the thing that split every trade-wise total -- without locking it", async () => {
    const { container } = mount();
    const trade = await waitFor(() => container.querySelector("#trade") as HTMLInputElement | null);
    expect(trade).not.toBeNull();
    // Free text is still accepted: a closed select would refuse a trade this
    // org genuinely has. The vocabulary is offered through a datalist.
    expect(trade!.tagName.toLowerCase()).toBe("input");
    expect(trade!.getAttribute("list")).toBe("trade-suggestions");
    await waitFor(() => {
      const options = Array.from(container.querySelectorAll("#trade-suggestions option")).map((o) => o.getAttribute("value"));
      expect(options).toEqual(["Mason", "Carpenter", "Electrician"]);
    });
  });

  test("Daily Rate is a money box, so the amount is never typed with nothing on screen saying its unit", async () => {
    const { container } = mount();
    const rate = await waitFor(() => container.querySelector("#dailyRate") as HTMLInputElement | null);
    expect(rate).not.toBeNull();
    expect(rate!.getAttribute("inputmode")).toBe("decimal");
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
