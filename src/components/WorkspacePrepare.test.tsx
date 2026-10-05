import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { describe, expect, mock, test } from "bun:test";
import { render } from "@testing-library/react";

mock.module("next/navigation", () => ({ useRouter: () => ({ prefetch: () => {}, push: () => {} }) }));
mock.module("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));

// Dynamically imported so the module is evaluated AFTER register() has created `document`.
const { WorkspacePrepareView, isPrepared, WARM_ROUTES, buildSteps, syncFailureMessage } = await import("./WorkspacePrepare");
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
  test("shows only the title, the sentence and the real percentage", () => {
    const { getByTestId, getByText, container } = render(<WorkspacePrepareView progress={base} />);
    expect(getByText("Preparing your PROJEXA workspace")).toBeDefined();
    expect(getByText(/PROJEXA workspace is being set up on this laptop/)).toBeDefined();
    expect(getByTestId("prepare-percent").textContent).toBe("40%");
    expect(container.querySelectorAll("li, button, [data-testid^='prepare-step']").length, "no step list, no buttons").toBe(0);
  });

  test("even after a failure it shows nothing but the percentage: no error text, no way in", () => {
    const failed: PrepareProgress = {
      ...base,
      finished: true,
      steps: [{ id: "worker", label: "Install PROJEXA on this laptop", state: "failed", error: "no service worker" }, ...base.steps.slice(1)],
    };
    const { queryByText, container } = render(<WorkspacePrepareView progress={failed} />);
    expect(queryByText("no service worker")).toBeNull();
    expect(queryByText(/Skip|Open PROJEXA|Try again|still works/)).toBeNull();
    expect(container.querySelectorAll("button").length).toBe(0);
  });

  test("isPrepared: only a finished, in-time run with every step done opens PROJEXA", () => {
    const done = base.steps.map((s) => ({ ...s, state: "done" as const }));
    expect(isPrepared({ ...base, finished: true, steps: done })).toBe(true);
    expect(isPrepared({ ...base, finished: false, steps: done })).toBe(false);
    expect(isPrepared({ ...base, finished: true, timedOut: true, steps: done })).toBe(false);
    expect(isPrepared({ ...base, finished: true, steps: [{ ...done[0]!, state: "failed" as const }, ...done.slice(1)] })).toBe(false);
  });

  test("it never says VERIDIAN or shows Hindi, and warms real screens", () => {
    const { container } = render(<WorkspacePrepareView progress={base} />);
    expect(container.textContent).not.toMatch(/veridian/i);
    expect(WARM_ROUTES.length).toBeGreaterThan(5);
    expect(WARM_ROUTES.every((r) => r.startsWith("/"))).toBe(true);
  });
});

describe("the 'Copy your projects to this laptop' step", () => {
  test("a project that cannot be read does not keep the person out; an unreachable service does", async () => {
    const steps = (report: Record<string, unknown>) => buildSteps("u1", () => {}, (() => ({ sync: async () => report })) as never, () => true);
    const run = (report: Record<string, unknown>) => steps(report).find((x) => x.id === "projects")!.run({ signal: new AbortController().signal, onDetail: () => {} } as never);
    await run({ status: "partial", issues: [{ reason: "not_found", message: "x", projectId: "p9" }] }); // resolves: let in
    let threw = false;
    await run({ status: "error", issues: [{ reason: "network", message: "x" }] }).catch(() => { threw = true; });
    expect(threw).toBe(true);
  });

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
});

// ONE-TIME install (owner, 2026-10-05): a refresh must never bring the full screen back because the PROJECTS copy did not finish.
import { isInstalled, quietRetryDelay } from "./WorkspacePrepare";
describe("one-time install", () => {
  const progress = (states: Record<string, string>) => ({
    percent: 70, elapsedMs: 0, remainingMs: 0, finished: false, timedOut: false,
    steps: Object.entries(states).map(([id, state]) => ({ id, label: id, state })),
  }) as never;
  test("installed once worker, screens and database are done, even if the projects copy failed", () => {
    expect(isInstalled(progress({ worker: "done", app: "done", database: "done", projects: "failed" }))).toBe(true);
  });
  test("not installed while the screens are still downloading", () => {
    expect(isInstalled(progress({ worker: "done", app: "running", database: "waiting", projects: "waiting" }))).toBe(false);
  });
  test("quiet retries back off to ten minutes", () => {
    expect(quietRetryDelay(0)).toBe(15_000);
    expect(quietRetryDelay(1)).toBe(30_000);
    expect(quietRetryDelay(20)).toBe(600_000);
  });
});
