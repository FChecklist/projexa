/// <reference types="bun-types" />
// R67 D-01. Two things this suite exists to hold:
//   1. The primary button never lies about what is missing -- an empty form
//      reads "Save (Name, Product)" and is disabled, so the create path can
//      never regress to the fail-after-click the dialog had.
//   2. A backend refusal keeps the form AND is attributed to the field the
//      server named, in the server's own words.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// bun test runs every file in ONE process and registering twice throws --
// same guard every other happy-dom suite in this repo uses.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// NOT `screen`: @testing-library/dom binds screen's queries to document.body
// at ITS import time, and ESM evaluates every static import before this
// file's own GlobalRegistrator.register() line runs -- so screen is bound
// before a document exists and every query throws. render()'s returned
// queries are bound at render time, after the DOM is installed.
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push }) }));

// Dynamic import (not a hoisted top-level one) so the module -- and its
// transitive Radix chain, which decides real-vs-noop useLayoutEffect from a
// module-scope `globalThis?.document` check -- is evaluated only AFTER
// GlobalRegistrator.register() has created `document`. Same reason
// PayrollClient.test.tsx does it.
const mod = await import("./ProjectCreateClient");
const ProjectCreateClient = mod.default;
const { missingProjectFields, fieldForProjectError } = mod;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  cleanup();
  push.mockClear();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("missingProjectFields", () => {
  test("names both required fields, in field order, on an empty form", () => {
    expect(missingProjectFields("", "")).toEqual(["Name", "Product"]);
  });

  test("counts down as the form fills", () => {
    expect(missingProjectFields("Cedar Heights Villa", "")).toEqual(["Product"]);
    expect(missingProjectFields("", "prod-1")).toEqual(["Name"]);
  });

  test("is empty once both are real, so Save reads just 'Save'", () => {
    expect(missingProjectFields("Cedar Heights Villa", "prod-1")).toEqual([]);
  });

  test("whitespace is not a name", () => {
    expect(missingProjectFields("   ", "prod-1")).toEqual(["Name"]);
  });
});

describe("fieldForProjectError", () => {
  test("attributes the backend's own words to the field it names", () => {
    expect(fieldForProjectError("Couldn't create project: productId is required")).toBe("productId");
    expect(fieldForProjectError("Couldn't create project: name is required")).toBe("name");
    expect(fieldForProjectError("Couldn't create project: target date must be after start date")).toBe("targetDate");
  });

  test("names no field when the message names none, so the message stays in the footer band", () => {
    expect(fieldForProjectError("Couldn't create project: Request failed (HTTP 502)")).toBeUndefined();
  });
});

describe("ProjectCreateClient", () => {
  test("renders the framed create screen: title, breadcrumb and Back", async () => {
    globalThis.fetch = (async () => jsonRes({ products: [{ id: "p1", name: "Villa Projects" }] })) as typeof fetch;
    const view = render(<ProjectCreateClient />);
    expect(await view.findByRole("heading", { name: "New Project" })).toBeTruthy();
    expect(view.getByText("Dashboard / New Project")).toBeTruthy();
    expect(view.getByRole("button", { name: /Back/ })).toBeTruthy();
  });

  test("the primary button is disabled and reads 'Save (Name, Product)' on an empty form", async () => {
    globalThis.fetch = (async () => jsonRes({ products: [{ id: "p1", name: "Villa Projects" }] })) as typeof fetch;
    const view = render(<ProjectCreateClient />);
    const save = await view.findByRole("button", { name: "Save (Name, Product)" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  test("a failed product load says so in the backend's words rather than opening an empty picker", async () => {
    globalThis.fetch = (async () => jsonRes({ error: "products upstream is down" }, 502)) as typeof fetch;
    const view = render(<ProjectCreateClient />);
    await waitFor(() => {
      expect(view.getByRole("alert").textContent).toContain("products upstream is down");
    });
  });
});
