/// <reference types="bun-types" />
// R67 D-38 acceptance. The item's own acceptance is a Playwright walk against
// http://localhost:3100; this session may not start a dev server, so the same
// strings and the same navigation are asserted against the real DOM instead.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { RAIL_PROJECT_KEY } from "@/lib/rail-project";

const replace = mock((_href: string) => {});
mock.module("next/navigation", () => ({ useRouter: () => ({ replace, push: () => {}, prefetch: () => {} }) }));

const MaterialsProjectChooser = (await import("./MaterialsProjectChooser")).default;

const PROJECTS = [
  { id: "proj-cedar", name: "Cedar Heights Villa - Phase 1" },
  { id: "proj-marina", name: "Marina Tower Fit-out" },
];

const PROMPT = "Materials are kept per project — pick a project to continue";

afterEach(() => {
  cleanup();
  replace.mockClear();
  try { window.sessionStorage.clear(); } catch {}
});

describe("MaterialsProjectChooser (D-38)", () => {
  test("with no rail selection it asks, and shows no project's rows", async () => {
    const { getByText, queryByRole } = render(<MaterialsProjectChooser projects={PROJECTS} />);

    await waitFor(() => expect(getByText(PROMPT)).toBeDefined());
    // A chooser, not a table: nothing has been decided, so nothing is listed as
    // if it had been.
    expect(queryByRole("table")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  test("both writes stay rendered and carry the reason 'Pick a project first'", async () => {
    const { getByText, getByTestId } = render(<MaterialsProjectChooser projects={PROJECTS} />);

    await waitFor(() => expect(getByText(PROMPT)).toBeDefined());

    const newMaterial = getByTestId("materials-new") as HTMLButtonElement;
    expect(newMaterial.textContent).toBe("+ New Material (Pick a project first)");
    expect(newMaterial.disabled).toBe(true);

    const recordReceipt = getByText("Record Receipt (Pick a project first)").closest("button") as HTMLButtonElement;
    expect(recordReceipt.disabled).toBe(true);
  });

  test("picking a project stores the rail selection and puts it in the URL", async () => {
    const { getByText } = render(<MaterialsProjectChooser projects={PROJECTS} />);

    await waitFor(() => expect(getByText(PROMPT)).toBeDefined());
    fireEvent.click(getByText("Cedar Heights Villa - Phase 1"));

    expect(window.sessionStorage.getItem(RAIL_PROJECT_KEY)).toBe("proj-cedar");
    expect(replace).toHaveBeenCalledWith("/materials?projectId=proj-cedar");
  });

  test("the tab the user asked for survives the choice", async () => {
    const { getByText } = render(<MaterialsProjectChooser projects={PROJECTS} tab="receipts" />);

    await waitFor(() => expect(getByText(PROMPT)).toBeDefined());
    fireEvent.click(getByText("Marina Tower Fit-out"));

    expect(replace).toHaveBeenCalledWith("/materials?projectId=proj-marina&tab=receipts");
  });

  test("a rail selection is honoured without asking again", async () => {
    window.sessionStorage.setItem(RAIL_PROJECT_KEY, "proj-marina");
    const { queryByText } = render(<MaterialsProjectChooser projects={PROJECTS} />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/materials?projectId=proj-marina"));
    expect(queryByText(PROMPT)).toBeNull();
  });

  test("a stale rail selection for a project this org no longer has falls back to asking", async () => {
    window.sessionStorage.setItem(RAIL_PROJECT_KEY, "proj-deleted");
    const { getByText } = render(<MaterialsProjectChooser projects={PROJECTS} />);

    await waitFor(() => expect(getByText(PROMPT)).toBeDefined());
    expect(replace).not.toHaveBeenCalled();
  });
});
