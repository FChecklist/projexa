/// <reference types="bun-types" />
// R67 D-80 acceptance, the Material half of "pickers that cost one click": a
// master of exactly one material is preselected, and the material received last
// time on this project is offered back.
//
// The item's acceptance is a Playwright walk against http://localhost:3100 and
// this session may not start a dev server, so it is asserted against the real
// DOM. See EntityCombobox.test.tsx's header for the measured environment limit
// on typing.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_href: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push, replace: () => {}, prefetch: () => {} }) }));

const MaterialReceiptCreateClient = (await import("./MaterialReceiptCreateClient")).default;
import { lastChoiceKey } from "@/lib/last-choice";

const CEMENT = { id: "mat-cement", name: "Cement OPC 53", spec: "53 grade", unit: "bag", isActive: true };
const STEEL = { id: "mat-steel", name: "Steel rebar 12mm", spec: null, unit: "kg", isActive: true };
const RETIRED = { id: "mat-old", name: "Old admixture", spec: null, unit: "l", isActive: false };

function stub(materials: unknown[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/api/vendors") ? { vendors: [] } : { materials };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

afterEach(() => {
  cleanup();
  push.mockClear();
  try { window.localStorage.clear(); } catch { /* storage unavailable */ }
});

describe("MaterialReceiptCreateClient (D-80)", () => {
  test("a master of exactly ONE material opens with it shown", async () => {
    stub([CEMENT]);
    const { getByLabelText } = render(<MaterialReceiptCreateClient projectId="proj-cedar" />);
    await waitFor(() => expect((getByLabelText("Material") as HTMLInputElement).value).toBe("Cement OPC 53"));
  });

  test("a master of many preselects nothing on its own", async () => {
    stub([CEMENT, STEEL]);
    const { getByLabelText } = render(<MaterialReceiptCreateClient projectId="proj-cedar" />);
    await waitFor(() => expect((getByLabelText("Material") as HTMLInputElement).disabled).toBe(false));
    expect((getByLabelText("Material") as HTMLInputElement).value).toBe("");
  });

  test("the material received last time on THIS project comes back with no click", async () => {
    window.localStorage.setItem(lastChoiceKey("material", "proj-cedar"), "mat-steel");
    stub([CEMENT, STEEL]);
    const { getByLabelText } = render(<MaterialReceiptCreateClient projectId="proj-cedar" />);
    await waitFor(() => expect((getByLabelText("Material") as HTMLInputElement).value).toBe("Steel rebar 12mm"));
  });

  test("a remembered material that has been retired is NOT re-selected", async () => {
    window.localStorage.setItem(lastChoiceKey("material", "proj-cedar"), RETIRED.id);
    stub([CEMENT, STEEL, RETIRED]);
    const { getByLabelText } = render(<MaterialReceiptCreateClient projectId="proj-cedar" />);
    await waitFor(() => expect((getByLabelText("Material") as HTMLInputElement).disabled).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((getByLabelText("Material") as HTMLInputElement).value).toBe("");
  });

  test("the memory is per project, so another site's usual material is not applied here", async () => {
    window.localStorage.setItem(lastChoiceKey("material", "proj-marina"), "mat-steel");
    stub([CEMENT, STEEL]);
    const { getByLabelText } = render(<MaterialReceiptCreateClient projectId="proj-cedar" />);
    await waitFor(() => expect((getByLabelText("Material") as HTMLInputElement).disabled).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((getByLabelText("Material") as HTMLInputElement).value).toBe("");
  });
});
