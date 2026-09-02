/// <reference types="bun-types" />
// R67 F-21 (audit recommendation R-236) -- the session store's policy.
//
// The measured defect was seven shell calls per navigation. The fix is only
// real if three things hold, and each is asserted here:
//   1. a warm shell inside its freshness window issues NO request at all;
//   2. a write invalidates the ONE key it affects, and that forces the next
//      read to revalidate;
//   3. a failed bootstrap does not turn into a retry loop, and does not blank
//      a shell that is already correct on screen.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  SHELL_FAILURE_COOLDOWN_MS,
  SHELL_FRESHNESS_MS,
  getShellSnapshot,
  invalidateShell,
  loadShell,
  resetShellStore,
  shellNeedsRevalidation,
  staleShellKeys,
  type ShellSnapshot,
} from "./shell-store";

const realFetch = globalThis.fetch;

function payload(fetchedAt: number, overrides: Record<string, unknown> = {}) {
  return {
    organization: { id: "o1", name: "Skyline Builders", slug: "skyline", country: "IN" },
    role: "member",
    email: "a@example.com",
    projects: [{ id: "p1", name: "Tower A" }],
    notifications: [],
    unreadCount: 0,
    pillUsage: [{ pillKey: "work_progress", functionId: "record_work_progress" }],
    history: [],
    isNewUser: false,
    capabilityTree: [],
    currencies: [],
    fetchedAt,
    errors: {},
    ...overrides,
  };
}

function snapshotOf(fetchedAt: number, invalidatedAt: ShellSnapshot["invalidatedAt"] = {}): ShellSnapshot {
  return { data: payload(fetchedAt) as never, invalidatedAt };
}

beforeEach(() => {
  resetShellStore();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  resetShellStore();
});

describe("shellNeedsRevalidation", () => {
  const now = 1_800_000_000_000;

  test("nothing fetched yet always needs a fetch", () => {
    expect(shellNeedsRevalidation({ data: null, invalidatedAt: {} }, now)).toBe(true);
  });

  test("a shell fetched half a minute ago is warm -- a navigation costs no request", () => {
    expect(shellNeedsRevalidation(snapshotOf(now - 30_000), now)).toBe(false);
    expect(staleShellKeys(snapshotOf(now - 30_000), now)).toEqual([]);
    // The boundary is inclusive: at exactly one minute, notifications are due.
    expect(shellNeedsRevalidation(snapshotOf(now - 60_000), now)).toBe(true);
  });

  test("notifications go stale first, at one minute", () => {
    expect(staleShellKeys(snapshotOf(now - 61_000), now)).toEqual(["notifications"]);
    expect(shellNeedsRevalidation(snapshotOf(now - 61_000), now)).toBe(true);
  });

  test("projects and the pill ranking go stale at five minutes; reference data does not", () => {
    const stale = staleShellKeys(snapshotOf(now - 5 * 60_000 - 1), now);
    expect(stale).toContain("projects");
    expect(stale).toContain("pillUsage");
    expect(stale).toContain("organization");
    expect(stale).not.toContain("capabilityTree");
    expect(stale).not.toContain("currencies");
  });

  test("the capability tree and currencies last a day", () => {
    expect(SHELL_FRESHNESS_MS.capabilityTree).toBe(24 * 60 * 60_000);
    expect(staleShellKeys(snapshotOf(now - 23 * 60 * 60_000), now)).not.toContain("capabilityTree");
    expect(staleShellKeys(snapshotOf(now - 25 * 60 * 60_000), now)).toContain("capabilityTree");
  });

  test("a write invalidates ONE key and that alone forces a revalidation", () => {
    const fetched = now - 1_000;
    const warm = snapshotOf(fetched);
    expect(shellNeedsRevalidation(warm, now)).toBe(false);

    const afterSend = snapshotOf(fetched, { pillUsage: fetched + 1 });
    expect(staleShellKeys(afterSend, now)).toEqual(["pillUsage"]);
    expect(shellNeedsRevalidation(afterSend, now)).toBe(true);
  });

  test("an invalidation from BEFORE the fetch is already answered", () => {
    const fetched = now - 1_000;
    expect(shellNeedsRevalidation(snapshotOf(fetched, { projects: fetched - 5_000 }), now)).toBe(false);
  });
});

describe("loadShell", () => {
  test("one bootstrap serves concurrent callers", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify(payload(Date.now())), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await Promise.all([loadShell(), loadShell(), loadShell()]);
    expect(calls).toBe(1);
    expect(getShellSnapshot().data?.organization?.name).toBe("Skyline Builders");
  });

  test("a successful fetch clears the invalidation marks it answered", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload(Date.now())), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    invalidateShell("projects", "pillUsage");
    expect(Object.keys(getShellSnapshot().invalidatedAt).sort()).toEqual(["pillUsage", "projects"]);
    await loadShell();
    expect(getShellSnapshot().invalidatedAt).toEqual({});
  });

  test("a failure keeps the backend's own words and does NOT retry in a loop", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: "No VERIDIAN credentials configured (AR-04)" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await loadShell();
    expect(calls).toBe(1);
    expect(getShellSnapshot().data?.errors.shell).toBe("No VERIDIAN credentials configured (AR-04)");

    // The snapshot is now stale by construction, which is exactly what would
    // drive an unbounded retry loop without the cooldown.
    await loadShell();
    await loadShell();
    expect(calls).toBe(1);

    // A user-initiated refresh is allowed straight through, because they asked.
    await loadShell(true);
    expect(calls).toBe(2);
    expect(SHELL_FAILURE_COOLDOWN_MS).toBeGreaterThan(0);
  });

  test("a failed revalidation does not blank a shell that is already correct", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(payload(Date.now())), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    await loadShell();
    expect(getShellSnapshot().data?.projects).toHaveLength(1);

    globalThis.fetch = (async () => new Response("<html>502</html>", { status: 502 })) as typeof fetch;
    await loadShell(true);
    // Still the last known-good answer, not an empty rail.
    expect(getShellSnapshot().data?.projects).toHaveLength(1);
    expect(getShellSnapshot().data?.organization?.name).toBe("Skyline Builders");
  });
});
