/// <reference types="bun-types" />
// Sumeet requirement #2: milestones are a real, distinct entity, creatable
// and status-editable from PROJEXA itself.
//
// The create form's text fields (Name/Description/Target date) are NOT
// typed into here: in this repo's test environment (React 19 + happy-dom
// under bun test) fireEvent.change updates a controlled text input's DOM
// node but never reaches React's onChange, so its state cannot be driven
// from a test at all -- already measured and documented by
// PermitCreateClient.test.tsx / BudgetAnalyticalClient.test.tsx in this same
// lane. What typing would decide is instead asserted against
// buildMilestoneCreatePayload() directly (same precedent as
// budgetPercentError/vendorAmountError), and the disabled-Save/empty-state
// wiring is asserted against the real, statically-rendered DOM. The status
// <select> DOES work with fireEvent.change (native selects are unaffected,
// see BudgetAnalyticalClient's own vendor-picker test) and is driven for
// real below.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const { default: MilestonesClient, buildMilestoneCreatePayload, NAME_REQUIRED } = await import("./MilestonesClient");

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

const MILESTONE = {
  id: "ms-1", name: "Foundation complete", description: null,
  targetDate: "2026-10-01", status: "planned" as const, completionPercentage: 40,
};

function renderClient(over: Partial<Record<string, Handler>> = {}) {
  globalThis.fetch = router({
    "/api/milestones": () => jsonRes({ milestones: [MILESTONE] }),
    ...over,
  });
  return render(<MilestonesClient projectId="proj-1" />);
}

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("buildMilestoneCreatePayload", () => {
  test("trims name and omits blank description/targetDate rather than sending empty strings", () => {
    expect(buildMilestoneCreatePayload("proj-1", "  Roof slab complete  ", "", "")).toEqual({
      projectId: "proj-1", name: "Roof slab complete", description: undefined, targetDate: undefined,
    });
  });

  test("keeps a real description and targetDate when given", () => {
    expect(buildMilestoneCreatePayload("proj-1", "Roof slab complete", "All roof pours done", "2026-11-01")).toEqual({
      projectId: "proj-1", name: "Roof slab complete", description: "All roof pours done", targetDate: "2026-11-01",
    });
  });

  test("whitespace-only description is treated as absent, same as an empty one", () => {
    expect(buildMilestoneCreatePayload("proj-1", "Name", "   ", "")).toEqual({
      projectId: "proj-1", name: "Name", description: undefined, targetDate: undefined,
    });
  });
});

describe("MilestonesClient", () => {
  test("lists a real milestone with its derived completion percentage and status", async () => {
    const { getByText } = renderClient();
    await waitFor(() => expect(getByText("Foundation complete")).toBeDefined());
    expect(getByText(/40% complete/)).toBeDefined();
    expect(getByText(/Target: 2026-10-01/)).toBeDefined();
  });

  test("an empty project shows the honest empty state, not a spinner forever", async () => {
    const { getByText } = renderClient({ "/api/milestones": () => jsonRes({ milestones: [] }) });
    await waitFor(() => expect(getByText("No milestones yet.")).toBeDefined());
  });

  test("the create form opens with Save disabled and the real reason, until a name exists", async () => {
    const { getByText, getByRole } = renderClient({ "/api/milestones": () => jsonRes({ milestones: [] }) });
    await waitFor(() => expect(getByText("No milestones yet.")).toBeDefined());
    fireEvent.click(getByText("New Milestone"));
    const save = getByRole("button", { name: `Save (${NAME_REQUIRED})` }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.title).toBe(NAME_REQUIRED);
  });

  test("changing status PATCHes /api/milestones/[id] with the new status", async () => {
    let patchedBody: Record<string, unknown> | null = null;
    const { getByText, getByLabelText } = renderClient({
      "/api/milestones/ms-1": (init) => {
        patchedBody = JSON.parse(String(init?.body ?? "{}"));
        return jsonRes({ ...MILESTONE, status: "in_progress" });
      },
    });

    await waitFor(() => expect(getByText("Foundation complete")).toBeDefined());
    fireEvent.change(getByLabelText("Status for Foundation complete"), { target: { value: "in_progress" } });

    await waitFor(() => expect(patchedBody).toEqual({ status: "in_progress" }));
  });
});
