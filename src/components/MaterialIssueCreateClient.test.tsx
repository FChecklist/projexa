/// <reference types="bun-types" />
// R67 D-40.
//
// WHAT THIS FILE CANNOT DO, STATED RATHER THAN WORKED AROUND. The item's
// acceptance is a Playwright step -- enter 130 on /materials/issues/new and see
// "Only 120 bags on hand" -- and this session may not start a dev server. The
// obvious substitution does not work either: this repo's test environment
// (happy-dom + React 19) does not deliver `input`/`change` events to React at
// all, verified with a minimal controlled-input harness, so NO test in this
// repo can type into a field. Clicks and keyboard events do arrive.
//
// So the rule itself -- including the exact sentence, the boundary at exactly
// the balance, and zero/negative/non-numeric input -- is exercised directly in
// src/lib/unit-label.test.ts, and this file covers what a click can reach: the
// option list, the preselection, the lookups' failure states and the
// disabled-with-reason Save label.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const push = mock(() => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push, prefetch: () => {} }) }));

const MaterialIssueCreateClient = (await import("./MaterialIssueCreateClient")).default;

const CEMENT = { id: "mat-cement", name: "Cement OPC 53", unit: "bag", isActive: true, receivedToDate: 200, issuedToDate: 80, onHand: 120 };
const SAND = { id: "mat-sand", name: "Sand", unit: "cum", isActive: true, receivedToDate: 10, issuedToDate: 10, onHand: 0 };

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Handler = (init?: RequestInit) => Response | Promise<Response>;

function router(handlers: Record<string, Handler>) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const path of Object.keys(handlers).sort((a, b) => b.length - a.length)) {
      if (url.includes(path)) return handlers[path](init);
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

function handlers(over: Partial<Record<string, Handler>> = {}): Record<string, Handler> {
  return {
    "/api/materials/master": () => jsonRes({ materials: [CEMENT, SAND] }),
    "/api/materials/issues": () => jsonRes({ id: "iss-1" }, 201),
    "/api/scope": () => jsonRes({ boqs: [] }),
    ...over,
  } as Record<string, Handler>;
}

function renderForm(over: Partial<Record<string, Handler>> = {}, initialMaterialId?: string) {
  globalThis.fetch = router(handlers(over));
  return render(<MaterialIssueCreateClient projectId="p1" initialMaterialId={initialMaterialId} />);
}

function saveButton(container: HTMLElement): HTMLButtonElement {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Save")) as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
  push.mockClear();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("MaterialIssueCreateClient (D-40)", () => {
  test("the Material list offers only what is actually on hand", async () => {
    const { getByText, queryByText, container } = renderForm();

    await waitFor(() => expect(container.querySelector("[data-slot='select-trigger']")).not.toBeNull());
    fireEvent.click(container.querySelector("[data-slot='select-trigger']")!);
    // Cement has 120 on hand and is offered; Sand has 0 and is not -- offering
    // it would be offering a choice that can only end in a refusal.
    await waitFor(() => expect(getByText("Cement OPC 53 — 120 bag on hand")).toBeDefined());
    expect(queryByText(/^Sand/)).toBeNull();
  });

  test("with nothing on hand anywhere, the picker says so instead of opening an empty list", async () => {
    const { getByText } = renderForm({ "/api/materials/master": () => jsonRes({ materials: [SAND] }) });
    await waitFor(() => expect(getByText("Nothing on hand to issue")).toBeDefined());
  });

  test("arriving from one material's row preselects it and shows its balance", async () => {
    const { getByText } = renderForm({}, CEMENT.id);
    await waitFor(() => expect(getByText("120 bag on hand")).toBeDefined());
  });

  test("Save names the fields it is still waiting for", async () => {
    const { container } = renderForm();
    await waitFor(() => expect(saveButton(container)).toBeDefined());
    // Issued Date defaults to today, so only Material and Quantity are open.
    expect(saveButton(container).textContent).toBe("Save (Material, Quantity)");
    expect(saveButton(container).disabled).toBe(true);
  });

  test("a failed material lookup says so at the field and offers Retry, instead of an empty dropdown", async () => {
    let attempts = 0;
    const { getByText, container } = renderForm({
      "/api/materials/master": () => {
        attempts += 1;
        return attempts === 1
          ? jsonRes({ error: "The construction data service didn't answer" }, 502)
          : jsonRes({ materials: [CEMENT] });
      },
    });

    await waitFor(() =>
      expect(getByText("Couldn't load the material master: The construction data service didn't answer")).toBeDefined()
    );
    fireEvent.click(getByText("Retry"));

    await waitFor(() => expect(container.querySelectorAll("[data-slot='select-trigger']").length).toBeGreaterThan(0));
    expect(attempts).toBe(2);
  });

  test("a failed BOQ lookup degrades the optional field only -- the form still saves without one", async () => {
    const { getByText, container } = renderForm({
      "/api/scope": () => jsonRes({ error: "Scope of work timed out" }, 504),
    }, CEMENT.id);

    await waitFor(() => expect(getByText("Couldn't load this project's BOQ lines: Scope of work timed out")).toBeDefined());
    // The Material field is untouched by the BOQ failure.
    expect(getByText("120 bag on hand")).toBeDefined();
    expect(saveButton(container).textContent).toBe("Save (Quantity)");
  });
});
