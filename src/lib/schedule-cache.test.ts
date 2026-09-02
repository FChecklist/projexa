/// <reference types="bun-types" />
// R67 F-09 (R-122) -- sibling test for schedule-cache.ts.
//
// The fault this closes: Radix Tabs unmounts an inactive panel, so every
// return to a schedule tab remounted it and re-fetched, giving the user a
// fresh full-pane spinner for data they had already seen.
//
// Four properties are pinned, each of which a naive memo gets wrong:
//   1. a hover-warm followed by the real click is ONE request, not two;
//   2. two projects never share an entry;
//   3. a failure is not cached, and it REACHES the caller (this data is the
//      panel's content, so swallowing it would be the empty-list defect);
//   4. a write invalidates every resource for that project, so a user is
//      never shown their own write as not-yet-happened.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  loadSchedule,
  warmSchedule,
  invalidateScheduleProject,
  scheduleCacheKey,
} from "./schedule-cache";
import { invalidateShellCache } from "./shell-cache";

const realFetch = globalThis.fetch;
let requestedUrls: string[] = [];

function stubFetch(handler: (url: string) => Response) {
  requestedUrls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    requestedUrls.push(url);
    return handler(url);
  }) as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  invalidateShellCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  invalidateShellCache();
});

describe("loadSchedule", () => {
  test("hovering a tab and then clicking it costs ONE request", async () => {
    stubFetch(() => json({ columns: [] }));

    warmSchedule("board", "p1");
    await loadSchedule("board", "p1");

    expect(requestedUrls).toHaveLength(1);
    expect(requestedUrls[0]).toContain("/api/board?projectId=p1");
  });

  test("switching away and back inside the TTL makes no request at all", async () => {
    stubFetch(() => json({ entries: [] }));

    await loadSchedule("timesheets", "p1");
    await loadSchedule("timesheets", "p1");

    expect(requestedUrls).toHaveLength(1);
  });

  test("two projects never share a cache entry", async () => {
    stubFetch(() => json({ sprints: [] }));

    await loadSchedule("sprints", "p1");
    await loadSchedule("sprints", "p2");

    expect(requestedUrls).toHaveLength(2);
    expect(scheduleCacheKey("sprints", "p1")).not.toBe(scheduleCacheKey("sprints", "p2"));
  });

  test("a failure reaches the caller with the backend's own words, and is not cached", async () => {
    let attempt = 0;
    stubFetch(() => {
      attempt += 1;
      return attempt === 1 ? json({ error: "Board is not enabled for this project" }, 403) : json({ columns: [{ id: "c1" }] });
    });

    await expect(loadSchedule("board", "p1")).rejects.toThrow(/Board is not enabled for this project/);
    // Not cached: the retry gets through and succeeds.
    await expect(loadSchedule<{ columns: unknown[] }>("board", "p1")).resolves.toEqual({ columns: [{ id: "c1" }] });
    expect(requestedUrls).toHaveLength(2);
  });

  test("warmSchedule never rejects -- a hover must not surface an error", async () => {
    stubFetch(() => json({ error: "upstream down" }, 502));

    warmSchedule("board", "p1");
    // Give the swallowed rejection a turn to settle; an unhandled one would
    // fail this test process.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(requestedUrls).toHaveLength(1);
  });

  test("force bypasses the cache -- the Retry path", async () => {
    stubFetch(() => json({ columns: [] }));

    await loadSchedule("board", "p1");
    await loadSchedule("board", "p1", { force: true });

    expect(requestedUrls).toHaveLength(2);
  });
});

describe("invalidateScheduleProject", () => {
  test("a write drops every resource for that project, so nothing shows a stale pre-write view", async () => {
    stubFetch(() => json({}));

    await loadSchedule("board", "p1");
    await loadSchedule("sprints", "p1");
    await loadSchedule("timesheets", "p1");
    expect(requestedUrls).toHaveLength(3);

    invalidateScheduleProject("p1");

    await loadSchedule("board", "p1");
    await loadSchedule("sprints", "p1");
    await loadSchedule("timesheets", "p1");
    expect(requestedUrls).toHaveLength(6);
  });

  test("it leaves another project's cache alone", async () => {
    stubFetch(() => json({}));

    await loadSchedule("board", "p1");
    await loadSchedule("board", "p2");
    invalidateScheduleProject("p1");
    await loadSchedule("board", "p2");

    expect(requestedUrls).toHaveLength(2);
  });
});
