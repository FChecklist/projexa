import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { SyncError, type HeadsAnswer } from "../../sync-client";
import type { ShellApi } from "../types";
import { catchUpProject, useOverviewCatchUp, type CatchUpDeps, type CatchUpReport } from "./overview-catch-up";

// lf-e10c: the open project's copy follows the server while an overview screen is shown (see overview-catch-up.ts's header; found by
// e2e/lf-overview-live.spec.ts in a real browser, where a colleague's change never reached the open dashboard).

const answer = (heads: Record<string, number>): HeadsAnswer => ({ heads, projects_etag: "e", role: "manager", view_class: "v", org_view_class: null, epoch: "x" });

function fakeDeps(o: { heads?: () => Promise<HeadsAnswer>; cursor?: number | null; report?: CatchUpReport } = {}) {
  const calls: { heads: number; sync: Array<{ projectId: string; options?: { moved?: boolean } }>; current: string[] } = { heads: 0, sync: [], current: [] };
  const deps: CatchUpDeps = {
    heads: async () => { calls.heads += 1; return o.heads ? o.heads() : answer({ p1: 7 }); },
    cursor: async () => (o.cursor === undefined ? 5 : o.cursor),
    syncProject: async (projectId, options) => { calls.sync.push({ projectId, options }); return o.report ?? { status: "done", changesApplied: 2, itemsStored: 0, itemsRemoved: 0 }; },
    feedCurrent: (projectId) => calls.current.push(projectId),
  };
  return { deps, calls };
}

describe("catchUpProject", () => {
  test("the head moved past the stored position: ONE /heads, then the project's catch-up marked moved, and 'moved'", async () => {
    const { deps, calls } = fakeDeps();
    expect(await catchUpProject(deps, "p1")).toBe("moved");
    expect(calls.heads).toBe(1);
    expect(calls.sync).toEqual([{ projectId: "p1", options: { moved: true } }]);
  });

  test("nothing moved: one /heads and nothing else; the replica is told the feed is current", async () => {
    const { deps, calls } = fakeDeps({ cursor: 7 });
    expect(await catchUpProject(deps, "p1")).toBe("current");
    expect(calls.sync).toEqual([]);
    expect(calls.current).toEqual(["p1"]);
  });

  test("a catch-up that stored nothing is 'current' (no redraw)", async () => {
    const { deps } = fakeDeps({ report: { status: "done", changesApplied: 0, itemsStored: 0, itemsRemoved: 0 } });
    expect(await catchUpProject(deps, "p1")).toBe("current");
  });

  test("a removed row counts as moved (a colleague deleted it)", async () => {
    const { deps } = fakeDeps({ report: { status: "done", changesApplied: 0, itemsStored: 0, itemsRemoved: 1 } });
    expect(await catchUpProject(deps, "p1")).toBe("moved");
  });

  test("a project never copied here (no stored position) or not named by /heads is skipped, nothing pulled", async () => {
    const a = fakeDeps({ cursor: null });
    expect(await catchUpProject(a.deps, "p1")).toBe("skipped");
    expect(a.calls.sync).toEqual([]);
    const b = fakeDeps();
    expect(await catchUpProject(b.deps, "p2")).toBe("skipped");
    expect(b.calls.sync).toEqual([]);
  });

  test("an older service without /heads (404): the replica's plain one-project run, not marked moved", async () => {
    const { deps, calls } = fakeDeps({ heads: async () => { throw new SyncError("not_found", "no heads", 404); } });
    expect(await catchUpProject(deps, "p1")).toBe("moved");
    expect(calls.sync).toEqual([{ projectId: "p1", options: undefined }]);
  });

  test("the server does not answer, or the run failed: 'failed', never a throw", async () => {
    const down = fakeDeps({ heads: async () => { throw new SyncError("network", "down"); } });
    expect(await catchUpProject(down.deps, "p1")).toBe("failed");
    expect(down.calls.sync).toEqual([]);
    const signedOut = fakeDeps({ report: { status: "signed_out" } });
    expect(await catchUpProject(signedOut.deps, "p1")).toBe("failed");
  });
});

describe("useOverviewCatchUp", () => {
  const setOnline = (online: boolean) => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  };
  afterEach(() => { cleanup(); setOnline(true); });

  function Probe({ shell, projectId, deps }: { shell: ShellApi; projectId: string | null; deps: CatchUpDeps }) {
    useOverviewCatchUp(shell, projectId, { deps });
    return null;
  }
  const shellWith = (connectivity: ShellApi["connectivity"], refresh: () => void): ShellApi => ({
    data: { userId: "u1", name: null, email: null, role: "manager", orgId: "o", projects: [{ id: "p1", name: "P" }] },
    projectId: "p1", setProjectId() {}, navigate() {}, connectivity, refresh,
    writer: { list: async () => [], enqueue: async () => { throw new Error("no"); }, flush: async () => ({ sent: 0, rejected: 0, kept: 0, stoppedBecause: "none" }), notices: async () => [], dismissNotice: async () => {} },
  });

  test("online: runs once when shown and redraws the screen when something arrived", async () => {
    setOnline(true);
    let refreshed = 0;
    const { deps, calls } = fakeDeps();
    render(<Probe shell={shellWith("online", () => { refreshed += 1; })} projectId="p1" deps={deps} />);
    await waitFor(() => expect(refreshed).toBe(1));
    expect(calls.heads).toBe(1);
  });

  test("nothing arrived: no redraw", async () => {
    setOnline(true);
    let refreshed = 0;
    const { deps, calls } = fakeDeps({ cursor: 7 });
    render(<Probe shell={shellWith("online", () => { refreshed += 1; })} projectId="p1" deps={deps} />);
    await waitFor(() => expect(calls.heads).toBe(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(refreshed).toBe(0);
  });

  test("the person coming back to the tab asks again (a colleague's change while they were away)", async () => {
    setOnline(true);
    let refreshed = 0;
    const { deps, calls } = fakeDeps();
    render(<Probe shell={shellWith("online", () => { refreshed += 1; })} projectId="p1" deps={deps} />);
    await waitFor(() => expect(refreshed).toBe(1));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(refreshed).toBe(2));
    expect(calls.heads).toBe(2);
  });

  test("offline: not one request, on show or on focus", async () => {
    setOnline(false);
    const { deps, calls } = fakeDeps();
    render(<Probe shell={shellWith("offline", () => {})} projectId="p1" deps={deps} />);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.heads).toBe(0);
  });

  test("no project: nothing", async () => {
    setOnline(true);
    const { deps, calls } = fakeDeps();
    render(<Probe shell={shellWith("online", () => {})} projectId={null} deps={deps} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.heads).toBe(0);
  });

  test("a focus during a run asks for exactly one more run after it, not two at once", async () => {
    setOnline(true);
    let release!: () => void;
    let inFlight = 0;
    let maxInFlight = 0;
    const base = fakeDeps({ cursor: 7 });
    const deps: CatchUpDeps = {
      ...base.deps,
      heads: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        base.calls.heads += 1;
        if (base.calls.heads === 1) await new Promise<void>((r) => { release = r; });
        inFlight -= 1;
        return answer({ p1: 7 });
      },
    };
    render(<Probe shell={shellWith("online", () => {})} projectId="p1" deps={deps} />);
    await waitFor(() => expect(base.calls.heads).toBe(1));
    await act(async () => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("focus")); });
    release();
    await waitFor(() => expect(base.calls.heads).toBe(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(base.calls.heads).toBe(2);
    expect(maxInFlight).toBe(1);
  });
});
