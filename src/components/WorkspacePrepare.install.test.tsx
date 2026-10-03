/// <reference types="bun-types" />
// "Option C" (owner decision 2026-10-03): the prepare screen must not reach 100% unless the browser install really happened. Pinned here at the
// level of buildSteps + prepareWorkspace (the thing that decides when PROJEXA opens):
//   * in production the "app" step runs the verified install and nothing else counts as done: its failure keeps the screen up (ready=false);
//   * the 15-second retry constant is unchanged;
//   * the dev server (no release bundle) keeps the old route warm-up.
import { describe, expect, mock, test } from "bun:test";

mock.module("next/navigation", () => ({ useRouter: () => ({ prefetch: () => {}, push: () => {} }) }));
mock.module("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));

const { buildSteps, RETRY_AFTER_MS, WARM_ROUTES } = await import("./WorkspacePrepare");
const { prepareWorkspace } = await import("@/lib/local-first/prepare-workspace");

const okReplica = (() => ({ sync: async () => ({ status: "done", issues: [] }) })) as never;
const ctx = () => ({ signal: new AbortController().signal, onDetail: () => {} });

describe("the 'app' step is a real install", () => {
  test("production: the step calls the verified install and passes its progress through", async () => {
    const seen: [number, number][] = [];
    const install = mock(async (_u: string, onDetail: (d: number, t: number) => void) => { onDetail(2, 5); return {}; });
    const steps = buildSteps("u1", () => {}, okReplica, () => true, install as never, false);
    await steps.find((s) => s.id === "app")!.run({ signal: new AbortController().signal, onDetail: (d, t) => seen.push([d, t]) });
    expect(install).toHaveBeenCalledTimes(1);
    expect(install.mock.calls[0]![0]).toBe("u1");
    expect(seen).toEqual([[2, 5]]);
  });

  test("production: an install that fails fails the step, so the workspace is NOT ready and the screen would retry", async () => {
    const steps = buildSteps("u1", () => {}, okReplica, () => true, (async () => { throw new Error("PROJEXA could not be installed on this laptop (manifest_unreachable): offline"); }) as never, false);
    const percents: number[] = [];
    const result = await prepareWorkspace({
      steps: steps.filter((s) => s.id === "app" || s.id === "projects"),
      budgetMs: 5_000,
      onProgress: (p) => percents.push(p.percent),
    });
    expect(result.ready).toBe(false);
    expect(result.failed).toEqual(["app"]);
    expect(Math.max(...percents)).toBeLessThan(100);
  });

  test("production: when the install and the replica both succeed the workspace is ready at 100", async () => {
    const steps = buildSteps("u1", () => {}, okReplica, () => true, (async () => ({})) as never, false);
    let last = 0;
    const result = await prepareWorkspace({ steps: steps.filter((s) => s.id === "app" || s.id === "projects"), budgetMs: 5_000, onProgress: (p) => { last = p.percent; } });
    expect(result.ready).toBe(true);
    expect(last).toBe(100);
  });

  test("production: the old route warm-up alone no longer makes the step pass", async () => {
    const prefetched: string[] = [];
    const steps = buildSteps("u1", (h) => prefetched.push(h), okReplica, () => true, (async () => { throw new Error("no release"); }) as never, false);
    await expect(steps.find((s) => s.id === "app")!.run(ctx())).rejects.toThrow("no release");
    expect(prefetched).toEqual([]);
  });

  test("development: no release bundle exists, so the old warm-up runs and the install is not attempted", async () => {
    const prefetched: string[] = [];
    const install = mock(async () => ({}));
    const steps = buildSteps("u1", (h) => prefetched.push(h), okReplica, () => true, install as never, true);
    await steps.find((s) => s.id === "app")!.run(ctx());
    expect(install).not.toHaveBeenCalled();
    expect(prefetched).toEqual([...WARM_ROUTES]);
  });

  test("a failed attempt is retried every 15 seconds (unchanged)", () => {
    expect(RETRY_AFTER_MS).toBe(15_000);
  });
});

describe("the 'projects' step and a sync lock held by another sync of the same person", () => {
  const busy = { status: "idle", issues: [{ reason: "store", message: "Another tab is already syncing." }] };

  test("a busy answer is waited out and asked again; the step passes only when a sync really ran", async () => {
    let calls = 0;
    const replica = (() => ({ sync: async () => { calls += 1; return calls < 3 ? busy : { status: "done", issues: [] }; } })) as never;
    const steps = buildSteps("u1", () => {}, replica, () => true, (async () => ({})) as never, false);
    await steps.find((s) => s.id === "projects")!.run(ctx());
    expect(calls).toBe(3);
  });

  test("a real failure is still a failure (no retry loop on it)", async () => {
    let calls = 0;
    const replica = (() => ({ sync: async () => { calls += 1; return { status: "error", issues: [{ reason: "network", message: "x" }] }; } })) as never;
    const steps = buildSteps("u1", () => {}, replica, () => true, (async () => ({})) as never, false);
    await expect(steps.find((s) => s.id === "projects")!.run(ctx())).rejects.toThrow(/not reachable/);
    expect(calls).toBe(1);
  });
});
