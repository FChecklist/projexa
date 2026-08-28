/// <reference types="bun-types" />
// R62 B7 regression test for F_022 (Critical), route-wiring half. See
// src/components/ProjectLoadError.test.tsx for the component-level test;
// this proves the actual /ffe route (the exact route F_022 was filed
// against) wires the fix in, not just that the shared component behaves
// correctly in isolation.
//
// Calling FfePage(props) directly and rendering the returned element tree
// works because an async Server Component called as a plain function (not
// routed through Next's own RSC pipeline) just resolves to ordinary JSX --
// there is no server-only serialization step in play here, since nothing on
// this page is itself a Server Action or uses a server-only import.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";

let mockSelection: { project: { id: string; name: string } | null; projects: unknown[]; errorMessage: string | null };

mock.module("@/lib/project-selection", () => ({
  resolveSelectedProject: async () => mockSelection,
}));
mock.module("@/lib/supabase/auth-guard", () => ({
  getServerOrganizationId: async () => "org-1",
}));
// Real FfeClient fetches on mount and would need a live /api/... backend;
// stubbed here since this suite is about the page's error-vs-content
// wiring, not FfeClient's own behavior (that has its own coverage).
mock.module("@/components/FfeClient", () => ({
  default: ({ projectId }: { projectId: string }) => <div data-testid="ffe-client">ffe client for {projectId}</div>,
}));
// ProjectLoadError calls useRouter() -- same requirement as its own test.
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));

const { default: FfePage } = await import("./page");

afterEach(cleanup);

describe("/ffe page (F_022)", () => {
  test("a VERIDIAN timeout renders ProjectLoadError with the backend's own message -- the page stays put, it does not redirect", async () => {
    mockSelection = {
      project: null,
      projects: [],
      errorMessage: "VERIDIAN request timed out after 20000ms: https://veridian-compliance-ai.vercel.app/api/v1/projexa/dashboard",
    };
    const jsx = await FfePage({ searchParams: Promise.resolve({}) });
    const { getByRole, queryByTestId } = render(jsx);
    // The heading (the page itself) is still present -- the recorded
    // symptom was leaving this page entirely, not staying on it with an
    // error card.
    expect(getByRole("heading", { name: "FF&E Specification" })).toBeDefined();
    const alert = getByRole("alert");
    expect(alert.textContent).toContain("VERIDIAN request timed out");
    expect(getByRole("button", { name: /Retry/i })).toBeDefined();
    expect(queryByTestId("ffe-client")).toBeNull();
  });

  test("a resolved project mounts the real FF&E module, not the error card", async () => {
    mockSelection = { project: { id: "proj-1", name: "Oakwood Residence" }, projects: [{ id: "proj-1", name: "Oakwood Residence" }], errorMessage: null };
    const jsx = await FfePage({ searchParams: Promise.resolve({}) });
    const { getByTestId, queryByRole } = render(jsx);
    expect(getByTestId("ffe-client").textContent).toContain("proj-1");
    expect(queryByRole("alert")).toBeNull();
  });

  test("no projects and no error shows the named empty state, never a blank/dead page", async () => {
    mockSelection = { project: null, projects: [], errorMessage: null };
    const jsx = await FfePage({ searchParams: Promise.resolve({}) });
    const { getByText, queryByRole, queryByTestId } = render(jsx);
    expect(getByText("No active projects yet.")).toBeDefined();
    expect(queryByRole("alert")).toBeNull();
    expect(queryByTestId("ffe-client")).toBeNull();
  });
});
