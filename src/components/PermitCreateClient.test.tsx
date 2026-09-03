/// <reference types="bun-types" />
// R67 D-06. The item's acceptance is a Playwright run against a local dev
// server, which this lane may not start, so the same two assertions are made
// here against the rendered component: an empty form's reason text is exactly
// "4 required fields still needed - permit name, issue date, end date, permit
// PDF", and an end date before the issue date shows
// "End date must be on or after the issue date" under the End date field.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
// render()'s bound queries, not `screen` -- see ProjectCreateClient.test.tsx.
import { cleanup, render } from "@testing-library/react";

const push = mock((_: string) => {});
// R67 lane A merge: the real module is spread in rather than replaced. Lane A
// mounts <ObjectContext>/<ScreenContext> inside these screens, and those call
// usePathname() -- a mock that returned only useRouter made the whole module
// lose every other export and the file failed to load at all
// ("Export named 'usePathname' not found in module .../next/navigation.js").
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({ ...realNavigation, useRouter: () => ({ push }) }));

const mod = await import("./PermitCreateClient");
const PermitCreateClient = mod.default;
const { missingPermitFields, missingPermitFieldsReason, endDateError, fileSizeError, describeFileSize, permitFileTypeError, MAX_PDF_MB } = mod;

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("missingPermitFields / missingPermitFieldsReason", () => {
  const EMPTY = { name: "", issueDate: "", endDate: "", hasFile: false };

  test("names all four required fields in field order", () => {
    expect(missingPermitFields(EMPTY)).toEqual(["permit name", "issue date", "end date", "permit PDF"]);
  });

  test("the empty form's reason is exactly the sentence the item specifies", () => {
    expect(missingPermitFieldsReason(missingPermitFields(EMPTY))).toBe(
      "4 required fields still needed - permit name, issue date, end date, permit PDF"
    );
  });

  test("counts down as fields fill, keeping field order", () => {
    expect(missingPermitFieldsReason(missingPermitFields({ ...EMPTY, name: "Building Permit - Villa 21" }))).toBe(
      "3 required fields still needed - issue date, end date, permit PDF"
    );
    expect(
      missingPermitFieldsReason(missingPermitFields({ name: "x", issueDate: "2026-05-01", endDate: "2026-11-01", hasFile: false }))
    ).toBe("1 required field still needed - permit PDF");
  });

  test("a complete form has no reason at all, so Save reads just 'Save'", () => {
    expect(
      missingPermitFieldsReason(missingPermitFields({ name: "x", issueDate: "2026-05-01", endDate: "2026-11-01", hasFile: true }))
    ).toBeUndefined();
  });

  test("whitespace is not a permit name", () => {
    expect(missingPermitFields({ ...EMPTY, name: "   " })).toContain("permit name");
  });
});

describe("endDateError", () => {
  test("an end date before the issue date is refused, in the user's words", () => {
    expect(endDateError("2026-05-10", "2026-05-01")).toBe("End date must be on or after the issue date");
  });

  test("the same day is allowed -- 'on or after'", () => {
    expect(endDateError("2026-05-10", "2026-05-10")).toBeUndefined();
  });

  test("a later end date is fine", () => {
    expect(endDateError("2026-05-10", "2026-11-01")).toBeUndefined();
  });

  test("says nothing until both dates exist", () => {
    expect(endDateError("", "2026-05-01")).toBeUndefined();
    expect(endDateError("2026-05-01", "")).toBeUndefined();
  });
});

describe("fileSizeError", () => {
  test("a file over the limit is refused before it is uploaded, with both numbers named", () => {
    expect(fileSizeError(14 * 1024 * 1024)).toBe(`This file is 14 MB; the limit is ${MAX_PDF_MB} MB`);
  });

  test("a file at or under the limit passes", () => {
    expect(fileSizeError(MAX_PDF_MB * 1024 * 1024)).toBeUndefined();
    expect(fileSizeError(1024)).toBeUndefined();
  });

  test("no file chosen is not an error -- that is the counter's job", () => {
    expect(fileSizeError(null)).toBeUndefined();
  });

  test("a size that would round to the limit is shown with a decimal, never as 'is 10 MB; the limit is 10 MB'", () => {
    expect(describeFileSize(10.4 * 1024 * 1024)).toBe("10.4 MB");
  });
});

