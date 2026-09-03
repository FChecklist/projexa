/// <reference types="bun-types" />
// R67 D-44 / D-47 for the activity Object Page.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const push = mock((_href: string) => {});
mock.module("next/navigation", () => ({
  useRouter: () => ({ push, prefetch: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/schedule/tasks/t1",
  useSearchParams: () => new URLSearchParams(),
}));

const ScheduleTaskObjectClient = (await import("./ScheduleTaskObjectClient")).default;

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const TASK = {
  id: "t1", projectId: "proj-cedar", number: 12, title: "Joinery shop drawings", description: null,
  priority: "medium", statusId: "s1", startDate: "2026-08-01", dueDate: "2026-09-05",
  completionPercentage: 40, isArchived: false,
};

function renderClient(props: { backTo?: string; createdNumber?: string } = {}) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/board")) return jsonRes({ columns: [{ id: "s1", name: "In progress" }] });
    if (url.includes("/api/schedule/tasks/")) return jsonRes(TASK);
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
  return render(<ScheduleTaskObjectClient taskId="t1" {...props} />);
}

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("D-47 the create receipt", () => {
  test("opens with 'Activity #12 created' in the persistent message area", async () => {
    const { findByText } = renderClient({ createdNumber: "12" });
    await findByText("Activity #12 created");
  });

  test("without the parameter no message is claimed", async () => {
    const { container, findByText } = renderClient();
    await findByText(/Joinery shop drawings/);
    expect(container.textContent).not.toContain("created");
  });
});

describe("D-44 Back returns to the list as the user left it", () => {
  test("uses the return address the row supplied", async () => {
    const backTo = "/schedule?projectId=proj-cedar&tab=timeline&q=Joinery";
    const { findByText } = renderClient({ backTo });
    fireEvent.click(await findByText("← Back"));
    await waitFor(() => expect(push).toHaveBeenCalledWith(backTo));
  });

  test("falls back to the project's own timeline when there is no return address", async () => {
    const { findByText } = renderClient();
    fireEvent.click(await findByText("← Back"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/schedule?projectId=proj-cedar&tab=timeline"));
  });
});
