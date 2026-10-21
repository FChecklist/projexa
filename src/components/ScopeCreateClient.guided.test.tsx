/// <reference types="bun-types" />
// GUIDED ERRORS (G1), New BOQ (online): every fault a person can make typing a BOQ is found BEFORE anything is sent, told in the guided panel (what
// happened, why, what to do), named on its own input, the input is outlined, the typed BOQ (title AND every line) is kept in a draft across a trip
// away and back, and a refusal from the server that names a line is taken to that line's input.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const pushed: string[] = [];
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: (u: string) => pushed.push(u), replace: (u: string) => pushed.push(u), prefetch: () => {} }),
  usePathname: () => "/scope/new",
}));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

const ScopeCreateClient = (await import("./ScopeCreateClient")).default;
import type { LineItemDraft } from "@/lib/boq-helpers";

const DRAFT_KEY = "px-draft:boq-new:proj-1";
const line = (over: Partial<LineItemDraft> = {}): LineItemDraft => ({
  description: "Excavation", unit: "m3", quantity: "10", rate: "5", category: "", itemCode: "", parentItemCode: "", breakdownPercentage: "", ...over,
});
function seed(title: string, lines: LineItemDraft[]) {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), value: { title, lines } }));
}

let posts: { url: string; body: unknown }[];
let postResponse: () => Response;
function mount() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/scope/categories")) return new Response(JSON.stringify({ categories: [] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/api/currencies")) return new Response(JSON.stringify({ currencies: [] }), { status: 200, headers: { "content-type": "application/json" } });
    if (url.endsWith("/api/scope") && init?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return postResponse();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return render(<ScopeCreateClient projectId="proj-1" />);
}
const save = (c: HTMLElement) => Array.from(c.querySelectorAll("button")).find((b) => /^Save/.test(b.textContent ?? "")) as HTMLButtonElement;
const input = (c: HTMLElement, id: string) => c.querySelector(`[id="${id}"]`) as HTMLInputElement;

beforeEach(() => {
  sessionStorage.clear();
  posts = [];
  pushed.length = 0;
  postResponse = () => new Response(JSON.stringify({ id: "boq-1", lineItems: [{}] }), { status: 201, headers: { "content-type": "application/json" } });
});
afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("New BOQ: a wrong value is told before anything is sent", () => {
  test("a negative quantity: panel in full, the input named and outlined, nothing sent, nothing lost", async () => {
    seed("Civil", [line({ quantity: "-5" })]);
    const { container, findByTestId } = mount();
    await waitFor(() => expect((container.querySelector("#title") as HTMLInputElement).value).toBe("Civil"));
    fireEvent.click(save(container));

    const panel = await findByTestId("guided-error");
    expect(panel.textContent).toContain("Line 1: Qty cannot be negative");
    expect(panel.querySelector('[data-testid="guided-error-steps"]')).not.toBeNull();
    expect(panel.querySelector('[data-testid="guided-error-fix"]')).not.toBeNull();
    const qty = input(container, "boq-line-0-quantity");
    expect(qty.getAttribute("aria-invalid")).toBe("true");
    expect(qty.getAttribute("data-px-highlighted")).toBe("true");
    expect(document.getElementById(qty.getAttribute("aria-describedby")!)?.textContent).toContain("cannot be negative");
    expect(posts).toHaveLength(0);
    // everything typed is still there
    expect((container.querySelector("#title") as HTMLInputElement).value).toBe("Civil");
    expect(qty.value).toBe("-5");
  });

  test("each kind of fault names ITS input: a rate that is not a number, a duplicate code, a parent that is not there, a share over 100", async () => {
    const cases: [string, LineItemDraft[], string, RegExp][] = [
      ["rate", [line({ rate: "forty" })], "boq-line-0-rate", /Rate "forty" is not a number/],
      ["duplicate code", [line({ itemCode: "A-1" }), line({ description: "Backfill", itemCode: "A-1" })], "boq-line-1-itemCode", /already used on line 1/],
      ["unknown parent", [line({ itemCode: "A-1" }), line({ description: "Sub", unit: "m3", parentItemCode: "ZZ", breakdownPercentage: "30" })], "boq-line-1-parentItemCode", /no line has the item code "ZZ"/],
      ["share over 100", [line({ itemCode: "A-1" }), line({ description: "Sub", unit: "m3", parentItemCode: "A-1", breakdownPercentage: "150" })], "boq-line-1-breakdownPercentage", /must be a number from 0 to 100/],
      ["text too long", [line({ description: "x".repeat(2001) })], "boq-line-0-description", /2000/],
    ];
    for (const [name, lines, id, text] of cases) {
      sessionStorage.clear();
      seed("Civil", lines);
      const { container, findByTestId, unmount } = mount();
      await waitFor(() => expect((container.querySelector("#title") as HTMLInputElement).value).toBe("Civil"));
      fireEvent.click(save(container));
      const panel = await findByTestId("guided-error");
      expect(panel.textContent, name).toMatch(text);
      expect(input(container, id).getAttribute("aria-invalid"), name).toBe("true");
      expect(posts, name).toHaveLength(0);
      unmount();
    }
  });

  test("a fixed fault leaves the panel; a good BOQ is sent and the draft is thrown away", async () => {
    seed("Civil", [line({ quantity: "-5" })]);
    const { container, findByTestId, queryByTestId } = mount();
    await waitFor(() => expect((container.querySelector("#title") as HTMLInputElement).value).toBe("Civil"));
    fireEvent.click(save(container));
    await findByTestId("guided-error");

    // the person corrects the quantity (the controlled box is driven through its React handler)
    const qty = input(container, "boq-line-0-quantity");
    const key = Object.keys(qty).find((k) => k.startsWith("__reactProps"))!;
    const props = (qty as unknown as Record<string, { onChange: (e: unknown) => void }>)[key];
    const { act } = await import("@testing-library/react");
    act(() => props.onChange({ target: { value: "5" }, currentTarget: { value: "5" } }));
    await waitFor(() => expect(queryByTestId("guided-error")).toBeNull());

    fireEvent.click(save(container));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect((posts[0].body as { lineItems: { quantity: number }[] }).lineItems[0].quantity).toBe(5);
    await waitFor(() => expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull());
  });
});

