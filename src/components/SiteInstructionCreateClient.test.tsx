/// <reference types="bun-types" />
// R-C14. The rendered create screen: named fields, an empty form's Save disabled with the missing fields named beside it.
// (Typing into controlled inputs cannot be driven in this repo's happy-dom setup -- see PermitCreateClient.test.tsx -- so the
// rules and the receipt are asserted against the pure helpers in src/lib/site-instruction-form.test.ts.)
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

const push = mock((_: string) => {});
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({ ...realNavigation, useRouter: () => ({ push }) }));

const SiteInstructionCreateClient = (await import("./SiteInstructionCreateClient")).default;

afterEach(() => { cleanup(); push.mockClear(); });

describe("SiteInstructionCreateClient", () => {
  test("renders the framed create screen and names the project and BOQ it will attach to", () => {
    const view = render(<SiteInstructionCreateClient projectId="p1" projectName="Cedar Heights" boqId="b1" boqTitle="Civil Works" />);
    expect(view.getByRole("heading", { name: "New Site Instruction" })).toBeTruthy();
    expect(view.getByText("For project: Cedar Heights · Linked to BOQ: Civil Works")).toBeTruthy();
  });

  test("has every field of the record and the optional file", () => {
    const view = render(<SiteInstructionCreateClient projectId="p1" />);
    for (const label of ["Issue date", "To contractor", "Instruction", "Drawing reference (optional)", "Instruction file (optional)"]) {
      expect(view.getByLabelText(label)).toBeTruthy();
    }
  });

  test("an empty form disables Save and names the missing fields beside it", () => {
    const view = render(<SiteInstructionCreateClient projectId="p1" />);
    expect((view.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    // the issue date defaults to today, so only the two typed fields are missing
    expect(view.getByRole("status").textContent).toBe("2 required fields still needed - to contractor, instruction");
  });
});
