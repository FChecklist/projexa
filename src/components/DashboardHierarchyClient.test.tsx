/// <reference types="bun-types" />
// R67 E-37 (R-269 / R-298). One sentence used to cover four situations.
//
// "No company memberships found for this account." was what this screen said
// when the request FAILED, when the caller genuinely belonged to nowhere, and
// when the organisation had no company row. Three different facts, three
// different next actions -- and the first of them is not an empty list at all,
// which is the confident-empty-state defect this audit keeps closing.
//
// The item's own acceptance is Playwright against a live demo org; what can be
// proved without a server is proved here: each state renders its own sentence
// and its own action, and the old blanket sentence is gone from all of them.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), refresh: mock(() => {}), replace: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/dashboard/hierarchy",
}));

import { cleanup, render, waitFor } from "@testing-library/react";
import { DashboardHierarchyClient } from "./DashboardHierarchyClient";

let companyCalls = 0;

function stubFetch(handler: (url: string) => Response) {
  companyCalls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/dashboard-hierarchy/companies")) companyCalls += 1;
    return handler(url);
  }) as typeof fetch;
}

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

const OLD_SENTENCE = "No company memberships found for this account.";

describe("R67 E-37: the company list says WHY it is empty", () => {
  test("a failed companies request reads 'Couldn't load your companies' with a Retry, never an empty list", async () => {
    stubFetch((url) =>
      url.endsWith("/api/dashboard-hierarchy/companies")
        ? new Response(JSON.stringify({ error: "boom" }), { status: 500 })
        : ok({})
    );
    const { container, getByText } = render(<DashboardHierarchyClient />);

    await waitFor(() => expect(container.textContent).toContain("Couldn't load your companies"));
    expect(container.textContent).not.toContain(OLD_SENTENCE);

    // The Retry really re-issues the request the reader is trying to fix.
    expect(companyCalls).toBe(1);
    (getByText("Retry") as HTMLButtonElement).click();
    await waitFor(() => expect(companyCalls).toBe(2));
  });

  test("an organisation with no company row offers Set up company and a way back", async () => {
    stubFetch((url) =>
      url.endsWith("/api/dashboard-hierarchy/companies")
        ? ok({ companies: [], synthesized: false, emptyReason: "no-company" })
        : ok({})
    );
    const { container } = render(<DashboardHierarchyClient />);

    await waitFor(() => expect(container.textContent).toContain("This organisation is not set up as a company yet"));
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/settings");
    expect(hrefs).toContain("/dashboard");
    expect(container.textContent).not.toContain(OLD_SENTENCE);
  });

  test("a caller who belongs to no company is told who can add them, with the path linked", async () => {
    stubFetch((url) =>
      url.endsWith("/api/dashboard-hierarchy/companies")
        ? ok({ companies: [], synthesized: false, emptyReason: "not-a-member" })
        : ok({})
    );
    const { container } = render(<DashboardHierarchyClient />);

    await waitFor(() =>
      expect(container.textContent).toContain("Your account is not a member of any company yet")
    );
    expect(container.textContent).toContain("Settings › Companies");
    expect(container.querySelector('[data-testid="hierarchy-not-a-member"] a')?.getAttribute("href")).toBe("/settings");
    expect(container.textContent).not.toContain(OLD_SENTENCE);
  });

  test("a synthesised company is selected like any other -- the hierarchy has a root and loads its projects", async () => {
    stubFetch((url) => {
      if (url.endsWith("/api/dashboard-hierarchy/companies")) {
        return ok({
          companies: [{ id: "org_demo", name: "Demo Organization", slug: "demo", country: "AE", role: "owner" }],
          synthesized: true,
          emptyReason: "none",
        });
      }
      if (url.includes("/departments")) return ok({ departments: [] });
      if (url.includes("/dashboard")) {
        return ok({
          totalProjects: 1,
          totalBudget: 0,
          totalRevenue: 0,
          totalExpenses: 0,
          projects: [
            { id: "prj-1", name: "Cedar Heights Villa - Phase 1", revenue: 100, expenses: 40, taskCount: 3, delayedTaskCount: 0 },
          ],
        });
      }
      return ok({});
    });
    const { container } = render(<DashboardHierarchyClient />);

    // The Filter control states the scope, which is how a reader knows which
    // company they are looking at without opening anything.
    await waitFor(() => expect(container.textContent).toContain("Filter: Demo Organization"));
    await waitFor(() => expect(container.textContent).toContain("Cedar Heights Villa - Phase 1"));
    expect(container.textContent).not.toContain(OLD_SENTENCE);
  });
});
