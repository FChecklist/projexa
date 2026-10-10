/// <reference types="bun-types" />
// Defect D1: the "Create tax template" form. Money rules are asserted on the
// pure payload builder; the DOM test drives the real Create button with the
// default GST 18% (CGST 9 + SGST 9) and checks what is sent.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const { default: TaxTemplateForm, buildTaxTemplatePayload, defaultTemplateName } = await import("./TaxTemplateForm");

const ACCOUNTS = [
  { id: "acc-cgst", accountName: "CGST" },
  { id: "acc-sgst", accountName: "SGST" },
  { id: "acc-igst", accountName: "IGST" },
];

describe("buildTaxTemplatePayload", () => {
  test("within state = CGST + SGST lines at the typed rates", () => {
    const r = buildTaxTemplatePayload("intra", null, "9", "9", "18", ACCOUNTS);
    expect(r).toEqual({
      ok: true,
      payload: { name: "GST 18% (CGST 9 + SGST 9)", isSalesTax: true, items: [{ taxAccountId: "acc-cgst", rate: 9 }, { taxAccountId: "acc-sgst", rate: 9 }] },
    });
  });
  test("between states = a single IGST line", () => {
    const r = buildTaxTemplatePayload("inter", null, "9", "9", "18", ACCOUNTS);
    expect(r.ok && r.payload.items).toEqual([{ taxAccountId: "acc-igst", rate: 18 }]);
  });
  test("the total in the default name has no float noise", () => {
    expect(defaultTemplateName("intra", 2.5, 2.5, 0)).toBe("GST 5% (CGST 2.5 + SGST 2.5)");
    expect(defaultTemplateName("intra", 0.1, 0.2, 0)).toBe("GST 0.3% (CGST 0.1 + SGST 0.2)");
  });
  test("rejects a rate outside 0-100, a blank rate and a missing account", () => {
    expect(buildTaxTemplatePayload("intra", null, "101", "9", "0", ACCOUNTS).ok).toBe(false);
    expect(buildTaxTemplatePayload("intra", null, "-1", "9", "0", ACCOUNTS).ok).toBe(false);
    expect(buildTaxTemplatePayload("intra", null, "", "9", "0", ACCOUNTS).ok).toBe(false);
    expect(buildTaxTemplatePayload("intra", null, "9", "abc", "0", ACCOUNTS).ok).toBe(false);
    expect(buildTaxTemplatePayload("intra", null, "9", "9", "0", [ACCOUNTS[0]]).ok).toBe(false);
  });
  test("a custom name wins over the generated one", () => {
    const r = buildTaxTemplatePayload("intra", "  My GST  ", "9", "9", "0", ACCOUNTS);
    expect(r.ok && r.payload.name).toBe("My GST");
  });
});

describe("TaxTemplateForm", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    cleanup();
    globalThis.fetch = realFetch;
  });

  test("Create sets up the accounts, then posts GST 18% with both lines, then calls onCreated", async () => {
    const calls: { url: string; method: string; body?: unknown }[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const body = url.includes("/accounts") ? { taxAccounts: ACCOUNTS } : { id: "tpl-1" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    const onCreated = mock(async () => {});
    const { getByTestId } = render(<TaxTemplateForm onCreated={onCreated} />);
    fireEvent.click(getByTestId("tax-template-create"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    const post = calls.find((c) => c.url.endsWith("/api/tax-templates") && c.method === "POST")!;
    expect(post.body).toEqual({
      name: "GST 18% (CGST 9 + SGST 9)",
      isSalesTax: true,
      items: [{ taxAccountId: "acc-cgst", rate: 9 }, { taxAccountId: "acc-sgst", rate: 9 }],
    });
    expect(calls[0].url).toContain("/api/tax-templates/accounts");
  });
});
