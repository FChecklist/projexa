/// <reference types="bun-types" />
// R62 B7 regression test for F_022 (Critical): "/ffe never renders content
// for the owner ... ~20s after the timeout the app auto-redirects the
// browser to /dashboard/overview instead of staying on /ffe and showing a
// retry/error state."
//
// ROOT CAUSE (R52, still current on this branch -- re-verified fresh this
// session by reading src/app/(app)/ffe/page.tsx and
// src/lib/project-selection.ts, not by trusting the fault row's own text):
// every project-scoped page gates its body on `{project && <Client .../>}`.
// When the upstream VERIDIAN call times out, resolveSelectedProject() (see
// src/lib/project-selection.ts) catches the error and returns
// `{ project: null, errorMessage }`. Nothing in that chain -- not the page,
// not project-selection.ts, not this component -- ever calls a router
// navigation. There is no redirect to escape from: the fix is that the page
// stays put and this component renders the backend's own message with a
// Retry that re-runs the server component in place (router.refresh()).
//
// THIS SUITE pins the one behavior that IS the fix and would catch a
// regression back toward the original symptom: the component must render
// the real backend message (never a generic one), must never itself
// navigate away (no push/replace -- only refresh, and only on click, never
// on mount), and must tell the truth after repeated failures instead of
// leaving the user clicking a dead control forever.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// See src/components/ui/form-field.test.tsx for why this guard exists:
// `bun test` runs every file in one process, and re-registering happy-dom
// throws.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";

let pushCalls: string[] = [];
let refreshCalls = 0;

// ProjectLoadError calls useRouter() from next/navigation, which throws
// outside a real Next.js App Router tree. Mocked before the component is
// imported -- same mock.module pattern src/components/CreateProjectDialog.test.tsx
// already uses for the identical problem.
mock.module("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => {
      refreshCalls += 1;
    },
    push: (href: string) => {
      pushCalls.push(href);
    },
    replace: (href: string) => {
      pushCalls.push(href);
    },
  }),
}));

const { default: ProjectLoadError } = await import("./ProjectLoadError");

afterEach(() => {
  cleanup();
  pushCalls = [];
  refreshCalls = 0;
});

describe("ProjectLoadError (F_022)", () => {
  test("renders the backend's own message, not a generic one", () => {
    const { getByRole } = render(
      <ProjectLoadError message="VERIDIAN request timed out after 20000ms: https://veridian-compliance-ai.vercel.app/api/v1/projexa/dashboard" />
    );
    const alert = getByRole("alert");
    expect(alert.textContent).toBe(
      "VERIDIAN request timed out after 20000ms: https://veridian-compliance-ai.vercel.app/api/v1/projexa/dashboard"
    );
  });

  test("never navigates away on its own -- mounting it fires no push/replace/refresh, and schedules no timer that could", () => {
    // This is the direct guard against the recorded symptom: the page used
    // to leave /ffe on its own ~20s after mount. Waiting out a real 20s
    // timer in a test would be both slow and an incomplete guard (any other
    // delay would slip past it), so instead this spies on setTimeout itself
    // -- proving no delayed-navigation timer is ever armed by mounting this
    // component, for any delay.
    const originalSetTimeout = globalThis.setTimeout;
    const scheduled: number[] = [];
    // @ts-expect-error -- test-only spy, restored immediately after
    globalThis.setTimeout = (fn: TimerHandler, delay?: number, ...rest: unknown[]) => {
      scheduled.push(delay ?? 0);
      return originalSetTimeout(fn as () => void, delay, ...rest);
    };
    try {
      render(<ProjectLoadError message="boom" />);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
    expect(scheduled).toEqual([]);
    expect(pushCalls).toEqual([]);
    expect(refreshCalls).toBe(0);
  });

  test("Retry re-runs the server component in place (router.refresh()) and never redirects (push/replace)", () => {
    const { getByRole } = render(<ProjectLoadError message="boom" />);
    fireEvent.click(getByRole("button", { name: /Retry/i }));
    expect(refreshCalls).toBe(1);
    expect(pushCalls).toEqual([]);
  });

  test("after repeated failures it says the true thing instead of leaving the user clicking a dead control forever", () => {
    const { getByRole, queryByText } = render(<ProjectLoadError message="boom" />);
    const retry = getByRole("button", { name: /Retry/i });
    expect(queryByText(/workspace backend is degraded/i)).toBeNull();
    fireEvent.click(retry);
    expect(queryByText(/workspace backend is degraded/i)).toBeNull();
    fireEvent.click(retry);
    expect(queryByText(/Still failing after 2 attempts/i)).not.toBeNull();
    expect(pushCalls).toEqual([]);
  });
});