describe("New BOQ: what was typed survives leaving and coming back", () => {
  test("the title and ALL the lines come back, and the person is told so, with a way to start fresh", async () => {
    const many = Array.from({ length: 12 }, (_, i) => line({ description: `Item ${i + 1}`, itemCode: `C-${i + 1}` }));
    seed("Big BOQ", many);
    const { container, getByTestId, getAllByRole } = mount();
    await waitFor(() => expect((container.querySelector("#title") as HTMLInputElement).value).toBe("Big BOQ"));
    expect(getAllByRole("button", { name: /^Remove/ })).toHaveLength(12);
    expect(input(container, "boq-line-11-description").value).toBe("Item 12");
    const note = getByTestId("draft-restored");
    expect(note.textContent).toContain("We kept what you typed earlier");
    fireEvent.click(note.querySelector("button")!);
    await waitFor(() => expect((container.querySelector("#title") as HTMLInputElement).value).toBe(""));
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe("New BOQ: a refusal from the server that names a line goes to that line's input", () => {
  test("'line item 2: quantity must be a non-negative number' outlines Qty of the 2nd FILLED row (blank rows do not count)", async () => {
    seed("Civil", [line(), emptyRow(), line({ description: "Backfill" })]);
    postResponse = () => new Response(JSON.stringify({ error: "line item 2: quantity must be a non-negative number, got NaN" }), { status: 400, headers: { "content-type": "application/json" } });
    const { container, findByTestId } = mount();
    await waitFor(() => expect((container.querySelector("#title") as HTMLInputElement).value).toBe("Civil"));
    fireEvent.click(save(container));
    const panel = await findByTestId("guided-error");
    expect(panel.textContent).toContain("line item 2: quantity must be a non-negative number");
    await waitFor(() => expect(input(container, "boq-line-2-quantity").getAttribute("data-px-highlighted")).toBe("true"));
    // the whole BOQ is still on screen
    expect((container.querySelector("#title") as HTMLInputElement).value).toBe("Civil");
    expect(input(container, "boq-line-2-description").value).toBe("Backfill");
  });
});

function emptyRow(): LineItemDraft {
  return { description: "", unit: "", quantity: "", rate: "", category: "", itemCode: "", parentItemCode: "", breakdownPercentage: "" };
}
