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
  appendPendingTimeEntry,
  removePendingTimeEntry,
  reconcileTimesheets,
  peekSchedule,
  seedScheduleTasks,
  subscribeSchedule,
  withPendingEntry,
  withoutEntry,
  type TimesheetEntry,
  type TimesheetPayload,
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

// R67 F-11 (R-146) -- the optimistic write half.
//
// Logging time acknowledges the write immediately: the entry is appended to the
// timesheet the user is being navigated to BEFORE the 201 comes back, and is
// then replaced by the server's own answer -- or removed, if the write failed.
// The three properties that make that honest rather than a lie are pinned here.
const PENDING: TimesheetEntry = {
  id: "pending:p1:1",
  issueId: "i1",
  hours: "2",
  spentOn: "2026-09-02",
  activityType: "Site Visit",
  comments: null,
  issue: { id: "i1", number: 12, title: "Pour foundation slab" },
  pending: true,
};

describe("pure list helpers", () => {
  test("withPendingEntry puts the new row first and never duplicates it", () => {
    const once = withPendingEntry([], PENDING);
    const twice = withPendingEntry(once, PENDING);
    expect(twice).toHaveLength(1);
    expect(twice[0].id).toBe(PENDING.id);
  });

  test("withoutEntry removes exactly the one row", () => {
    const existing = { ...PENDING, id: "real-1", pending: undefined };
    const list = withPendingEntry([existing], PENDING);
    expect(withoutEntry(list, PENDING.id)).toEqual([existing]);
  });
});

describe("appendPendingTimeEntry", () => {
  test("the pending row lands in the cached timesheet without any request", async () => {
    stubFetch(() => json({ entries: [{ id: "real-1", issueId: "i9", hours: "1", spentOn: "2026-09-01", activityType: null, comments: null }] }));
    await loadSchedule("timesheets", "p1");
    const before = requestedUrls.length;

    appendPendingTimeEntry("p1", PENDING);

    expect(requestedUrls).toHaveLength(before);
    const cached = peekSchedule<TimesheetPayload>("timesheets", "p1");
    expect(cached?.entries?.map((e) => e.id)).toEqual([PENDING.id, "real-1"]);
  });

  test("a view that is NOT cached is left alone -- a one-row list would hide every real entry", async () => {
    stubFetch(() => json({ entries: [] }));
    await loadSchedule("timesheets", "p1");

    appendPendingTimeEntry("p1", PENDING);

    expect(peekSchedule<TimesheetPayload>("timesheetsMine", "p1")).toBeUndefined();
  });

  test("a mounted panel is told, so it re-renders with the pending row", async () => {
    stubFetch(() => json({ entries: [] }));
    await loadSchedule("timesheets", "p1");

    let notified = 0;
    const unsubscribe = subscribeSchedule("timesheets", "p1", () => { notified += 1; });
    appendPendingTimeEntry("p1", PENDING);
    unsubscribe();

    expect(notified).toBe(1);
  });
});

describe("removePendingTimeEntry", () => {
  test("a failed write takes its row back off the screen", async () => {
    stubFetch(() => json({ entries: [{ id: "real-1", issueId: "i9", hours: "1", spentOn: "2026-09-01", activityType: null, comments: null }] }));
    await loadSchedule("timesheets", "p1");

    appendPendingTimeEntry("p1", PENDING);
    removePendingTimeEntry("p1", PENDING.id);

    expect(peekSchedule<TimesheetPayload>("timesheets", "p1")?.entries?.map((e) => e.id)).toEqual(["real-1"]);
  });
});

describe("reconcileTimesheets", () => {
  test("re-reads the cached view so the pending row becomes the stored one", async () => {
    let call = 0;
    stubFetch(() => {
      call += 1;
      return json({ entries: call === 1 ? [] : [{ id: "real-2", issueId: "i1", hours: "2", spentOn: "2026-09-02", activityType: "Site Visit", comments: null }] });
    });
    await loadSchedule("timesheets", "p1");
    appendPendingTimeEntry("p1", PENDING);

    await reconcileTimesheets("p1");

    const entries = peekSchedule<TimesheetPayload>("timesheets", "p1")?.entries ?? [];
    expect(entries.map((e) => e.id)).toEqual(["real-2"]);
    expect(entries.some((e) => e.pending)).toBe(false);
  });

  test("a failed re-read keeps the pending row -- the write DID land, so removing it would be the wrong lie", async () => {
    let call = 0;
    stubFetch(() => {
      call += 1;
      return call === 1 ? json({ entries: [] }) : json({ error: "upstream down" }, 502);
    });
    await loadSchedule("timesheets", "p1");
    appendPendingTimeEntry("p1", PENDING);

    await reconcileTimesheets("p1");

    expect(peekSchedule<TimesheetPayload>("timesheets", "p1")?.entries?.map((e) => e.id)).toEqual([PENDING.id]);
  });

  test("it still drops the project's other schedule resources", async () => {
    stubFetch(() => json({ entries: [], columns: [] }));
    await loadSchedule("timesheets", "p1");
    await loadSchedule("board", "p1");

    await reconcileTimesheets("p1");

    expect(peekSchedule("board", "p1")).toBeUndefined();
  });
});

describe("seedScheduleTasks", () => {
  test("the Board's cards fill the task list Log Time reads, with no request", () => {
    stubFetch(() => json({}));
    seedScheduleTasks("p1", [{ id: "i1", number: 12, title: "Pour foundation slab" }]);

    expect(peekSchedule<{ tasks: { id: string }[] }>("tasks", "p1")?.tasks).toEqual([
      { id: "i1", number: 12, title: "Pour foundation slab" },
    ]);
    expect(requestedUrls).toHaveLength(0);
  });

  test("it never overwrites a real payload with the board's smaller projection", async () => {
    stubFetch(() => json({ tasks: [{ id: "i1", number: 12, title: "Pour foundation slab", description: "full row" }] }));
    await loadSchedule("tasks", "p1");

    seedScheduleTasks("p1", [{ id: "i2", number: 13, title: "Cure and strip" }]);

    const cached = peekSchedule<{ tasks: { id: string; description?: string }[] }>("tasks", "p1");
    expect(cached?.tasks?.[0]?.description).toBe("full row");
  });

  test("an empty board seeds nothing", () => {
    seedScheduleTasks("p1", []);
    expect(peekSchedule("tasks", "p1")).toBeUndefined();
  });
});