describe("PermitCreateClient", () => {
  test("renders the framed create screen and names the project the permit will land on", () => {
    const view = render(<PermitCreateClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" />);
    expect(view.getByRole("heading", { name: "New Permit" })).toBeTruthy();
    expect(view.getByText("Permits / New Permit")).toBeTruthy();
    expect(view.getByText("For project: Cedar Heights Villa - Phase 1")).toBeTruthy();
    expect(view.getByRole("button", { name: /Back/ })).toBeTruthy();
  });

  test("an empty form disables Save and states the reason beside it, not inside it", () => {
    const view = render(<PermitCreateClient projectId="p1" projectName="Cedar Heights Villa - Phase 1" />);
    const save = view.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(view.getByRole("status").textContent).toBe(
      "4 required fields still needed - permit name, issue date, end date, permit PDF"
    );
  });

  // The date-order and file-size messages themselves are asserted above,
  // against endDateError()/fileSizeError() directly. They are NOT re-asserted
  // by typing into the rendered form: in this repo's test environment
  // (React 19 + happy-dom under bun test) fireEvent.change updates the DOM
  // node but never reaches React's onChange, so a controlled input's state
  // cannot be driven from a test at all -- measured, not assumed, and the
  // reason no existing suite in this repo drives a form that way either. A
  // test that "typed" here would pass while proving nothing.

  test("carries the module's own vocabulary and marks the optional fields as optional", () => {
    const view = render(<PermitCreateClient projectId="p1" />);
    expect(view.getByLabelText("Permit name")).toBeTruthy();
    expect(view.getByLabelText("Permit number (optional)")).toBeTruthy();
    expect(view.getByLabelText("Issuing authority (optional)")).toBeTruthy();
    expect(view.getByLabelText("Permit PDF")).toBeTruthy();
    expect(view.getByText("PDF only, up to 10 MB")).toBeTruthy();
  });
});

// ─── R67 D-78: the permit PDF is checked, and storage is checked first ───────
describe("permitFileTypeError", () => {
  test("D-78's own message shape: what is wanted, and what was actually chosen", () => {
    expect(permitFileTypeError("approval.docx")).toBe("Choose a .pdf file — this is a .docx");
    expect(permitFileTypeError("scan.PNG")).toBe("Choose a .pdf file — this is a .png");
  });

  test("a PDF passes, whatever the case of its extension", () => {
    expect(permitFileTypeError("BP-2026-0142.pdf")).toBeUndefined();
    expect(permitFileTypeError("BP-2026-0142.PDF")).toBeUndefined();
  });

  test("no file chosen is not a type error -- that is the counter's job", () => {
    expect(permitFileTypeError(null)).toBeUndefined();
  });
});

describe("PermitCreateClient with storage unconfigured", () => {
  test("says so at the top of the form and puts the reason on the button itself", () => {
    const view = render(<PermitCreateClient projectId="p1" projectName="Cedar Heights" storageConfigured={false} />);
    expect(view.getByRole("alert").textContent).toBe(
      "File storage is not configured on this server — uploads will fail"
    );
    const save = view.getByRole("button", { name: "Save (file storage not configured)" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  test("with storage available the button keeps C-15's short label and the counter stays beside it", () => {
    const view = render(<PermitCreateClient projectId="p1" projectName="Cedar Heights" />);
    expect(view.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(view.getByRole("status").textContent).toBe(
      "4 required fields still needed - permit name, issue date, end date, permit PDF"
    );
  });
});
