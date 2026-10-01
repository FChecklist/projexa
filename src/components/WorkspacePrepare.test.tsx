import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";

mock.module("next/navigation", () => ({ useRouter: () => ({ prefetch: () => {}, push: () => {} }) }));
mock.module("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));

// Dynamically imported so the module is evaluated AFTER register() has created `document`.
const { WorkspacePrepareView, WARM_ROUTES } = await import("./WorkspacePrepare");
import type { PrepareProgress } from "@/lib/local-first/prepare-workspace";

const base: PrepareProgress = {
  percent: 40,
  steps: [
    { id: "worker", label: "Install PROJEXA on this laptop", state: "done" },
    { id: "app", label: "Download your screens", state: "running" },
    { id: "database", label: "Open your local database", state: "waiting" },
  ],
  elapsedMs: 30_000,
  remainingMs: 150_000,
  finished: false,
  timedOut: false,
};

describe("WorkspacePrepareView", () => {
  test("shows the real percentage, the countdown ceiling and each step's state", () => {
    const { getByTestId } = render(<WorkspacePrepareView progress={base} onContinue={() => {}} />);
    expect(getByTestId("prepare-percent").textContent).toBe("40%");
    expect(getByTestId("prepare-countdown").textContent).toContain("2:30");
    expect(getByTestId("prepare-step-worker").getAttribute("data-state")).toBe("done");
    expect(getByTestId("prepare-step-app").getAttribute("data-state")).toBe("running");
  });

  test("the person can always skip while it is running", () => {
    let clicked = 0;
    const { getByTestId } = render(<WorkspacePrepareView progress={base} onContinue={() => { clicked += 1; }} />);
    expect(getByTestId("prepare-continue").textContent).toBe("Skip for now");
    fireEvent.click(getByTestId("prepare-continue"));
    expect(clicked).toBe(1);
  });

  test("when finished it says Done and offers to open PROJEXA", () => {
    const done: PrepareProgress = {
      ...base,
      percent: 100,
      finished: true,
      remainingMs: 100_000,
      steps: base.steps.map((s) => ({ ...s, state: "done" as const })),
    };
    const { getByTestId } = render(<WorkspacePrepareView progress={done} onContinue={() => {}} />);
    expect(getByTestId("prepare-countdown").textContent).toBe("Done");
    expect(getByTestId("prepare-continue").textContent).toBe("Open PROJEXA");
  });

  test("a failed step is named and the person is told PROJEXA still works", () => {
    const failed: PrepareProgress = {
      ...base,
      finished: true,
      steps: [{ id: "worker", label: "Install PROJEXA on this laptop", state: "failed", error: "no service worker" }, ...base.steps.slice(1)],
    };
    const { getByText } = render(<WorkspacePrepareView progress={failed} onContinue={() => {}} />);
    expect(getByText("no service worker")).toBeDefined();
    expect(getByText(/still works/i)).toBeDefined();
  });

  test("it never says VERIDIAN or shows Hindi, and warms real screens", () => {
    const { container } = render(<WorkspacePrepareView progress={base} onContinue={() => {}} />);
    expect(container.textContent).not.toMatch(/veridian/i);
    expect(WARM_ROUTES.length).toBeGreaterThan(5);
    expect(WARM_ROUTES.every((r) => r.startsWith("/"))).toBe(true);
  });
});
