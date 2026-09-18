/// <reference types="bun-types" />
// Sumeet requirement (new): the 28-item exceptions report, real UI over a
// mocked /api/exceptions, same convention as BudgetsClient.test.tsx.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const ExceptionsClient = (await import("./ExceptionsClient")).default;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderClient(checks: unknown[]) {
  globalThis.fetch = (async () => jsonRes({ checks })) as typeof fetch;
  return render(<ExceptionsClient projectId="proj-1" />);
}

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

const CLEAR_CHECK = { item: 1, title: "Extra work done, never captured", flagged: false, count: 0, records: [], formula: "Diary vs progress entry" };
const FLAGGED_CHECK = { item: 5, title: "Approvals stuck", flagged: true, count: 1, records: [{ id: "co1", detail: "CO-1 pending 10 days" }], formula: "Change order pending_approval past the threshold" };

describe("ExceptionsClient", () => {
  test("all-clear project shows the honest all-clear summary", async () => {
    const { getByText } = renderClient([CLEAR_CHECK]);
    await waitFor(() => expect(getByText(/all 1 checks are clear/)).toBeDefined());
  });

  test("a flagged check shows the real count in the summary and its own badge", async () => {
    const { getAllByText, getByText } = renderClient([CLEAR_CHECK, FLAGGED_CHECK]);
    await waitFor(() =>
      expect(getAllByText((_, node) => node?.textContent === "1 of 2 checks are flagged on this project.").length).toBeGreaterThan(0)
    );
    expect(getByText("1 flagged")).toBeDefined();
    expect(getByText("Clear")).toBeDefined();
  });

  test("clicking a flagged check expands its real records", async () => {
    const { getByText } = renderClient([FLAGGED_CHECK]);
    await waitFor(() => expect(getByText(/Approvals stuck/)).toBeDefined());
    fireEvent.click(getByText(/Approvals stuck/));
    await waitFor(() => expect(getByText("CO-1 pending 10 days")).toBeDefined());
  });

  test("a failed load shows the real error, not a silent blank screen", async () => {
    globalThis.fetch = (async () => jsonRes({ error: "No organisation on this account" }, 400)) as typeof fetch;
    const { getByText } = render(<ExceptionsClient projectId="proj-1" />);
    await waitFor(() => expect(getByText(/No organisation on this account/)).toBeDefined());
  });
});
