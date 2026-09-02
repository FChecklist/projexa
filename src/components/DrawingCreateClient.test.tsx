/// <reference types="bun-types" />
// R67 D-08. The item's acceptance is a Playwright run with the project-
// resolution proxies stubbed to 500, which this lane may not do (no dev
// server). The same assertions are made here against the rendered component:
// with the project resolution failed, the screen still renders its own frame
// (heading "New Drawing", a Back control, a Retry control), the words
// "Internal Server Error" appear nowhere, and Save states the one reason that
// outranks every field.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

const push = mock((_: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push }) }));

const mod = await import("./DrawingCreateClient");
const DrawingCreateClient = mod.default;
const { describeProjectLoadFailure } = mod;

// The background project-name resolution must never resolve during these
// assertions -- a state update after the test body has run is noise, not
// signal. A pending fetch is exactly what the real screen shows first anyway.
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  push.mockClear();
  globalThis.fetch = realFetch;
});

describe("describeProjectLoadFailure", () => {
  test("a bare HTTP status phrase is replaced by a sentence that names what failed", () => {
    expect(describeProjectLoadFailure("Internal Server Error")).toBe(
      "The project list did not load — VERIDIAN answered with an internal error."
    );
    expect(describeProjectLoadFailure("internal server error.")).toBe(
      "The project list did not load — VERIDIAN answered with an internal error."
    );
  });

  test("a real backend message is kept verbatim -- this is not a message filter", () => {
    expect(describeProjectLoadFailure("VERIDIAN did not respond in time, on two attempts")).toBe(
      "VERIDIAN did not respond in time, on two attempts"
    );
    expect(describeProjectLoadFailure("No veridian_credentials row for this organisation")).toBe(
      "No veridian_credentials row for this organisation"
    );
  });
});

describe("DrawingCreateClient with a failed project resolution", () => {
  test("still renders its own screen: title, Back and Retry, and never the bare status phrase", () => {
    const view = render(<DrawingCreateClient projectId={null} projectError="Internal Server Error" />);

    expect(view.getByRole("heading", { name: "New Drawing" })).toBeTruthy();
    expect(view.getByText("Drawings & 3D / New Drawing")).toBeTruthy();
    expect(view.getByRole("button", { name: /Back/ })).toBeTruthy();
    expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(document.body.textContent).not.toContain("Internal Server Error");
    expect(view.getByRole("alert").textContent).toContain(
      "The project list did not load — VERIDIAN answered with an internal error."
    );
  });

  test("Save is disabled for the one reason that outranks every field", () => {
    const view = render(<DrawingCreateClient projectId={null} projectError="Internal Server Error" />);
    const save = view.getByRole("button", { name: "Save (Project not loaded)" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  test("a project id in the URL survives a failed project LIST -- the write only needs the id", () => {
    const view = render(
      <DrawingCreateClient projectId="proj-1" projectError="VERIDIAN did not respond in time, on two attempts" />
    );
    // The failure is still reported...
    expect(view.getByRole("alert").textContent).toContain("did not respond in time");
    // ...but the screen is usable, and Save's reason is about the form again.
    expect(view.getByRole("button", { name: "Save (Name is required)" })).toBeTruthy();
  });
});

describe("DrawingCreateClient with a resolved project", () => {
  test("names the project the drawing will land on and reports no failure", () => {
    const view = render(
      <DrawingCreateClient projectId="proj-1" projectName="Cedar Heights Villa - Phase 1" projectError={null} />
    );
    expect(view.getByText("For project: Cedar Heights Villa - Phase 1")).toBeTruthy();
    expect(view.queryByRole("alert")).toBeNull();
    expect(view.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
