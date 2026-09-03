/// <reference types="bun-types" />
// R67 D-80 acceptance, the Worker half: "with exactly one worker in the roster,
// /labour/attendance/new opens with the Worker field showing that name and Save
// enabled after Date is set". Date defaults to today on this form, so "after
// Date is set" is already true on arrival.
//
// The item's acceptance is a Playwright walk against http://localhost:3100 and
// this session may not start a dev server, so it is asserted against the real
// DOM instead. See EntityCombobox.test.tsx's header for the measured
// environment limit on typing.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_href: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ push, replace: () => {}, prefetch: () => {} }) }));

const AttendanceCreateClient = (await import("./AttendanceCreateClient")).default;
import { lastChoiceKey } from "@/lib/last-choice";

const ONE = [{ id: "r1", name: "Masood Alam", employeeCode: "EMP-001", trade: "Mason", isActive: true }];
const MANY = [
  ...ONE,
  { id: "r2", name: "Bilal Khan", employeeCode: "EMP-002", trade: "Carpenter", isActive: true },
  { id: "r3", name: "Retired Worker", employeeCode: "EMP-003", trade: "Mason", isActive: false },
];

function stub(roster: unknown[]) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ roster }), { status: 200, headers: { "content-type": "application/json" } })
  ) as typeof fetch;
}

function saveButton(container: HTMLElement) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Save")) as HTMLButtonElement | undefined;
}

afterEach(() => {
  cleanup();
  push.mockClear();
  try { window.localStorage.clear(); } catch { /* storage unavailable */ }
});

describe("AttendanceCreateClient (D-80)", () => {
  test("a roster of exactly ONE opens with that worker shown, and Save is already enabled", async () => {
    stub(ONE);
    const { container, getByLabelText } = render(<AttendanceCreateClient projectId="proj-cedar" />);
    await waitFor(() => expect((getByLabelText("Worker") as HTMLInputElement).value).toBe("Masood Alam"));
    // Date defaults to today, so with the worker answered nothing is missing.
    await waitFor(() => expect(saveButton(container)?.disabled).toBe(false));
    expect(saveButton(container)?.textContent).toBe("Save");
  });

  test("a roster of many preselects nobody, and Save says which field is unanswered", async () => {
    stub(MANY);
    const { container, getByLabelText } = render(<AttendanceCreateClient projectId="proj-cedar" />);
    await waitFor(() => expect((getByLabelText("Worker") as HTMLInputElement).disabled).toBe(false));
    expect((getByLabelText("Worker") as HTMLInputElement).value).toBe("");
    expect(saveButton(container)?.textContent).toBe("Save (Worker)");
  });

  test("the last worker marked on THIS project comes back with no click", async () => {
    window.localStorage.setItem(lastChoiceKey("worker", "proj-cedar"), "r2");
    stub(MANY);
    const { getByLabelText } = render(<AttendanceCreateClient projectId="proj-cedar" />);
    await waitFor(() => expect((getByLabelText("Worker") as HTMLInputElement).value).toBe("Bilal Khan"));
  });

  test("a remembered worker who has left the roster is NOT re-selected", async () => {
    // r3 is inactive, so the form filters them out of the options entirely.
    window.localStorage.setItem(lastChoiceKey("worker", "proj-cedar"), "r3");
    stub(MANY);
    const { getByLabelText } = render(<AttendanceCreateClient projectId="proj-cedar" />);
    await waitFor(() => expect((getByLabelText("Worker") as HTMLInputElement).disabled).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((getByLabelText("Worker") as HTMLInputElement).value).toBe("");
  });

  test("while the roster is in flight the field says Loading, not 'no workers'", () => {
    globalThis.fetch = (() => new Promise(() => {})) as unknown as typeof fetch;
    const { getByLabelText } = render(<AttendanceCreateClient projectId="proj-cedar" />);
    const field = getByLabelText("Worker") as HTMLInputElement;
    expect(field.disabled).toBe(true);
    expect(field.placeholder).toBe("Loading…");
  });
});
