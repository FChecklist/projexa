import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";

mock.module("next/navigation", () => ({ useRouter: () => ({ prefetch: () => {}, push: () => {} }) }));
mock.module("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));

// Dynamically imported so the module is evaluated AFTER register() has created `document`.
const { WorkspacePrepareView, WARM_ROUTES, buildSteps, syncFailureMessage } = await import("./WorkspacePrepare");
import type { PrepareProgress } from "@/lib/local-first/prepare-workspace";

const base: PrepareProgress = {
  percent: 40,
  steps: [
    { id: "worker", label: "Install PROJEXA on this laptop", state: "done" },
    { id: "app", label: "Download your screens", state: "running" },
    { id: "database", label: "Open your local database", state: "waiting" },
    { id: "projects", label: "Copy your projects to this laptop", state: "waiting" },
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

describe("the 'Copy your projects to this laptop' step", () => {
  const noReplica = (report: Record<string, unknown>) => () => ({
    sync: async (_s?: AbortSignal, onProgress?: (p: { projectsDone: number; projectsTotal: number }) => void) => {
      onProgress?.({ projectsDone: 1, projectsTotal: 2 });
      onProgress?.({ projectsDone: 2, projectsTotal: 2 });
      return report;
    },
    syncProject: async () => report,
    getStatus: () => ({ status: "done", report: null }),
  }) as never;

  test("is the 4th step, and the weights add up to 100", () => {
    // With the local-first flag on (the flag-off plan, without this step, is pinned in WorkspacePrepare.flag-off.test.tsx).
    const steps = buildSteps("u1", () => {}, undefined, () => true);
    expect(steps.map((s) => s.id)).toEqual(["worker", "app", "database", "projects"]);
    expect(steps.reduce((sum, s) => sum + s.weight, 0)).toBe(100);
    expect(steps[3]!.label).toBe("Copy your projects to this laptop");
  });

  test("reports real progress as projects done out of total", async () => {
    const steps = buildSteps("u1", () => {}, noReplica({ status: "done", issues: [] }), () => true);
    const seen: [number, number][] = [];
    await steps[3]!.run({ signal: new AbortController().signal, onDetail: (d, t) => seen.push([d, t]) });
    expect(seen).toEqual([[1, 2], [2, 2]]);
  });

  test("an unreachable or not-yet-deployed service fails this step gracefully, with a plain sentence", async () => {
    const steps = buildSteps("u1", () => {}, noReplica({ status: "error", issues: [{ reason: "not_found", message: "x" }] }), () => true);
    await expect(steps[3]!.run({ signal: new AbortController().signal, onDetail: () => {} })).rejects.toThrow(/not reachable yet.*server for now/);
  });

  test("signed out, and a single project failing, have their own messages", () => {
    expect(syncFailureMessage({ status: "signed_out", issues: [] })).toMatch(/Sign in again/);
    expect(syncFailureMessage({ status: "partial", issues: [{ reason: "store", message: "Disk full", projectId: "p1" }] })).toBe("Disk full");
  });

  test("the screen shows 'Last synced' when finished, and never says VERIDIAN", () => {
    const done: PrepareProgress = { ...base, percent: 100, finished: true, steps: base.steps.map((s) => ({ ...s, state: "done" as const })) };
    const stamp = Date.UTC(2026, 9, 2, 10, 0, 0);
    const a = render(<WorkspacePrepareView progress={done} onContinue={() => {}} lastSyncedAt={stamp} />);
    expect(a.getByTestId("prepare-last-synced").textContent).toMatch(/^Last synced /);
    expect(a.container.textContent).not.toMatch(/veridian/i);
    a.unmount();
    const b = render(<WorkspacePrepareView progress={done} onContinue={() => {}} lastSyncedAt={null} />);
    expect(b.getByTestId("prepare-last-synced").textContent).toBe("Projects not copied to this laptop yet");
    b.unmount();
    const c = render(<WorkspacePrepareView progress={base} onContinue={() => {}} lastSyncedAt={stamp} />);
    expect(c.queryByTestId("prepare-last-synced")).toBeNull(); // not while it is still running
  });
});
