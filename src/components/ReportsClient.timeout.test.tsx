/// <reference types="bun-types" />
// R67 E-30 (R-263). The TIMEOUT branch of the Reports panel, in its own file.
//
// WHY ITS OWN FILE. useTimedRun's real budget is 20 seconds, which is the
// point of it -- a test that waits that out is a test nobody runs. bun:test
// has no fake timers, and `mock.module` is process-global, so the only honest
// way to render this branch is to substitute the hook, and substituting it
// here would break the eight tests in ReportsClient.test.tsx that need the
// real one. `bun test --isolate` gives each file its own process, so the two
// coexist.
//
// The hook's own deadline arithmetic is tested for real (at a scaled budget)
// in src/lib/use-timed-run.test.ts. What is asserted HERE is the thing that
// test cannot see: what the panel puts on the screen when the deadline passes.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock(() => {}), refresh: mock(() => {}), replace: mock(() => {}) }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/reports",
}));
mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

// The real constant and the real sentence -- only the state machine is stubbed,
// so a change to R-263's wording still has to be made in one place.
import { DEFAULT_RUN_TIMEOUT_MS, timeoutSentence } from "@/lib/use-timed-run";

mock.module("@/lib/use-timed-run", () => ({
  DEFAULT_RUN_TIMEOUT_MS,
  timeoutSentence,
  useTimedRun: () => ({
    state: "timeout" as const,
    elapsedSeconds: 20,
    error: null,
    result: null,
    ranAt: null,
    durationMs: null,
    run: async () => null,
    cancel: () => {},
    reset: () => {},
  }),
}));

import { cleanup, render, waitFor } from "@testing-library/react";
import ReportsClient from "./ReportsClient";

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("ReportsClient -- the 20 s deadline (R67 E-30)", () => {
  test("says how long it waited, in words, and offers two real next steps", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ currencies: [] }), { status: 200 })) as typeof fetch;

    const { container, getAllByRole, getByRole } = render(
      <ReportsClient projectId="prj-cedar" projectName="Cedar Heights Villa - Phase 1" generatedBy="rajat" />
    );

    await waitFor(() => expect(container.textContent).toContain("This report did not answer in 20 s."));

    // [Run again] -- the same report, in case it was a blip. Two of them: the
    // parameter bar's and the panel's, so the reader finds one wherever they
    // are looking when the deadline passes.
    expect(getAllByRole("button", { name: "Run again" }).length).toBeGreaterThanOrEqual(1);

    // [Open Work Progress › Report] -- D-02's one WPR route, which is the
    // thing this path is usually a slow copy of.
    const escape = getByRole("link", { name: "Open Work Progress › Report" });
    const href = escape.getAttribute("href") ?? "";
    expect(href).toContain("/work-progress?tab=report");
    expect(href).toContain("projectId=prj-cedar");
  });

  test("a timed-out panel never shows a spinner or the idle prompt at the same time", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ currencies: [] }), { status: 200 })) as typeof fetch;

    const { container } = render(
      <ReportsClient projectId="prj-cedar" projectName="Cedar Heights Villa - Phase 1" generatedBy="rajat" />
    );

    await waitFor(() => expect(container.textContent).toContain("did not answer in 20 s"));
    expect(container.textContent).not.toContain("Running Project Status");
    expect(container.textContent).not.toContain("Choosing a report runs it.");
  });
});
